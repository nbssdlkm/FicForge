"""Chapter 和 Draft Repository 单元测试。"""

import hashlib

import frontmatter
import pytest

from core.domain.chapter import Chapter
from core.domain.draft import Draft
from core.domain.generated_with import GeneratedWith
from infra.storage_local.file_utils import compute_content_hash
from infra.storage_local.directory import ensure_au_directories
from infra.storage_local.validate_repair import validate_and_repair_project, RepairResult
from repositories.implementations.local_file_chapter import LocalFileChapterRepository
from repositories.implementations.local_file_draft import LocalFileDraftRepository


def _setup_au(tmp_path):
    """创建测试 AU 目录结构。"""
    au = tmp_path / "test_au"
    ensure_au_directories(au)
    return au


# ===== Chapter Tests =====

@pytest.mark.asyncio
async def test_4digit_padding(tmp_path):
    """4 位补零：1→ch0001.md, 38→ch0038.md, 1000→ch1000.md。"""
    au = _setup_au(tmp_path)
    repo = LocalFileChapterRepository()

    for num, expected in [(1, "ch0001.md"), (38, "ch0038.md"), (1000, "ch1000.md")]:
        ch = Chapter(au_id=str(au), chapter_num=num, content=f"内容{num}")
        ch.chapter_id = f"id_{num}"
        ch.content_hash = compute_content_hash(ch.content)
        await repo.save(ch)
        path = au / "chapters" / "main" / expected
        assert path.exists(), f"Expected {expected} to exist"


@pytest.mark.asyncio
async def test_roundtrip_frontmatter(tmp_path):
    """写入+读取 frontmatter 全字段往返一致。"""
    au = _setup_au(tmp_path)
    repo = LocalFileChapterRepository()

    gw = GeneratedWith(
        mode="api", model="deepseek-chat", temperature=1.0, top_p=0.95,
        input_tokens=12000, output_tokens=2000, char_count=1500,
        duration_ms=8000, generated_at="2025-03-24T14:22:00Z",
    )
    ch = Chapter(
        au_id=str(au), chapter_num=1, content="第一章的内容",
        chapter_id="ch_abc123", revision=1,
        confirmed_focus=["f001", "f002"],
        confirmed_at="2025-03-24T14:22:00Z",
        content_hash=compute_content_hash("第一章的内容"),
        provenance="ai",
        generated_with=gw,
    )
    await repo.save(ch)
    loaded = await repo.get(str(au), 1)

    assert loaded.chapter_id == "ch_abc123"
    assert loaded.revision == 1
    assert loaded.confirmed_focus == ["f001", "f002"]
    assert loaded.content_hash == compute_content_hash("第一章的内容")
    assert loaded.provenance == "ai"
    assert loaded.generated_with is not None
    assert loaded.generated_with.model == "deepseek-chat"
    assert loaded.generated_with.input_tokens == 12000
    assert loaded.content == "第一章的内容"


@pytest.mark.asyncio
async def test_content_hash_correct(tmp_path):
    """content_hash 计算正确（SHA-256 of 纯正文，不含 frontmatter）。"""
    content = "这是一段测试正文"
    expected = hashlib.sha256(content.encode("utf-8")).hexdigest()
    assert compute_content_hash(content) == expected


@pytest.mark.asyncio
async def test_get_content_only(tmp_path):
    """get_content_only 返回纯正文（无 frontmatter）。"""
    au = _setup_au(tmp_path)
    repo = LocalFileChapterRepository()

    ch = Chapter(
        au_id=str(au), chapter_num=5, content="纯正文内容",
        chapter_id="id5", content_hash=compute_content_hash("纯正文内容"),
    )
    await repo.save(ch)
    content = await repo.get_content_only(str(au), 5)
    assert content == "纯正文内容"


@pytest.mark.asyncio
async def test_auto_repair_missing_chapter_id(tmp_path):
    """缺 chapter_id 的旧文件 → 自动补 UUID 并写回。"""
    au = _setup_au(tmp_path)
    # 写入无 frontmatter 的纯正文文件
    ch_path = au / "chapters" / "main" / "ch0001.md"
    ch_path.write_text("纯正文无 frontmatter", encoding="utf-8")

    repo = LocalFileChapterRepository()
    ch = await repo.get(str(au), 1)
    assert ch.chapter_id != ""  # 自动生成了 UUID
    assert ch.content_hash != ""  # 自动计算了 hash
    assert ch.provenance == "imported"  # 无 frontmatter → imported

    # 验证已写回文件
    text = ch_path.read_text(encoding="utf-8")
    post = frontmatter.loads(text)
    assert post.metadata.get("chapter_id") == ch.chapter_id


@pytest.mark.asyncio
async def test_list_main_sorted(tmp_path):
    """list_main 按 chapter_num 排序。"""
    au = _setup_au(tmp_path)
    repo = LocalFileChapterRepository()

    for num in [3, 1, 2]:
        ch = Chapter(
            au_id=str(au), chapter_num=num, content=f"Ch{num}",
            chapter_id=f"id_{num}", content_hash=compute_content_hash(f"Ch{num}"),
        )
        await repo.save(ch)

    chapters = await repo.list_main(str(au))
    assert [c.chapter_num for c in chapters] == [1, 2, 3]


