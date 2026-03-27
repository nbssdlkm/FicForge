"""LocalFileFandomRepository — fandom.yaml 读写实现。参见 PRD §3.2。"""

from __future__ import annotations

from pathlib import Path

import yaml

from core.domain.fandom import Fandom
from infra.storage_local.file_utils import atomic_write, dc_to_dict
from repositories.interfaces.fandom_repository import FandomRepository


class LocalFileFandomRepository(FandomRepository):
    """基于本地文件的 Fandom 元信息存储（fandom.yaml）。"""

    def get(self, fandom_path: str) -> Fandom:
        path = Path(fandom_path) / "fandom.yaml"
        if not path.exists():
            raise FileNotFoundError(
                f"fandom.yaml not found: {path} — Fandom 必须由用户显式创建"
            )

        text = path.read_text(encoding="utf-8")
        raw = yaml.safe_load(text)
        if not isinstance(raw, dict):
            raw = {}

        return Fandom(
            name=raw.get("name", ""),
            created_at=raw.get("created_at", ""),
            core_characters=raw.get("core_characters") or [],
            wiki_source=raw.get("wiki_source", ""),
        )

    def save(self, fandom_path: str, fandom: Fandom) -> None:
        path = Path(fandom_path) / "fandom.yaml"
        raw = dc_to_dict(fandom)
        content = yaml.dump(raw, allow_unicode=True, sort_keys=False, default_flow_style=False)
        atomic_write(path, content)

    def list_fandoms(self, data_dir: str) -> list[str]:
        fandoms_dir = Path(data_dir) / "fandoms"
        if not fandoms_dir.exists():
            return []
        return sorted(
            d.name
            for d in fandoms_dir.iterdir()
            if d.is_dir() and (d / "fandom.yaml").exists()
        )

    def list_aus(self, fandom_path: str) -> list[str]:
        aus_dir = Path(fandom_path) / "aus"
        if not aus_dir.exists():
            return []
        return sorted(
            d.name
            for d in aus_dir.iterdir()
            if d.is_dir()
        )
