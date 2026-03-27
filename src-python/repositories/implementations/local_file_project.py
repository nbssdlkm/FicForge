"""LocalFileProjectRepository — project.yaml 读写实现。参见 PRD §3.4。"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import yaml

from core.domain.enums import EmotionStyle, LLMMode, Perspective
from core.domain.project import (
    CastRegistry,
    EmbeddingLock,
    LLMConfig,
    Project,
    WritingStyle,
)
from infra.storage_local.file_utils import atomic_write, dc_to_dict, now_utc
from repositories.interfaces.project_repository import ProjectRepository


class ProjectInvalidError(Exception):
    """project.yaml 完全损坏无法解析。"""


class LocalFileProjectRepository(ProjectRepository):
    """基于本地文件的 AU 项目配置存储（project.yaml）。"""

    def get(self, au_id: str) -> Project:
        path = Path(au_id) / "project.yaml"
        if not path.exists():
            raise FileNotFoundError(f"project.yaml not found: {path}")

        text = path.read_text(encoding="utf-8")
        try:
            raw = yaml.safe_load(text)
        except yaml.YAMLError as e:
            raise ProjectInvalidError(f"project.yaml 损坏无法解析: {path}") from e

        if not isinstance(raw, dict):
            raise ProjectInvalidError(f"project.yaml 内容非法: {path}")

        return _dict_to_project(raw, au_id)

    def save(self, project: Project) -> None:
        path = Path(project.au_id) / "project.yaml"
        project.updated_at = now_utc()
        project.revision += 1
        raw = dc_to_dict(project)
        content = yaml.dump(raw, allow_unicode=True, sort_keys=False, default_flow_style=False)
        atomic_write(path, content)

    def list_aus(self, fandom: str) -> list[Project]:
        aus_dir = Path(fandom) / "aus"
        if not aus_dir.exists():
            return []
        result: list[Project] = []
        for d in sorted(aus_dir.iterdir()):
            if d.is_dir() and (d / "project.yaml").exists():
                try:
                    project = self.get(str(d))
                    result.append(project)
                except (ProjectInvalidError, FileNotFoundError):
                    continue
        return result


# ---------------------------------------------------------------------------
# YAML dict → Project 映射
# ---------------------------------------------------------------------------

def _dict_to_llm_config(d: dict[str, Any] | None) -> LLMConfig:
    if not d:
        return LLMConfig()
    return LLMConfig(
        mode=LLMMode(d.get("mode", "api")),
        model=d.get("model", ""),
        api_base=d.get("api_base", ""),
        api_key=d.get("api_key", ""),
        local_model_path=d.get("local_model_path", ""),
        ollama_model=d.get("ollama_model", ""),
        context_window=d.get("context_window", 0),
    )


def _dict_to_writing_style(d: dict[str, Any] | None) -> WritingStyle:
    if not d:
        return WritingStyle()
    return WritingStyle(
        perspective=Perspective(d.get("perspective", "third_person")),
        pov_character=d.get("pov_character", ""),
        emotion_style=EmotionStyle(d.get("emotion_style", "implicit")),
        custom_instructions=d.get("custom_instructions", ""),
    )


def _dict_to_cast_registry(d: dict[str, Any] | None) -> CastRegistry:
    if not d:
        return CastRegistry()
    return CastRegistry(
        from_core=d.get("from_core") or [],
        au_specific=d.get("au_specific") or [],
        oc=d.get("oc") or [],
    )


def _dict_to_embedding_lock(d: dict[str, Any] | None) -> EmbeddingLock:
    if not d:
        return EmbeddingLock()
    return EmbeddingLock(
        mode=d.get("mode", ""),
        model=d.get("model", ""),
        api_base=d.get("api_base", ""),
        api_key=d.get("api_key", ""),
    )


def _dict_to_project(d: dict[str, Any], au_id: str) -> Project:
    # project_id / au_id：创建时生成，此后永不变更
    project_id = d.get("project_id") or str(uuid.uuid4())
    stored_au_id = d.get("au_id") or str(uuid.uuid4())

    return Project(
        project_id=project_id,
        au_id=au_id,  # 以实际路径为准
        name=d.get("name", ""),
        fandom=d.get("fandom", ""),
        schema_version=d.get("schema_version", "1.0.0"),
        revision=d.get("revision", 1),
        created_at=d.get("created_at", ""),
        updated_at=d.get("updated_at", ""),
        llm=_dict_to_llm_config(d.get("llm")),
        model_params_override=d.get("model_params_override") or {},
        chapter_length=d.get("chapter_length", 1500),
        writing_style=_dict_to_writing_style(d.get("writing_style")),
        ignore_core_worldbuilding=d.get("ignore_core_worldbuilding", False),
        agent_pipeline_enabled=d.get("agent_pipeline_enabled", False),
        cast_registry=_dict_to_cast_registry(d.get("cast_registry")),
        core_always_include=d.get("core_always_include") or [],
        pinned_context=d.get("pinned_context") or [],
        rag_decay_coefficient=d.get("rag_decay_coefficient", 0.05),
        embedding_lock=_dict_to_embedding_lock(d.get("embedding_lock")),
        core_guarantee_budget=d.get("core_guarantee_budget", 400),
        current_branch=d.get("current_branch", "main"),
    )
