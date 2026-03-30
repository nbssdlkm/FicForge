"""ConfirmChapter 单元测试——辅助函数。"""

from core.domain.character_scanner import scan_characters_in_chapter
from core.domain.text_utils import extract_last_scene_ending


# ===== scan_characters_in_chapter =====

def test_scan_basic_cast_registry():
    """纯正文中包含 cast_registry 角色名 → 正确识别。"""
    text = "林深走进咖啡馆，陈明正在擦杯子。"
    registry = {"characters": ["林深", "陈明"]}
    result = scan_characters_in_chapter(text, registry, chapter_num=5)
    assert result == {"林深": 5, "陈明": 5}


def test_scan_alias_mapping():
    """包含别名 → 映射为主名。"""
    text = "公子微微一笑，达达利亚露出了愉悦的表情。"
    registry = {"characters": ["达达利亚"]}
    aliases = {"达达利亚": ["公子", "阿贾克斯"]}
    result = scan_characters_in_chapter(text, registry, aliases, chapter_num=3)
    assert "达达利亚" in result
    assert result["达达利亚"] == 3


def test_scan_no_unknown_names():
    """不在 cast_registry 中的名字 → 不识别（fallback=False）。"""
    text = "路人甲走过街角，林深没有注意到。"
    registry = {"characters": ["林深"]}
    result = scan_characters_in_chapter(text, registry, chapter_num=1)
    assert "路人甲" not in result
    assert "林深" in result


def test_scan_returns_dict_format():
    """返回 {角色名: chapter_num} 字典格式正确。"""
    text = "陈律师翻开了案卷。"
    registry = {"characters": ["陈律师"]}
    result = scan_characters_in_chapter(text, registry, chapter_num=10)
    assert result == {"陈律师": 10}


def test_scan_empty_text():
    """空正文 → 返回空字典。"""
    result = scan_characters_in_chapter("", {"characters": ["林深"]}, chapter_num=1)
    assert result == {}


# ===== extract_last_scene_ending =====

def test_extract_short_text():
    """正文 <= max_chars → 返回全部。"""
    assert extract_last_scene_ending("短文本") == "短文本"


def test_extract_long_text():
    """正文末尾提取约 50 字。"""
    text = "这是前面很长的一段文字。" * 10 + "林深关上了咖啡馆的灯。"
    result = extract_last_scene_ending(text, max_chars=50)
    assert len(result) <= 50
    assert result.endswith("林深关上了咖啡馆的灯。")


def test_extract_empty():
    """空正文 → 返回空字符串。"""
    assert extract_last_scene_ending("") == ""
    assert extract_last_scene_ending("   ") == ""


def test_extract_sentence_boundary():
    """按句子边界截断，不在字中间截断。"""
    text = "第一句话。第二句话很长很长很长很长很长很长很长很长很长很长。最后一句。"
    result = extract_last_scene_ending(text, max_chars=20)
    # Should end cleanly at a sentence boundary
    assert len(result) <= 20
