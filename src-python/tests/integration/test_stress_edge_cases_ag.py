# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""
边界场景压力测试 & 异常恢复基准测试
"""
import pytest
import time
import json
import threading
from pathlib import Path

from core.domain.fact import Fact
from core.domain.ops_entry import OpsEntry
from core.domain.chapter import Chapter
from core.services.confirm_chapter import ConfirmChapterService
from core.services.undo_chapter import UndoChapterService, UndoChapterError
from core.services.dirty_resolve import ResolveDirtyChapterService, DirtyResolveError
from core.services.facts_lifecycle import add_fact
from core.services.au_mutex import AUMutexManager

from repositories.implementations.local_file_project import LocalFileProjectRepository, ProjectInvalidError
from repositories.implementations.local_file_state import LocalFileStateRepository
from repositories.implementations.local_file_fact import LocalFileFactRepository
from repositories.implementations.local_file_ops import LocalFileOpsRepository
from repositories.implementations.local_file_chapter import LocalFileChapterRepository
from repositories.implementations.local_file_draft import LocalFileDraftRepository

from infra.storage_local.directory import ensure_au_directories
from core.domain.character_scanner import scan_characters_in_chapter

@pytest.fixture
def au_env(tmpdir):
    au = Path(str(tmpdir)) / "test_stress_au"
    ensure_au_directories(au)
    return au

# ==========================================
# 数据损坏恢复 (1-5)
# ==========================================

def test_1_empty_project_yaml(au_env):
    """1. project.yaml 完全为空 → validate_and_repair 补默认值后可正常使用"""
    path = au_env / "project.yaml"
    path.write_text("")  # 完全为空
    repo = LocalFileProjectRepository()
    
    # 期望系统能自动修复或兜底
    try:
        project = repo.get(str(au_env))
        assert project.au_id == str(au_env)
        assert getattr(project, "chapter_length", None) is not None
    except ProjectInvalidError as e:
        pytest.fail(f"Crash Point: project.yaml 完全为空时未触发兜底修复，直接抛出异常: {e}")

def test_2_state_yaml_missing_current_chapter(au_env):
    """2. state.yaml 缺少 current_chapter 字段 → 补默认值 1"""
    path = au_env / "state.yaml"
    path.write_text("au_id: fallback_id\nchapters_dirty: []")
    repo = LocalFileStateRepository()
    state = repo.get(str(au_env))
    assert state.current_chapter == 1

def test_3_facts_jsonl_corrupted_line(au_env):
    """3. facts.jsonl 第 3 行是乱码（半截 JSON）→ 跳过该行，其余正常加载"""
    path = au_env / "facts.jsonl"
    lines = [
        '{"id": "f_1", "content_clean": "A"}',
        '{"id": "f_2", "content_clean": "B"}',
        '{"id": "f_3", "content_c', # 乱码半截 JSON
        '{"id": "f_4", "content_clean": "D"}'
    ]
    path.write_text("\n".join(lines))
    repo = LocalFileFactRepository()
    facts = repo.list_all(str(au_env))
    assert len(facts) == 3
    assert [f.id for f in facts] == ["f_1", "f_2", "f_4"]

def test_4_ops_jsonl_corrupted_line(au_env):
    """4. ops.jsonl 最后一行是半截 JSON → 截断 + .bak 备份 + needs_sync_unsafe=true"""
    path = au_env / "ops.jsonl"
    lines = [
        '{"op_id": "op_1", "op_type": "add_fact"}',
        '{"op_id": "op_2", "op_type": "ad' # 半截 JSON
    ]
    path.write_text("\n".join(lines))
    repo = LocalFileOpsRepository()
    
    entries = repo.list_all(str(au_env))
    assert len(entries) == 1
    
    bak_path = au_env / "ops.jsonl.bak"
    assert bak_path.exists(), "Crash Point: ops.jsonl 断行未触发自动 .bak 备份机制"
    
    state_repo = LocalFileStateRepository()
    state = state_repo.get(str(au_env))
    assert getattr(state, "sync_unsafe", False) is True, "Crash Point: ops.jsonl 损坏未联动标记 state.sync_unsafe=true"

def test_5_chapter_missing_frontmatter(au_env):
    """5. 章节文件缺少 frontmatter → 自动补 chapter_id + confirmed_at 等"""
    path = au_env / "chapters" / "main" / "ch0001.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("纯正文内容，没有任何 frontmatter。")
    
    repo = LocalFileChapterRepository()
    chapter = repo.get(str(au_env), 1)
    assert chapter.chapter_id != ""
    assert chapter.confirmed_at != ""
    assert chapter.content_hash != ""
    assert chapter.provenance == "imported"

# ==========================================
# 极端状态 (6-10)
# ==========================================

def test_6_undo_at_chapter_1(au_env):
    """6. current_chapter=1 时 undo → 明确错误，不崩溃"""
    LocalFileStateRepository().save(
        LocalFileStateRepository().get(str(au_env)) # 默认 current_chapter=1
    )
    service = UndoChapterService(
        LocalFileChapterRepository(), LocalFileDraftRepository(),
        LocalFileStateRepository(), LocalFileOpsRepository(),
        LocalFileFactRepository(), AUMutexManager()
    )
    with pytest.raises(UndoChapterError, match="没有已确认章节可撤销"):
        service.undo_latest_chapter(au_env)

def test_7_resolve_missing_dirty_chapter(au_env):
    """7. chapters_dirty 包含不存在的章节号 → resolve 返回错误，不崩溃"""
    state_repo = LocalFileStateRepository()
    state = state_repo.get(str(au_env))
    state.chapters_dirty = [999]
    state_repo.save(state)
    
    service = ResolveDirtyChapterService(
        LocalFileChapterRepository(), state_repo, LocalFileOpsRepository(),
        LocalFileFactRepository(), AUMutexManager()
    )
    with pytest.raises(DirtyResolveError):
        service.resolve_dirty_chapter(au_env, 999, [])

def test_8_chapter_focus_deleted_fact(au_env):
    """8. chapter_focus 指向已删除的 fact → 合理处理不崩溃"""
    state_repo = LocalFileStateRepository()
    state = state_repo.get(str(au_env))
    state.chapter_focus = ["f_deleted_999"]
    state_repo.save(state)
    
    def _save_draft(au, num, var, content):
        from infra.storage_local.file_utils import atomic_write
        d = au / "chapters" / ".drafts"
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"ch{num:04d}_draft_{var}.md"
        atomic_write(p, content)

    _save_draft(au_env, 1, "A", "测试内容")
    service = ConfirmChapterService(
        LocalFileChapterRepository(), LocalFileDraftRepository(),
        state_repo, LocalFileOpsRepository(), AUMutexManager()
    )
    res = service.confirm_chapter(au_env, 1, "ch0001_draft_A.md")
    assert res["chapter_id"] != ""

def test_9_resolves_non_existent_fact(au_env):
    """9. resolves 指向不存在的 fact_id → 不崩溃，忽略即可"""
    fact_repo = LocalFileFactRepository()
    ops_repo = LocalFileOpsRepository()
    fact_data = {"content_clean": "test", "resolves": "f_not_exist"}
    
    try:
        fact = add_fact(au_env, 1, fact_data, fact_repo, ops_repo)
        assert fact.resolves == "f_not_exist"
    except Exception as e:
        pytest.fail(f"Crash Point: resolves 指向不存在的 fact 导致崩溃: {e}")

def test_10_characters_last_seen_unknown_registry(au_env):
    """10. characters_last_seen 中包含 cast_registry 中不存在的角色名 → 不崩溃"""
    state_repo = LocalFileStateRepository()
    state = state_repo.get(str(au_env))
    state.characters_last_seen = {"UnknownGhost": 5, "林深": 3}
    state_repo.save(state)
    
    def _save_draft(au, num, var, content):
        from infra.storage_local.file_utils import atomic_write
        d = au / "chapters" / ".drafts"
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"ch{num:04d}_draft_{var}.md"
        atomic_write(p, content)

    _save_draft(au_env, 1, "A", "林深出现了。")
    service = ConfirmChapterService(
        LocalFileChapterRepository(), LocalFileDraftRepository(),
        state_repo, LocalFileOpsRepository(), AUMutexManager()
    )
    cast = {"characters": ["林深"]}
    res = service.confirm_chapter(au_env, 1, "ch0001_draft_A.md", cast_registry=cast)
    
    new_state = state_repo.get(str(au_env))
    assert new_state.characters_last_seen["UnknownGhost"] == 5

# ==========================================
# 并发安全 (11-13)
# ==========================================

def test_11_concurrent_facts_append(au_env):
    """11. 两个线程同时 append facts.jsonl → 文件未损坏"""
    repo = LocalFileFactRepository()
    
    def worker(worker_id):
        for i in range(50):
            fact = Fact(
                id=f"f_{worker_id}_{i}", content_raw="txt", content_clean="txt",
                chapter=1, status="active", type="plot_event", source="manual"
            )
            repo.append(str(au_env), fact)
            
    t1 = threading.Thread(target=worker, args=(1,))
    t2 = threading.Thread(target=worker, args=(2,))
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    
    facts = repo.list_all(str(au_env))
    assert len(facts) == 100

def test_12_concurrent_ops_append(au_env):
    """12. 两个线程同时 append ops.jsonl → 文件未损坏"""
    repo = LocalFileOpsRepository()
    
    def worker(worker_id):
        for i in range(50):
            op = OpsEntry(
                op_id=f"op_{worker_id}_{i}", op_type="add_fact",
                target_id="tgt", timestamp="ts", payload={}
            )
            repo.append(str(au_env), op)
            
    t1 = threading.Thread(target=worker, args=(1,))
    t2 = threading.Thread(target=worker, args=(2,))
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    
    entries = repo.list_all(str(au_env))
    assert len(entries) == 100

def test_13_concurrent_confirm_and_add_fact(au_env):
    """13. （概念验证）模拟 confirm 和 add_fact 同时执行 → AU 互斥锁阻止并发"""
    mutex = AUMutexManager()
    
    def long_confirm_mock():
        with mutex.get_lock(str(au_env)):
            time.sleep(0.5)

    th = threading.Thread(target=long_confirm_mock)
    th.start()
    
    time.sleep(0.1)  # 保证 confirm 先拿到 au_mutex
    
    lock_acquired_instantly = mutex.get_lock(str(au_env)).acquire(blocking=False)
    if lock_acquired_instantly:
        mutex.get_lock(str(au_env)).release()
        pytest.fail("Crash Point: AUMutex 未能全局阻止跨服务并发（需要确保所有入口上锁或文档申明豁免）")
    
    th.join()

# ==========================================
# 性能基准 (14-16)
# ==========================================

def test_14_benchmark_1000_facts_read(au_env, capsys):
    """14. 1000 条 facts 读取耗时"""
    repo = LocalFileFactRepository()
    for i in range(1000):
        fact = Fact(
            id=f"f_{i}", content_raw="txt", content_clean=f"Text content {i}",
            chapter=1, status="active", type="plot_event", source="manual"
        )
        repo.append(str(au_env), fact)
        
    start = time.perf_counter()
    repo.list_all(str(au_env))
    dur = time.perf_counter() - start
    with capsys.disabled():
        print(f"\\n[Benchmark] 1000 facts 读取耗时: {dur*1000:.2f} ms")
    assert dur < 1.0

def test_15_benchmark_100_chapters_list(au_env, capsys):
    """15. 100 章 list_main 排序耗时"""
    repo = LocalFileChapterRepository()
    for i in range(1, 101):
        ch = Chapter(
            au_id=str(au_env), chapter_num=i, content=f"Ch {i}",
            chapter_id=f"id_{i}", revision=1, confirmed_focus=[],
            confirmed_at="ts", content_hash="hash", provenance="ai",
            generated_with=None
        )
        repo.save(ch)
        
    start = time.perf_counter()
    chapters = repo.list_main(str(au_env))
    dur = time.perf_counter() - start
    with capsys.disabled():
        print(f"\\n[Benchmark] 100 章 list_main 耗时: {dur*1000:.2f} ms")
    assert len(chapters) == 100

def test_16_benchmark_scan_characters(au_env, capsys):
    """16. 全量 scan_characters_in_chapter（50 个角色名 × 10000 字正文）耗时"""
    cast_registry = {
        "characters": [f"主角_{i}" for i in range(25)] + [f"配角_{i}" for i in range(25)]
    }
    content = "这是一个很长的故事。" * 1000 # 约 10000 字
    content += " 主角_15 和 配角_22 在说话。"
    
    start = time.perf_counter()
    res = scan_characters_in_chapter(content, cast_registry, chapter_num=1)
    dur = time.perf_counter() - start
    with capsys.disabled():
        print(f"\\n[Benchmark] 50 角色 × 1W字 正文扫描耗时: {dur*1000:.2f} ms")
    assert "主角_15" in res
    assert "配角_22" in res
