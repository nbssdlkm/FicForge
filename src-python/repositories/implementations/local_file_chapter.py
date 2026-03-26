"""LocalFileChapterRepository — 章节文件读写实现。

4 位补零文件名转换封装在此处（D-0014）。
Frontmatter 使用 python-frontmatter 库读写。
content_hash 使用 SHA-256（D-0011）。
参见 PRD §2.6.2、§3.4。
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import frontmatter

from core.domain.chapter import Chapter
from core.domain.generated_with import GeneratedWith
from infra.storage_local.file_utils import (
    atomic_write,
    compute_content_hash,
    now_utc,
)
from repositories.interfaces.chapter_repository import ChapterRepository


class LocalFileChapterRepository(ChapterRepository):
    """基于本地文件系统的章节存储。"""

    # ------------------------------------------------------------------
    # 文件名 ↔ chapter_num 转换（D-0014，内部方法）
    # ------------------------------------------------------------------

    @staticmethod
    def _chapter_num_to_filename(chapter_num: int) -> str:
        """int → ch0001.md 格式。"""
        return f"ch{chapter_num:04d}.md"

    @staticmethod
    def _filename_to_chapter_num(filename: str) -> int | None:
        """ch0001.md → int。非法文件名返回 None。"""
        m = re.match(r"^ch(\d{4,})\.md$", filename)
        return int(m.group(1)) if m else None

    def _chapter_path(self, au_id: str, chapter_num: int) -> Path:
        return (
            Path(au_id) / "chapters" / "main"
            / self._chapter_num_to_filename(chapter_num)
        )

    # ------------------------------------------------------------------
    # 接口实现
    # ------------------------------------------------------------------

    async def get(self, au_id: str, chapter_num: int) -> Chapter:
        path = self._chapter_path(au_id, chapter_num)
        if not path.exists():
            raise FileNotFoundError(f"Chapter not found: {path}")

        text = path.read_text(encoding="utf-8")
        post = frontmatter.loads(text)
        meta: dict[str, Any] = dict(post.metadata)
        content: str = post.content

        # --- 缺失字段自动补齐（§2.6.7）---
        repaired = False

        if not meta.get("chapter_id"):
            meta["chapter_id"] = str(uuid.uuid4())
            repaired = True

        if not meta.get("confirmed_at"):
            mtime = datetime.fromtimestamp(
                path.stat().st_mtime, tz=timezone.utc
            )
            meta["confirmed_at"] = mtime.strftime("%Y-%m-%dT%H:%M:%SZ")
            repaired = True

        if not meta.get("content_hash"):
            meta["content_hash"] = compute_content_hash(content)
            repaired = True

        if not meta.get("provenance"):
            # 有 frontmatter 但缺 provenance → 默认 "ai"
            # 无 frontmatter（纯正文）→ 默认 "imported"（在上面 post.metadata 为空时）
            meta["provenance"] = "ai" if post.metadata else "imported"
            repaired = True

        if "revision" not in meta:
            meta["revision"] = 1
            repaired = True

        if "confirmed_focus" not in meta:
            meta["confirmed_focus"] = []
            repaired = True

        # 写回修复后的 frontmatter
        if repaired:
            post.metadata = meta
            atomic_write(path, frontmatter.dumps(post))

        return self._meta_to_chapter(au_id, chapter_num, meta, content)

    async def save(self, chapter: Chapter) -> None:
        path = self._chapter_path(chapter.au_id, chapter.chapter_num)
        meta = self._chapter_to_meta(chapter)
        post = frontmatter.Post(chapter.content, **meta)
        atomic_write(path, frontmatter.dumps(post))

    async def delete(self, au_id: str, chapter_num: int) -> None:
        path = self._chapter_path(au_id, chapter_num)
        if path.exists():
            path.unlink()

    async def list_main(self, au_id: str) -> list[Chapter]:
        main_dir = Path(au_id) / "chapters" / "main"
        if not main_dir.exists():
            return []
        chapters: list[Chapter] = []
        for f in sorted(main_dir.iterdir()):
            if not f.is_file():
                continue
            num = self._filename_to_chapter_num(f.name)
            if num is not None:
                ch = await self.get(au_id, num)
                chapters.append(ch)
        return chapters

    async def exists(self, au_id: str, chapter_num: int) -> bool:
        return self._chapter_path(au_id, chapter_num).exists()

    async def get_content_only(self, au_id: str, chapter_num: int) -> str:
        """读取纯正文（剥离 frontmatter），用于上下文注入和向量化。"""
        path = self._chapter_path(au_id, chapter_num)
        if not path.exists():
            raise FileNotFoundError(f"Chapter not found: {path}")
        text = path.read_text(encoding="utf-8")
        post = frontmatter.loads(text)
        return str(post.content)

    # ------------------------------------------------------------------
    # 内部映射
    # ------------------------------------------------------------------

    @staticmethod
    def _meta_to_chapter(
        au_id: str, chapter_num: int, meta: dict[str, Any], content: str
    ) -> Chapter:
        gw_raw = meta.get("generated_with")
        generated_with: GeneratedWith | None = None
        if isinstance(gw_raw, dict):
            generated_with = GeneratedWith(
                mode=gw_raw.get("mode", ""),
                model=gw_raw.get("model", ""),
                temperature=float(gw_raw.get("temperature", 0.0)),
                top_p=float(gw_raw.get("top_p", 0.0)),
                input_tokens=int(gw_raw.get("input_tokens", 0)),
                output_tokens=int(gw_raw.get("output_tokens", 0)),
                char_count=int(gw_raw.get("char_count", 0)),
                duration_ms=int(gw_raw.get("duration_ms", 0)),
                generated_at=gw_raw.get("generated_at", ""),
            )

        return Chapter(
            au_id=au_id,
            chapter_num=chapter_num,
            content=content,
            chapter_id=meta.get("chapter_id", ""),
            revision=meta.get("revision", 1),
            confirmed_focus=meta.get("confirmed_focus") or [],
            confirmed_at=meta.get("confirmed_at", ""),
            content_hash=meta.get("content_hash", ""),
            provenance=meta.get("provenance", ""),
            generated_with=generated_with,
        )

    @staticmethod
    def _chapter_to_meta(chapter: Chapter) -> dict[str, Any]:
        meta: dict[str, Any] = {
            "chapter_id": chapter.chapter_id,
            "revision": chapter.revision,
            "confirmed_focus": chapter.confirmed_focus,
            "confirmed_at": chapter.confirmed_at,
            "content_hash": chapter.content_hash,
            "provenance": chapter.provenance,
        }
        if chapter.generated_with is not None:
            gw = chapter.generated_with
            meta["generated_with"] = {
                "mode": gw.mode,
                "model": gw.model,
                "temperature": gw.temperature,
                "top_p": gw.top_p,
                "input_tokens": gw.input_tokens,
                "output_tokens": gw.output_tokens,
                "char_count": gw.char_count,
                "duration_ms": gw.duration_ms,
                "generated_at": gw.generated_at,
            }
        return meta
