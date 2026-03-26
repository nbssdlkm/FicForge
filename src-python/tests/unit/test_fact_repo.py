"""Facts Repository 单元测试。"""

import json
import threading
import time

import pytest

from core.domain.enums import FactSource, FactStatus, FactType, NarrativeWeight
from core.domain.fact import Fact
from infra.storage_local.directory import ensure_au_directories
from infra.storage_local.validate_repair import validate_and_repair_project
from repositories.implementations.local_file_fact import (
    LocalFileFactRepository,
    generate_fact_id,
)


def _setup_au(tmp_path):
    au = tmp_path / "test_au"
    ensure_au_directories(au)
    return au


def _make_fact(**overrides):
    defaults = {
        "id": generate_fact_id(),
        "content_raw": "第1章林深提到手腕有旧疤",
        "content_clean": "林深手腕有一道旧疤",
        "characters": ["林深"],
        "timeline": "现在线",
        "story_time": "D+0",
        "chapter": 1,
        "status": FactStatus.ACTIVE,
        "type": FactType.CHARACTER_DETAIL,
        "narrative_weight": NarrativeWeight.HIGH,
        "source": FactSource.MANUAL,
        "revision": 1,
        "created_at": "2025-03-20T09:00:00Z",
        "updated_at": "2025-03-20T09:00:00Z",
    }
    defaults.update(overrides)
    return Fact(**defaults)


# ===== 基础读写 =====

def test_empty_file_returns_empty(tmp_path):
    """空文件 → get_all 返回空列表。"""
    au = _setup_au(tmp_path)
    (au / "facts.jsonl").write_text("", encoding="utf-8")
    repo = LocalFileFactRepository()
    assert repo.list_all(str(au)) == []


def test_no_file_returns_empty(tmp_path):
    """文件不存在 → get_all 返回空列表。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    assert repo.list_all(str(au)) == []


def test_append_and_read_single(tmp_path):
    """append 一条 → 读回验证所有字段正确。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    fact = _make_fact(id="f_123_abcd", chapter=2, characters=["林深", "陈明"])
    repo.append(str(au), fact)

    loaded = repo.list_all(str(au))
    assert len(loaded) == 1
    f = loaded[0]
    assert f.id == "f_123_abcd"
    assert f.content_raw == "第1章林深提到手腕有旧疤"
    assert f.content_clean == "林深手腕有一道旧疤"
    assert f.characters == ["林深", "陈明"]
    assert f.chapter == 2
    assert f.status == FactStatus.ACTIVE
    assert f.type == FactType.CHARACTER_DETAIL
    assert f.narrative_weight == NarrativeWeight.HIGH
    assert f.source == FactSource.MANUAL
    assert f.revision == 1


def test_append_multiple_order(tmp_path):
    """append 多条 → 读回顺序正确且逐条完整。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    for i in range(5):
        repo.append(str(au), _make_fact(id=f"f_{i}_test", chapter=i + 1))
    loaded = repo.list_all(str(au))
    assert len(loaded) == 5
    assert [f.id for f in loaded] == [f"f_{i}_test" for i in range(5)]


def test_each_line_valid_json(tmp_path):
    """每行是独立有效 JSON（手动读文件验证）。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    for i in range(3):
        repo.append(str(au), _make_fact(id=f"f_{i}_json"))

    lines = (au / "facts.jsonl").read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 3
    for line in lines:
        d = json.loads(line)  # Should not raise
        assert "id" in d


# ===== Fact ID =====

def test_generate_fact_id_format():
    """generate_fact_id 格式正确。"""
    fid = generate_fact_id()
    parts = fid.split("_")
    assert parts[0] == "f"
    assert parts[1].isdigit()
    assert len(parts[2]) == 4
    assert all(c in "abcdefghijklmnopqrstuvwxyz0123456789" for c in parts[2])


def test_generate_fact_id_unique():
    """连续生成两个 ID 不重复。"""
    ids = {generate_fact_id() for _ in range(100)}
    assert len(ids) == 100


# ===== update =====