@pytest.mark.asyncio
async def test_exists_and_delete(tmp_path):
    """exists 和 delete 正常工作。"""
    au = _setup_au(tmp_path)
    repo = LocalFileChapterRepository()

    ch = Chapter(
        au_id=str(au), chapter_num=1, content="test",
        chapter_id="id1", content_hash="abc",
    )
    await repo.save(ch)
    assert await repo.exists(str(au), 1) is True
    await repo.delete(str(au), 1)
    assert await repo.exists(str(au), 1) is False


# ===== Draft Tests =====

@pytest.mark.asyncio
async def test_draft_filename_format(tmp_path):
    """草稿文件名格式正确（ch0038_draft_A.md）。"""
    au = _setup_au(tmp_path)
    repo = LocalFileDraftRepository()

    draft = Draft(au_id=str(au), chapter_num=38, variant="A", content="草稿内容")
    await repo.save(draft)

    path = au / "chapters" / ".drafts" / "ch0038_draft_A.md"
    assert path.exists()


@pytest.mark.asyncio
async def test_draft_roundtrip(tmp_path):
    """草稿写入+读取往返一致。"""
    au = _setup_au(tmp_path)
    repo = LocalFileDraftRepository()

    draft = Draft(au_id=str(au), chapter_num=1, variant="B", content="草稿B")
    await repo.save(draft)
    loaded = await repo.get(str(au), 1, "B")
    assert loaded.content == "草稿B"
    assert loaded.variant == "B"


@pytest.mark.asyncio
async def test_delete_drafts_gte(tmp_path):
    """delete_from_chapter 正确清理 ≥ N 的草稿（D-0016）。"""
    au = _setup_au(tmp_path)
    repo = LocalFileDraftRepository()

    for num in [1, 2, 3, 4, 5]:
        draft = Draft(au_id=str(au), chapter_num=num, variant="A", content=f"d{num}")
        await repo.save(draft)

    await repo.delete_from_chapter(str(au), 3)

    # ch1, ch2 should remain
    assert (au / "chapters" / ".drafts" / "ch0001_draft_A.md").exists()
    assert (au / "chapters" / ".drafts" / "ch0002_draft_A.md").exists()
    # ch3, ch4, ch5 should be deleted
    assert not (au / "chapters" / ".drafts" / "ch0003_draft_A.md").exists()
    assert not (au / "chapters" / ".drafts" / "ch0004_draft_A.md").exists()
    assert not (au / "chapters" / ".drafts" / "ch0005_draft_A.md").exists()


# ===== validate_and_repair Tests =====

def test_repair_project_missing_fields(tmp_path):
    """project.yaml 缺字段 → 补默认值 → repair_log 记录。"""
    au = tmp_path / "test_au"
    au.mkdir()
    import yaml
    (au / "project.yaml").write_text(
        yaml.dump({"project_id": "p1"}), encoding="utf-8"
    )
    result = validate_and_repair_project(au)
    assert not result.is_project_invalid
    assert any("补充缺失字段" in r for r in result.repairs)


def test_repair_state_missing_fields(tmp_path):
    """state.yaml 缺字段 → 补默认值。"""
    au = tmp_path / "test_au"
    au.mkdir()
    import yaml
    (au / "state.yaml").write_text(yaml.dump({"au_id": "a1"}), encoding="utf-8")
    result = validate_and_repair_project(au)
    assert any("state.yaml" in r for r in result.repairs)


def test_repair_chapter_missing_id(tmp_path):
    """章节缺 chapter_id → 自动补 UUID。"""
    au = tmp_path / "test_au"
    ensure_au_directories(au)
    ch = au / "chapters" / "main" / "ch0001.md"
    ch.write_text("纯正文", encoding="utf-8")
    result = validate_and_repair_project(au)
    assert any("chapter_id" in r for r in result.repairs)
    # Verify written back
    post = frontmatter.loads(ch.read_text(encoding="utf-8"))
    assert post.metadata.get("chapter_id")


def test_chapter_consistency_warning(tmp_path):
    """current_chapter 与实际文件数不符 → 返回警告。"""
    au = tmp_path / "test_au"
    ensure_au_directories(au)
    import yaml
    (au / "state.yaml").write_text(
        yaml.dump({"current_chapter": 5}), encoding="utf-8"
    )
    # Only create ch0001 and ch0003 (missing ch0002 and ch0004)
    (au / "chapters" / "main" / "ch0001.md").write_text("ch1", encoding="utf-8")
    (au / "chapters" / "main" / "ch0003.md").write_text("ch3", encoding="utf-8")
    result = validate_and_repair_project(au)
    assert any("文件丢失" in w for w in result.warnings)


# ===== ensure_au_directories Tests =====

def test_ensure_au_directories(tmp_path):
    """创建完整 AU 目录结构。"""
    au = tmp_path / "new_au"
    ensure_au_directories(au)
    assert (au / "chapters" / "main").is_dir()
    assert (au / "chapters" / "backups").is_dir()
    assert (au / "chapters" / ".drafts").is_dir()
    assert (au / "chapters" / "branches").is_dir()
    assert (au / "chapters" / "snapshots").is_dir()
    assert (au / "characters").is_dir()
    assert (au / "oc").is_dir()
    assert (au / "worldbuilding").is_dir()
    assert (au / "imports").is_dir()
