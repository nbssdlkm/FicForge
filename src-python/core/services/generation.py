"""生成引擎。参见 PRD §4.2、§4.3。

串联 T-012 上下文组装器 + T-013 LLM Provider，输出草稿文件。
支持 SSE 流式输出。
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Iterator, Optional

from core.domain.draft import Draft
from core.domain.generated_with import GeneratedWith
from core.services.context_assembler import assemble_context
from core.services.rag_retrieval import build_rag_query, retrieve_rag
from infra.llm.config_resolver import create_provider, resolve_llm_config, resolve_llm_params
from infra.llm.provider import LLMError
from infra.storage_local.file_utils import now_utc

# ---------------------------------------------------------------------------
# 设定文件加载
# ---------------------------------------------------------------------------

def _load_md_files(directory: Path) -> dict[str, str]:
    """加载目录下所有 .md 文件，返回 {文件名stem: 内容}。"""
    result: dict[str, str] = {}
    if not directory.is_dir():
        return result
    for f in sorted(directory.iterdir()):
        if f.is_file() and f.suffix == ".md":
            try:
                result[f.stem] = f.read_text(encoding="utf-8")
            except Exception:
                continue
    return result


# ---------------------------------------------------------------------------
# 幂等控制（单进程内，PRD §4.2）
# ---------------------------------------------------------------------------

_generating: dict[str, bool] = {}


def _gen_key(au_path: Path, chapter_num: int) -> str:
    return f"{au_path}:{chapter_num}"


# ---------------------------------------------------------------------------
# 空意图识别
# ---------------------------------------------------------------------------

_EMPTY_PATTERNS = frozenset([
    "继续", "然后呢", "然后", "接着写", "接着", "continue", "go on", "",
])


def is_empty_intent(user_input: str) -> bool:
    """识别空意图（"继续"/"然后呢"/""等）。"""
    stripped = user_input.strip().lower()
    return stripped in _EMPTY_PATTERNS or len(stripped) < 3


# ---------------------------------------------------------------------------
# 草稿标签分配
# ---------------------------------------------------------------------------

def _next_draft_label(existing_labels: list[str]) -> str:
    """分配下一个草稿标签 A/B/C/D...."""
    if not existing_labels:
        return "A"
    used = set(existing_labels)
    for i in range(26):
        label = chr(ord("A") + i)
        if label not in used:
            return label
    return "Z"  # 极端情况


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def generate_chapter(
    au_path: Path,
    chapter_num: int,
    user_input: str,
    input_type: str,
    session_llm: Optional[dict[str, Any]],
    session_params: Optional[dict[str, Any]],
    project: Any,
    state: Any,
    settings: Any,
    facts: list[Any],
    chapter_repo: Any,
    draft_repo: Any,
    character_files: Optional[dict[str, str]] = None,
    vector_repo: Any = None,
) -> Iterator[dict[str, Any]]:
    """生成章节（SSE 事件流 generator）。

    Yields:
        {"event": "token", "data": {"text": "..."}}
        {"event": "done", "data": {"draft_label": "A", "generated_with": {...}, "budget_report": {...}}}
        {"event": "error", "data": {"error_code": "...", "message": "...", ...}}
    """
    key = _gen_key(au_path, chapter_num)

    # --- 幂等 409 ---
    if _generating.get(key):
        yield {
            "event": "error",
            "data": {
                "error_code": "GENERATION_IN_PROGRESS",
                "message": "该章节正在生成中，请等待完成",
                "actions": [],
            },
        }
        return

    _generating[key] = True
    label = ""
    full_text = ""
    start_time = time.monotonic()

    try:
        # === 步骤 1：解析配置和参数 ===
        llm_config = resolve_llm_config(session_llm, project, settings)
        model_name = llm_config.get("model", "")
        params = resolve_llm_params(model_name, session_params, project, settings)
        provider = create_provider(llm_config)

        # === 步骤 1.5：加载角色设定文件（P5 核心设定用）===
        if character_files is None:
            character_files = _load_md_files(au_path / "characters")

        # === 步骤 1.8：RAG 检索（向量搜索） ===
        rag_text: Optional[str] = None
        if vector_repo is not None:
            try:
                from core.services.rag_retrieval import build_active_chars
                from dataclasses import asdict as _asdict
                cast_reg_obj = getattr(project, "cast_registry", None)
                cast_reg = _asdict(cast_reg_obj) if cast_reg_obj and hasattr(cast_reg_obj, "__dataclass_fields__") else {}
                active_chars = build_active_chars(state, user_input, project, facts, cast_reg)
                focus_texts = [f.content_clean for f in facts if f.status == "active"] if facts else []
                last_ending = getattr(state, "last_scene_ending", "") or ""
                query = build_rag_query(focus_texts, last_ending, user_input)
                context_window = int(getattr(
                    getattr(settings, "default_llm", None), "context_window", 0
                ) or 128000)
                budget_for_rag = max(0, context_window // 4)
                rag_text, _rag_tokens = retrieve_rag(
                    vector_repo=vector_repo,
                    au_id=str(au_path),
                    query=query,
                    budget_remaining=budget_for_rag,
                    char_filter=active_chars,
                    llm_config=llm_config,
                    rag_decay_coefficient=getattr(project, "rag_decay_coefficient", 0.05),
                    current_chapter=state.current_chapter,
                )
                if not rag_text:
                    rag_text = None
            except Exception:
                import logging as _log
                _log.getLogger(__name__).warning("RAG retrieval failed, continuing without", exc_info=True)

        # === 步骤 2：组装上下文 ===
        ctx = assemble_context(
            project, state, user_input, facts,
            chapter_repo, au_path,
            rag_results=rag_text,
            character_files=character_files,
        )
        messages = ctx["messages"]
        max_tokens: int = ctx["max_tokens"]
        budget_report = ctx["budget_report"]

        # === 步骤 2.5：yield context_summary SSE 事件（D-0031 旁路）===
        try:
            from dataclasses import asdict
            context_summary = ctx.get("context_summary")
            if context_summary is not None:
                yield {
                    "event": "context_summary",
                    "data": asdict(context_summary),
                }
        except Exception:
            pass  # 收集失败不影响生成流程

        # === 步骤 3：分配草稿标签 ===
        existing_drafts = draft_repo.list_by_chapter(str(au_path), chapter_num)
        existing_labels = [d.variant for d in existing_drafts]
        label = _next_draft_label(existing_labels)

        # === 步骤 4：调用 LLM（流式）===
        from infra.llm.provider import LLMChunk
        stream_result = provider.generate(
            messages,
            max_tokens=max_tokens,
            temperature=params["temperature"],
            top_p=params["top_p"],
            stream=True,
        )
        # stream=True 时返回 Iterator[LLMChunk]
        stream: Iterator[LLMChunk] = stream_result  # type: ignore[assignment]

        output_tokens: Optional[int] = None
        for chunk in stream:
            if chunk.delta:
                full_text += chunk.delta
                yield {"event": "token", "data": {"text": chunk.delta}}
            if chunk.output_tokens is not None:
                output_tokens = chunk.output_tokens
            if chunk.input_tokens is not None:
                budget_report.total_input_tokens = chunk.input_tokens

        # === 步骤 5：写入草稿 ===
        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        ts = now_utc()

        gw = GeneratedWith(
            mode=llm_config.get("mode", "api"),
            model=model_name,
            temperature=params["temperature"],
            top_p=params["top_p"],
            input_tokens=budget_report.total_input_tokens,
            output_tokens=output_tokens or 0,
            char_count=len(full_text),
            duration_ms=elapsed_ms,
            generated_at=ts,
        )

        draft = Draft(
            au_id=str(au_path),
            chapter_num=chapter_num,
            variant=label,
            content=full_text,
            generated_with=gw,
        )
        draft_repo.save(draft)

        # === 步骤 7：yield 完成事件 ===
        yield {
            "event": "done",
            "data": {
                "draft_label": label,
                "generated_with": {
                    "mode": gw.mode,
                    "model": gw.model,
                    "temperature": gw.temperature,
                    "top_p": gw.top_p,
                    "input_tokens": gw.input_tokens,
                    "output_tokens": gw.output_tokens,
                    "char_count": gw.char_count,
                    "duration_ms": gw.duration_ms,
                    "generated_at": gw.generated_at,
                },
                "budget_report": {
                    "context_window": budget_report.context_window,
                    "system_tokens": budget_report.system_tokens,
                    "total_input_tokens": budget_report.total_input_tokens,
                    "max_output_tokens": budget_report.max_output_tokens,
                },
            },
        }

    except LLMError as e:
        # === 流式中断：保留部分文本为草稿 ===
        if full_text and label:
            draft = Draft(
                au_id=str(au_path),
                chapter_num=chapter_num,
                variant=label,
                content=full_text,
            )
            draft_repo.save(draft)

        yield {
            "event": "error",
            "data": {
                "error_code": e.error_code,
                "message": e.message,
                "actions": e.actions,
                "partial_draft_label": label if full_text else None,
            },
        }

    except Exception as e:
        # 未知错误
        if full_text and label:
            draft = Draft(
                au_id=str(au_path),
                chapter_num=chapter_num,
                variant=label,
                content=full_text,
            )
            draft_repo.save(draft)

        yield {
            "event": "error",
            "data": {
                "error_code": "INTERNAL_ERROR",
                "message": str(e),
                "actions": [],
                "partial_draft_label": label if full_text else None,
            },
        }

    finally:
        _generating.pop(key, None)