def test_update_content(tmp_path):
    """修改 content_clean → 写回后读取验证。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    fact = _make_fact(id="f_up_test")
    repo.append(str(au), fact)

    fact.content_clean = "修改后的内容"
    repo.update(str(au), fact)

    loaded = repo.get(str(au), "f_up_test")
    assert loaded is not None
    assert loaded.content_clean == "修改后的内容"


def test_update_refreshes_updated_at(tmp_path):
    """update 后 updated_at 已刷新。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    fact = _make_fact(id="f_ts_test", updated_at="2020-01-01T00:00:00Z")
    repo.append(str(au), fact)

    fact.content_clean = "changed"
    repo.update(str(au), fact)

    loaded = repo.get(str(au), "f_ts_test")
    assert loaded is not None
    assert loaded.updated_at > "2020-01-01T00:00:00Z"


def test_update_increments_revision(tmp_path):
    """update 后 revision 已 +1。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    fact = _make_fact(id="f_rev_test", revision=3)
    repo.append(str(au), fact)

    fact.content_clean = "changed"
    repo.update(str(au), fact)

    loaded = repo.get(str(au), "f_rev_test")
    assert loaded is not None
    assert loaded.revision == 4


def test_update_nonexistent_id(tmp_path):
    """update 不存在的 ID → 不崩溃。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    repo.append(str(au), _make_fact(id="f_exist"))
    fake = _make_fact(id="f_nonexist")
    repo.update(str(au), fake)  # Should not crash
    assert repo.get(str(au), "f_exist") is not None


# ===== delete =====

def test_delete_by_ids_precise(tmp_path):
    """delete_by_ids 精准删除指定条目。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    for i in range(5):
        repo.append(str(au), _make_fact(id=f"f_{i}_del"))

    repo.delete_by_ids(str(au), ["f_1_del", "f_3_del"])
    remaining = repo.list_all(str(au))
    ids = [f.id for f in remaining]
    assert ids == ["f_0_del", "f_2_del", "f_4_del"]


def test_delete_others_unaffected(tmp_path):
    """delete 后其余条目不受影响。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    repo.append(str(au), _make_fact(id="f_keep", content_clean="保留"))
    repo.append(str(au), _make_fact(id="f_del", content_clean="删除"))

    repo.delete_by_ids(str(au), ["f_del"])
    kept = repo.get(str(au), "f_keep")
    assert kept is not None
    assert kept.content_clean == "保留"


def test_delete_nonexistent_silent(tmp_path):
    """delete 不存在的 ID → 静默忽略。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    repo.append(str(au), _make_fact(id="f_only"))
    repo.delete_by_ids(str(au), ["f_ghost"])  # Should not crash
    assert len(repo.list_all(str(au))) == 1


# ===== 查询 =====

def test_list_by_status(tmp_path):
    """list_by_status 正确过滤。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    repo.append(str(au), _make_fact(id="f_a", status=FactStatus.ACTIVE))
    repo.append(str(au), _make_fact(id="f_u", status=FactStatus.UNRESOLVED))
    repo.append(str(au), _make_fact(id="f_r", status=FactStatus.RESOLVED))

    active = repo.list_by_status(str(au), FactStatus.ACTIVE)
    assert [f.id for f in active] == ["f_a"]


def test_list_by_chapter(tmp_path):
    """list_by_chapter 正确过滤。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    repo.append(str(au), _make_fact(id="f_c1", chapter=1))
    repo.append(str(au), _make_fact(id="f_c2", chapter=2))
    repo.append(str(au), _make_fact(id="f_c1b", chapter=1))

    ch1 = repo.list_by_chapter(str(au), 1)
    assert [f.id for f in ch1] == ["f_c1", "f_c1b"]


def test_list_by_characters_intersection(tmp_path):
    """list_by_characters 支持交集匹配。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    repo.append(str(au), _make_fact(id="f_ls", characters=["林深", "陈明"]))
    repo.append(str(au), _make_fact(id="f_cm", characters=["陈明"]))
    repo.append(str(au), _make_fact(id="f_zl", characters=["张律师"]))

    result = repo.list_by_characters(str(au), ["林深"])
    assert [f.id for f in result] == ["f_ls"]

    result2 = repo.list_by_characters(str(au), ["陈明"])
    assert [f.id for f in result2] == ["f_ls", "f_cm"]


