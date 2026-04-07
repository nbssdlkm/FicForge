# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""垃圾箱服务。参见 D-0023。

.trash/ + manifest.jsonl 实现软删除与恢复。
默认保留 30 天（可配置）。

例外（不进垃圾箱）：
- 草稿文件：直接删除
- 铁律条目：直接删除
- 事实条目：标记 deprecated 而非物理删除
"""

from __future__ import annotations

import json
import shutil
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import frontmatter
import logging
import yaml

from infra.storage_local.file_utils import atomic_write, now_utc

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------

@dataclass
class TrashEntry:
    """manifest.jsonl 中的一条记录。"""

    trash_id: str
    original_path: str          # 相对于 scope 根目录的路径，如 "characters/Connor.md"
    trash_path: str             # .trash/ 内的文件名，如 "characters/Connor_1711700000.md"
    entity_type: str            # character_file / worldbuilding_file / fandom / au
    entity_name: str            # 人类可读名
    deleted_at: str             # ISO 8601
    expires_at: str             # ISO 8601
    metadata: dict[str, Any]    # file_size_bytes, preview 等

    def to_dict(self) -> dict[str, Any]:
        return {
            "trash_id": self.trash_id,
            "original_path": self.original_path,
            "trash_path": self.trash_path,
            "entity_type": self.entity_type,
            "entity_name": self.entity_name,
            "deleted_at": self.deleted_at,
            "expires_at": self.expires_at,
            "metadata": self.metadata,
        }

    @staticmethod
    def from_dict(d: dict[str, Any]) -> TrashEntry:
        return TrashEntry(
            trash_id=d["trash_id"],
            original_path=d["original_path"],
            trash_path=d["trash_path"],
            entity_type=d["entity_type"],
            entity_name=d["entity_name"],
            deleted_at=d["deleted_at"],
            expires_at=d["expires_at"],
            metadata=d.get("metadata", {}),
        )


# ---------------------------------------------------------------------------
# 核心服务
# ---------------------------------------------------------------------------

class TrashService:
    """垃圾箱操作服务。

    每个 Fandom / AU 根目录下都有自己的 .trash/ 目录和 manifest.jsonl。
    """

    def __init__(self, retention_days: int = 30) -> None:
        self.retention_days = retention_days

    # ----- 公共方法 -----

    def move_to_trash(
        self,
        scope_root: Path,
        relative_path: str,
        entity_type: str,
        entity_name: str,
    ) -> TrashEntry:
        """将文件或目录移入 .trash/。

        Args:
            scope_root: Fandom 或 AU 的根目录。
            relative_path: 相对于 scope_root 的路径，如 "characters/Connor.md"。
            entity_type: 实体类型（character_file / worldbuilding_file / fandom / au）。
            entity_name: 人类可读名称。

        Returns:
            创建的 TrashEntry。

        Raises:
            FileNotFoundError: 源文件/目录不存在。
        """
        # 路径遍历防护
        if ".." in relative_path or relative_path.startswith("/"):
            raise ValueError(f"非法路径: {relative_path}")

        source = scope_root / relative_path
        # 确保解析后的路径仍在 scope_root 内
        try:
            source.resolve().relative_to(scope_root.resolve())
        except ValueError:
            raise ValueError(f"路径逃逸 scope_root: {relative_path}")

        if not source.exists():
            raise FileNotFoundError(f"源不存在: {source}")

        ts = int(time.time())
        short_id = uuid.uuid4().hex[:4]
        trash_id = f"tr_{ts}_{short_id}"

        # 构建 .trash/ 内的路径，保持子目录结构
        p = Path(relative_path)
        trash_filename = f"{p.stem}_{ts}{p.suffix}" if source.is_file() else f"{p.name}_{ts}"
        trash_rel = str(p.parent / trash_filename) if str(p.parent) != "." else trash_filename

        trash_dir = scope_root / ".trash"
        trash_target = trash_dir / trash_rel
        trash_target.parent.mkdir(parents=True, exist_ok=True)

        # 收集元数据
        meta: dict[str, Any] = {}
        if source.is_file():
            meta["file_size_bytes"] = source.stat().st_size
            try:
                content = source.read_text(encoding="utf-8")
                meta["preview"] = content[:100]
            except Exception:
                meta["preview"] = ""
        elif source.is_dir():
            meta["is_directory"] = True

        # 移动
        character_name = self._read_character_name(source) if self._should_sync_cast_registry(scope_root, relative_path) else None
        shutil.move(str(source), str(trash_target))
        if character_name:
            self._update_cast_registry(scope_root, character_name, action="remove")

        now = datetime.now(timezone.utc)
        expires = now + timedelta(days=self.retention_days)

        entry = TrashEntry(
            trash_id=trash_id,
            original_path=relative_path,
            trash_path=trash_rel,
            entity_type=entity_type,
            entity_name=entity_name,
            deleted_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            expires_at=expires.strftime("%Y-%m-%dT%H:%M:%SZ"),
            metadata=meta,
        )

        self._append_manifest(scope_root, entry)
        return entry

    def list_trash(self, scope_root: Path) -> list[TrashEntry]:
        """列出 .trash/ 中的所有条目。"""
        return self._read_manifest(scope_root)

    def restore(self, scope_root: Path, trash_id: str) -> TrashEntry:
        """从 .trash/ 恢复到原路径。

        Raises:
            FileNotFoundError: trash_id 不存在。
            FileExistsError: 原路径已有文件（409 冲突）。
        """
        entries = self._read_manifest(scope_root)
        target_entry: Optional[TrashEntry] = None
        for e in entries:
            if e.trash_id == trash_id:
                target_entry = e
                break

        if target_entry is None:
            raise FileNotFoundError(f"垃圾箱条目不存在: {trash_id}")

        original_dest = scope_root / target_entry.original_path
        if original_dest.exists():
            raise FileExistsError(
                f"原路径已存在文件，无法恢复: {target_entry.original_path}"
            )

        trash_source = scope_root / ".trash" / target_entry.trash_path
        if not trash_source.exists():
            # 文件已丢失，清理 manifest 记录
            self._remove_from_manifest(scope_root, trash_id)
            raise FileNotFoundError(f"垃圾箱中的文件已丢失: {target_entry.trash_path}")

        original_dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(trash_source), str(original_dest))
        self._remove_from_manifest(scope_root, trash_id)
        if self._should_sync_cast_registry(scope_root, target_entry.original_path):
            character_name = self._read_character_name(original_dest)
            if character_name:
                self._update_cast_registry(scope_root, character_name, action="add")

        return target_entry

    def permanent_delete(self, scope_root: Path, trash_id: str) -> TrashEntry:
        """从 .trash/ 永久删除。

        Raises:
            FileNotFoundError: trash_id 不存在。
        """
        entries = self._read_manifest(scope_root)
        target_entry: Optional[TrashEntry] = None
        for e in entries:
            if e.trash_id == trash_id:
                target_entry = e
                break

        if target_entry is None:
            raise FileNotFoundError(f"垃圾箱条目不存在: {trash_id}")

        trash_source = scope_root / ".trash" / target_entry.trash_path
        if trash_source.exists():
            if trash_source.is_dir():
                shutil.rmtree(trash_source)
            else:
                trash_source.unlink()

        self._remove_from_manifest(scope_root, trash_id)
        return target_entry

    def purge_expired(
        self, scope_root: Path, max_age_days: Optional[int] = None
    ) -> list[TrashEntry]:
        """清理垃圾箱条目。

        Args:
            max_age_days: 为 0 时强制清理所有条目。None 时只清已过期条目。
        """
        entries = self._read_manifest(scope_root)
        now = datetime.now(timezone.utc)
        purged: list[TrashEntry] = []
        force_all = max_age_days is not None and max_age_days == 0

        for entry in entries:
            should_purge = force_all
            if not should_purge:
                try:
                    expires = datetime.fromisoformat(
                        entry.expires_at.replace("Z", "+00:00")
                    )
                except ValueError:
                    continue
                should_purge = now >= expires

            if should_purge:
                trash_source = scope_root / ".trash" / entry.trash_path
                if trash_source.exists():
                    if trash_source.is_dir():
                        shutil.rmtree(trash_source)
                    else:
                        trash_source.unlink()
                purged.append(entry)

        if purged:
            purged_ids = {e.trash_id for e in purged}
            remaining = [e for e in entries if e.trash_id not in purged_ids]
            self._write_manifest(scope_root, remaining)

        return purged

    # ----- Manifest 操作 -----

    def _manifest_path(self, scope_root: Path) -> Path:
        return scope_root / ".trash" / "manifest.jsonl"

    def _read_manifest(self, scope_root: Path) -> list[TrashEntry]:
        mp = self._manifest_path(scope_root)
        if not mp.is_file():
            return []
        entries: list[TrashEntry] = []
        for line in mp.read_text(encoding="utf-8").strip().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
                entries.append(TrashEntry.from_dict(d))
            except (json.JSONDecodeError, KeyError) as e:
                logger.warning("跳过损坏的 manifest 行: %s... (%s)", line[:50], e)
                continue
        return entries

    def _write_manifest(self, scope_root: Path, entries: list[TrashEntry]) -> None:
        mp = self._manifest_path(scope_root)
        mp.parent.mkdir(parents=True, exist_ok=True)
        lines = [json.dumps(e.to_dict(), ensure_ascii=False) for e in entries]
        mp.write_text("\n".join(lines) + "\n" if lines else "", encoding="utf-8")

    def _append_manifest(self, scope_root: Path, entry: TrashEntry) -> None:
        mp = self._manifest_path(scope_root)
        mp.parent.mkdir(parents=True, exist_ok=True)
        with open(mp, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry.to_dict(), ensure_ascii=False) + "\n")

    def _remove_from_manifest(self, scope_root: Path, trash_id: str) -> None:
        entries = self._read_manifest(scope_root)
        remaining = [e for e in entries if e.trash_id != trash_id]
        self._write_manifest(scope_root, remaining)

    # ----- cast_registry 联动 -----

    def _should_sync_cast_registry(self, scope_root: Path, relative_path: str) -> bool:
        parts = Path(relative_path).parts
        return bool(parts) and parts[0] == "characters" and (scope_root / "project.yaml").is_file()

    def _read_character_name(self, path: Path) -> str | None:
        try:
            post = frontmatter.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("读取角色 frontmatter 失败，跳过 cast_registry 联动: %s (%s)", path, exc)
            return None

        name = post.metadata.get("name")
        if isinstance(name, str):
            stripped = name.strip()
            return stripped or None
        return None

    def _update_cast_registry(self, scope_root: Path, character_name: str, action: str) -> None:
        project_path = scope_root / "project.yaml"
        if not project_path.is_file():
            return

        try:
            raw = yaml.safe_load(project_path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as exc:
            logger.warning("project.yaml 损坏，跳过 cast_registry 联动: %s (%s)", project_path, exc)
            return

        if not isinstance(raw, dict):
            logger.warning("project.yaml 内容非法，跳过 cast_registry 联动: %s", project_path)
            return

        cast_registry = raw.get("cast_registry")
        if not isinstance(cast_registry, dict):
            cast_registry = {}

        names = cast_registry.get("characters")
        if not isinstance(names, list):
            names = []

        normalized = [name for name in names if isinstance(name, str) and name.strip()]

        if action == "remove":
            updated = [name for name in normalized if name != character_name]
        else:
            updated = list(normalized)
            if character_name not in updated:
                updated.append(character_name)

        if updated == normalized:
            return

        cast_registry["characters"] = updated
        raw["cast_registry"] = cast_registry
        content = yaml.dump(raw, allow_unicode=True, sort_keys=False, default_flow_style=False)
        atomic_write(project_path, content)
