"""项目数据校验与自动修复框架。参见 PRD §2.6.7。

每次打开 AU 时调用 validate_and_repair_project()。
facts.jsonl 和 ops.jsonl 的校验留给 T-005 和 T-006。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import frontmatter
import yaml

from infra.storage_local.file_utils import atomic_write, compute_content_hash


@dataclass
class RepairResult:
    """校验与修复结果。"""

    warnings: list[str] = field(default_factory=list)
    repairs: list[str] = field(default_factory=list)
    is_project_invalid: bool = False


def validate_and_repair_project(au_path: Path) -> RepairResult:
    """校验并修复 AU 项目数据。

    返回 RepairResult，包含修复日志和警告列表。
    """
    result = RepairResult()

    _repair_project_yaml(au_path, result)
    _repair_state_yaml(au_path, result)
    _repair_chapter_frontmatter(au_path, result)
    _check_chapter_consistency(au_path, result)

    return result


def _repair_project_yaml(au_path: Path, result: RepairResult) -> None:
    """校验 project.yaml：缺失字段补默认值，完全损坏标 project_invalid。"""
    path = au_path / "project.yaml"
    if not path.exists():
        result.is_project_invalid = True
        result.warnings.append(f"project.yaml 不存在: {path}")
        return

    text = path.read_text(encoding="utf-8")
    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError:
        result.is_project_invalid = True
        result.warnings.append(f"project.yaml 完全损坏无法解析: {path}")
        return

    if not isinstance(raw, dict):
        result.is_project_invalid = True
        result.warnings.append(f"project.yaml 内容非法: {path}")
        return

    repaired = False
    defaults = {
        "project_id": lambda: str(uuid.uuid4()),
        "au_id": lambda: str(uuid.uuid4()),
        "name": lambda: "",
        "fandom": lambda: "",
        "schema_version": lambda: "1.0.0",
        "revision": lambda: 1,
        "created_at": lambda: "",
        "updated_at": lambda: "",
        "chapter_length": lambda: 1500,
        "ignore_core_worldbuilding": lambda: False,
        "agent_pipeline_enabled": lambda: False,
        "rag_decay_coefficient": lambda: 0.05,
        "core_guarantee_budget": lambda: 400,
        "current_branch": lambda: "main",
    }

    for key, default_fn in defaults.items():
        if key not in raw:
            raw[key] = default_fn()  # type: ignore[no-untyped-call]
            result.repairs.append(f"project.yaml: 补充缺失字段 {key}")
            repaired = True

    if repaired:
        content = yaml.dump(raw, allow_unicode=True, sort_keys=False, default_flow_style=False)
        atomic_write(path, content)


def _repair_state_yaml(au_path: Path, result: RepairResult) -> None:
    """校验 state.yaml：缺失字段补默认值。"""
    path = au_path / "state.yaml"
    if not path.exists():
        # 创建默认 state.yaml
        raw = {
            "au_id": "",
            "revision": 1,
            "updated_at": "",
            "current_chapter": 1,
            "last_scene_ending": "",
            "last_confirmed_chapter_focus": [],
            "characters_last_seen": {},
            "chapter_focus": [],
            "chapters_dirty": [],
            "index_status": "stale",
            "index_built_with": None,
            "sync_unsafe": False,
        }
        content = yaml.dump(raw, allow_unicode=True, sort_keys=False, default_flow_style=False)
        atomic_write(path, content)
        result.repairs.append("state.yaml: 文件不存在，已创建默认文件")
        return

    text = path.read_text(encoding="utf-8")
    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError:
        raw = {}
        result.warnings.append("state.yaml 解析失败，使用默认值")

    if not isinstance(raw, dict):
        raw = {}

    repaired = False
    defaults = {
        "revision": 1,
        "updated_at": "",
        "current_chapter": 1,
        "last_scene_ending": "",
        "last_confirmed_chapter_focus": [],
        "characters_last_seen": {},
        "chapter_focus": [],
        "chapters_dirty": [],
        "index_status": "stale",
        "index_built_with": None,
        "sync_unsafe": False,
    }

    for key, default_val in defaults.items():
        if key not in raw:
            raw[key] = default_val
            result.repairs.append(f"state.yaml: 补充缺失字段 {key}")
            repaired = True

    if repaired:
        content = yaml.dump(raw, allow_unicode=True, sort_keys=False, default_flow_style=False)
        atomic_write(path, content)


def _repair_chapter_frontmatter(au_path: Path, result: RepairResult) -> None:
    """校验章节 frontmatter：缺 chapter_id / confirmed_at / content_hash 时自动补齐。"""
    main_dir = au_path / "chapters" / "main"
    if not main_dir.exists():
        return

    for f in sorted(main_dir.iterdir()):
        if not f.is_file() or not f.name.endswith(".md"):
            continue

        text = f.read_text(encoding="utf-8")
        post = frontmatter.loads(text)
        meta: dict[str, object] = dict(post.metadata)
        repaired = False

        if not meta.get("chapter_id"):
            meta["chapter_id"] = str(uuid.uuid4())
            result.repairs.append(f"{f.name}: 补充 chapter_id")
            repaired = True

        if not meta.get("confirmed_at"):
            mtime = datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc)
            meta["confirmed_at"] = mtime.strftime("%Y-%m-%dT%H:%M:%SZ")
            result.repairs.append(f"{f.name}: 补充 confirmed_at (from mtime)")
            repaired = True

        if not meta.get("content_hash"):
            meta["content_hash"] = compute_content_hash(str(post.content))
            result.repairs.append(f"{f.name}: 补充 content_hash")
            repaired = True

        if repaired:
            post.metadata = meta
            atomic_write(f, frontmatter.dumps(post))


def _check_chapter_consistency(au_path: Path, result: RepairResult) -> None:
    """检查 current_chapter 与实际章节文件数是否一致。"""
    state_path = au_path / "state.yaml"
    main_dir = au_path / "chapters" / "main"

    if not state_path.exists() or not main_dir.exists():
        return

    try:
        raw = yaml.safe_load(state_path.read_text(encoding="utf-8"))
    except yaml.YAMLError:
        return

    if not isinstance(raw, dict):
        return

    current_chapter = raw.get("current_chapter", 1)
    # current_chapter = N 意味着 ch0001 到 ch{N-1} 应该存在
    expected_count = current_chapter - 1

    import re
    actual_files = [
        f for f in main_dir.iterdir()
        if f.is_file() and re.match(r"^ch\d{4,}\.md$", f.name)
    ]
    actual_count = len(actual_files)

    if actual_count != expected_count:
        result.warnings.append(
            f"current_chapter={current_chapter} 表明应有 {expected_count} 个章节文件，"
            f"实际发现 {actual_count} 个"
        )

    # 检查文件缺失
    for i in range(1, current_chapter):
        ch_file = main_dir / f"ch{i:04d}.md"
        if not ch_file.exists():
            result.warnings.append(f"第 {i} 章文件丢失: {ch_file.name}")

    # 检查外部新增（>= current_chapter 的文件）
    for f in actual_files:
        m = re.match(r"^ch(\d{4,})\.md$", f.name)
        if m:
            num = int(m.group(1))
            if num >= current_chapter:
                result.warnings.append(
                    f"检测到外部新增章节: {f.name} (>= current_chapter={current_chapter})"
                )