def test_list_unresolved(tmp_path):
    """list_unresolved 等价于 list_by_status("unresolved")。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    repo.append(str(au), _make_fact(id="f_1", status=FactStatus.UNRESOLVED))
    repo.append(str(au), _make_fact(id="f_2", status=FactStatus.ACTIVE))

    unresolved = repo.list_unresolved(str(au))
    assert [f.id for f in unresolved] == ["f_1"]


def test_get_existing(tmp_path):
    """get 单条存在 → 返回 Fact。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    repo.append(str(au), _make_fact(id="f_exists"))
    assert repo.get(str(au), "f_exists") is not None


def test_get_nonexistent(tmp_path):
    """get 单条不存在 → 返回 None。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    assert repo.get(str(au), "f_nope") is None


# ===== 字段缺失容错 =====

def test_missing_source_defaults(tmp_path):
    """读取缺少 source 字段的旧行 → 默认 extract_auto。"""
    au = _setup_au(tmp_path)
    line = json.dumps({"id": "f_old", "content_raw": "x", "content_clean": "x"})
    (au / "facts.jsonl").write_text(line + "\n", encoding="utf-8")
    repo = LocalFileFactRepository()
    f = repo.get(str(au), "f_old")
    assert f is not None
    assert f.source == FactSource.EXTRACT_AUTO


def test_missing_revision_defaults(tmp_path):
    """读取缺少 revision 字段的旧行 → 默认 1。"""
    au = _setup_au(tmp_path)
    line = json.dumps({"id": "f_old2", "content_raw": "x", "content_clean": "x"})
    (au / "facts.jsonl").write_text(line + "\n", encoding="utf-8")
    repo = LocalFileFactRepository()
    f = repo.get(str(au), "f_old2")
    assert f is not None
    assert f.revision == 1


# ===== 损坏行容错 =====

def test_corrupted_line_skipped(tmp_path):
    """文件中混入无效 JSON → 该行跳过，其余正常加载。"""
    au = _setup_au(tmp_path)
    valid = json.dumps({"id": "f_good", "content_raw": "ok", "content_clean": "ok"})
    content = valid + "\n" + "{{corrupted json}}\n" + valid.replace("f_good", "f_good2") + "\n"
    (au / "facts.jsonl").write_text(content, encoding="utf-8")

    repo = LocalFileFactRepository()
    facts = repo.list_all(str(au))
    assert len(facts) == 2
    assert facts[0].id == "f_good"
    assert facts[1].id == "f_good2"


def test_validate_repair_facts_backup(tmp_path):
    """validate_repair 生成 .bak 备份并重写干净文件。"""
    au = _setup_au(tmp_path)
    valid = json.dumps({"id": "f_v", "content_raw": "x", "content_clean": "x"})
    (au / "facts.jsonl").write_text(valid + "\n{{bad}}\n", encoding="utf-8")
    # Need project.yaml for validate_and_repair
    import yaml
    (au / "project.yaml").write_text(
        yaml.dump({"project_id": "p1", "au_id": str(au)}), encoding="utf-8"
    )

    result = validate_and_repair_project(au)
    assert (au / "facts.jsonl.bak").exists()
    assert any("损坏行跳过" in r for r in result.repairs)
    assert any("备份" in r for r in result.repairs)

    # Clean file should only have valid lines
    repo = LocalFileFactRepository()
    facts = repo.list_all(str(au))
    assert len(facts) == 1
    assert facts[0].id == "f_v"


# ===== 并发安全 =====

def test_concurrent_append(tmp_path):
    """两个线程同时 append → 文件未损坏，两条都成功写入。"""
    au = _setup_au(tmp_path)
    repo = LocalFileFactRepository()
    errors = []

    def worker(fact_id):
        try:
            repo.append(str(au), _make_fact(id=fact_id))
        except Exception as e:
            errors.append(e)

    t1 = threading.Thread(target=worker, args=("f_t1",))
    t2 = threading.Thread(target=worker, args=("f_t2",))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert not errors
    facts = repo.list_all(str(au))
    ids = {f.id for f in facts}
    assert "f_t1" in ids
    assert "f_t2" in ids
    assert len(facts) == 2

    # Verify file is valid JSONL
    lines = (au / "facts.jsonl").read_text(encoding="utf-8").strip().split("\n")
    for line in lines:
        json.loads(line)  # Should not raise
