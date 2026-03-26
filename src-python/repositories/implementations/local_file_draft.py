"""LocalFileDraftRepository — 草稿文件读写实现。

草稿存储在 chapters/.drafts/ 目录下。
文件名格式：ch{NNNN}_draft_{variant}.md（D-0014）。
参见 DECISIONS D-0016。
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import frontmatter

from core.domain.draft import Draft
from core.domain.generated_with import GeneratedWith
from infra.storage_local.file_utils import atomic_write
from repositories.interfaces.draft_repository import DraftRepository


class LocalFileDraftRepository(DraftRepository):
    """基于本地文件系统的草稿存储。"""

    @staticmethod
    def _draft_filename(chapter_num: int, variant: str) -> str:
        return f"ch{chapter_num:04d}_draft_{variant}.md"

    @staticmethod
    def _parse_draft_filename(filename: str) -> tuple[int, str] | None:
        """解析草稿文件名 → (chapter_num, variant)。"""
        m = re.match(r"^ch(\d{4,})_draft_(\w+)\.md$", filename)
        if m:
            return int(m.group(1)), m.group(2)
        return None

    def _drafts_dir(self, au_id: str) -> Path:
        return Path(au_id) / "chapters" / ".drafts"

    def _draft_path(self, au_id: str, chapter_num: int, variant: str) -> Path:
        return self._drafts_dir(au_id) / self._draft_filename(chapter_num, variant)

    async def get(self, au_id: str, chapter_num: int, variant: str) -> Draft:
        path = self._draft_path(au_id, chapter_num, variant)
        if not path.exists():
            raise FileNotFoundError(f"Draft not found: {path}")

        text = path.read_text(encoding="utf-8")
        post = frontmatter.loads(text)
        meta: dict[str, Any] = dict(post.metadata)

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

        return Draft(
            au_id=au_id,
            chapter_num=chapter_num,
            variant=variant,
            content=post.content,
            generated_with=generated_with,
        )

    async def save(self, draft: Draft) -> None:
        path = self._draft_path(draft.au_id, draft.chapter_num, draft.variant)
        meta: dict[str, Any] = {}
        if draft.generated_with is not None:
            gw = draft.generated_with
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
        post = frontmatter.Post(draft.content, **meta)
        atomic_write(path, frontmatter.dumps(post))

    async def list_by_chapter(self, au_id: str, chapter_num: int) -> list[Draft]:
        drafts_dir = self._drafts_dir(au_id)
        if not drafts_dir.exists():
            return []
        result: list[Draft] = []
        for f in sorted(drafts_dir.iterdir()):
            parsed = self._parse_draft_filename(f.name)
            if parsed and parsed[0] == chapter_num:
                draft = await self.get(au_id, parsed[0], parsed[1])
                result.append(draft)
        return result

    async def delete_by_chapter(self, au_id: str, chapter_num: int) -> None:
        drafts_dir = self._drafts_dir(au_id)
        if not drafts_dir.exists():
            return
        for f in drafts_dir.iterdir():
            parsed = self._parse_draft_filename(f.name)
            if parsed and parsed[0] == chapter_num:
                f.unlink()

    async def delete_from_chapter(self, au_id: str, from_chapter_num: int) -> None:
        """删除章节号 >= from_chapter_num 的所有草稿（D-0016 undo 清理）。"""
        drafts_dir = self._drafts_dir(au_id)
        if not drafts_dir.exists():
            return
        for f in drafts_dir.iterdir():
            parsed = self._parse_draft_filename(f.name)
            if parsed and parsed[0] >= from_chapter_num:
                f.unlink()
