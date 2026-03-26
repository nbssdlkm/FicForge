"""LocalFileStateRepository — state.yaml 读写实现。参见 PRD §3.5。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from core.domain.enums import IndexStatus
from core.domain.state import EmbeddingFingerprint, State
from infra.storage_local.file_utils import atomic_write, dc_to_dict, now_utc
from repositories.interfaces.state_repository import StateRepository


class LocalFileStateRepository(StateRepository):
    """基于本地文件的 AU 运行时状态存储（state.yaml）。"""

    async def get(self, au_id: str) -> State:
        path = Path(au_id) / "state.yaml"
        if not path.exists():
            return State(au_id=au_id)

        text = path.read_text(encoding="utf-8")
        raw = yaml.safe_load(text)
        if not isinstance(raw, dict):
            raw = {}

        return _dict_to_state(raw, au_id)

    async def save(self, state: State) -> None:
        path = Path(state.au_id) / "state.yaml"
        state.updated_at = now_utc()
        state.revision += 1
        raw = dc_to_dict(state)
        content = yaml.dump(raw, allow_unicode=True, sort_keys=False, default_flow_style=False)
        atomic_write(path, content)


# ---------------------------------------------------------------------------
# YAML dict → State 映射（字段缺失时自动补默认值）
# ---------------------------------------------------------------------------

def _dict_to_embedding_fingerprint(d: dict[str, Any] | None) -> EmbeddingFingerprint | None:
    if not d:
        return None
    return EmbeddingFingerprint(
        mode=d.get("mode", ""),
        model=d.get("model", ""),
        api_base=d.get("api_base", ""),
    )


def _dict_to_state(d: dict[str, Any], au_id: str) -> State:
    return State(
        au_id=au_id,
        revision=d.get("revision", 1),
        updated_at=d.get("updated_at", ""),
        current_chapter=d.get("current_chapter", 1),
        last_scene_ending=d.get("last_scene_ending", ""),
        last_confirmed_chapter_focus=d.get("last_confirmed_chapter_focus") or [],
        characters_last_seen=d.get("characters_last_seen") or {},
        chapter_focus=d.get("chapter_focus") or [],
        chapters_dirty=d.get("chapters_dirty") or [],
        index_status=IndexStatus(d.get("index_status", "stale")),
        index_built_with=_dict_to_embedding_fingerprint(d.get("index_built_with")),
        sync_unsafe=d.get("sync_unsafe", False),
    )
