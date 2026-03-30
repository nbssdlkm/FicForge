"""设定模式上下文组装 + 响应解析单元测试。"""

from __future__ import annotations

from pathlib import Path

import pytest

from core.services.settings_chat import (
    _extract_dna_summary,
    _truncate_history,
    build_settings_context,
)


# ===== 对话历史截断 =====

class TestTruncateHistory:
    def test_short_history_unchanged(self):
        msgs = [{"role": "user", "content": f"msg{i}"} for i in range(6)]
        result = _truncate_history(msgs)
        assert len(result) == 6

    def test_exact_limit_unchanged(self):
        msgs = [{"role": "user", "content": f"msg{i}"} for i in range(10)]
        result = _truncate_history(msgs)
        assert len(result) == 10

    def test_over_limit_truncated(self):
        msgs = [{"role": "user", "content": f"msg{i}"} for i in range(16)]
        result = _truncate_history(msgs)
        assert len(result) == 10
        # 保留最后 10 条
        assert result[0]["content"] == "msg6"
        assert result[-1]["content"] == "msg15"

    def test_empty_history(self):
        assert _truncate_history([]) == []


# ===== DNA 摘要提取 =====

class TestExtractDnaSummary:
    def test_with_core_section(self):
        content = "# Connor\n\n## 核心本质\n性格底色：温柔但坚定\n\n## 外部设定\n侦探"
        result = _extract_dna_summary(content)
        assert "核心本质" in result
        assert "温柔但坚定" in result
        assert "外部设定" not in result

    def test_with_core_traits(self):
        content = "# Hank\n\n## 核心特质\n暴躁但心软\n\n## 历史\n退伍军人"
        result = _extract_dna_summary(content)
        assert "核心特质" in result
        assert "暴躁但心软" in result

    def test_fallback_no_section(self):
        content = "# Simple character\nJust a description."
        result = _extract_dna_summary(content)
        assert "Simple character" in result

    def test_long_content_truncated(self):
        content = "## 核心本质\n" + "x" * 3000
        result = _extract_dna_summary(content, max_chars=100)
        assert len(result) <= 110  # 100 + "…" + header

    def test_empty_content(self):
        assert _extract_dna_summary("") == ""


# ===== 上下文组装 =====

class TestBuildSettingsContext:
    @pytest.fixture
    def au_env(self, tmp_path: Path) -> dict[str, Path]:
        fandom_dir = tmp_path / "TestFandom"
        au_dir = tmp_path / "TestAU"

        # Fandom core_characters
        chars_dir = fandom_dir / "core_characters"
        chars_dir.mkdir(parents=True)
        (chars_dir / "Connor.md").write_text(
            "# Connor\n\n## 核心本质\n性格温柔但坚定，永不放弃。\n\n## 外部\n侦探",
            encoding="utf-8",
        )

        # AU project.yaml
        au_dir.mkdir(parents=True)
        (au_dir / "project.yaml").write_text(
            "name: TestAU\nfandom: TestFandom\n"
            "cast_registry:\n  characters:\n    - Connor\n    - Hank\n"
            "pinned_context:\n  - '不要道歉'\n"
            "writing_style:\n  perspective: third_person\n  emotion_style: implicit\n",
            encoding="utf-8",
        )

        return {"fandom_dir": fandom_dir, "au_dir": au_dir}

    def test_au_mode_includes_system_prompt(self, au_env: dict[str, Path]):
        msgs = [{"role": "user", "content": "帮我创建一个角色"}]
        result = build_settings_context(
            "au", str(au_env["au_dir"]), str(au_env["fandom_dir"]), msgs
        )
        system = result[0]
        assert system["role"] == "system"
        assert "设定管理助手" in system["content"]
        assert "TestAU" in system["content"]

    def test_au_mode_includes_dna_summary(self, au_env: dict[str, Path]):
        result = build_settings_context(
            "au", str(au_env["au_dir"]), str(au_env["fandom_dir"]),
            [{"role": "user", "content": "test"}],
        )
        system_content = result[0]["content"]
        assert "Connor" in system_content
        assert "核心本质" in system_content

    def test_au_mode_includes_cast_and_pinned(self, au_env: dict[str, Path]):
        result = build_settings_context(
            "au", str(au_env["au_dir"]), str(au_env["fandom_dir"]),
            [{"role": "user", "content": "test"}],
        )
        system_content = result[0]["content"]
        assert "Connor" in system_content
        assert "Hank" in system_content
        assert "不要道歉" in system_content

    def test_fandom_mode_simple(self, au_env: dict[str, Path]):
        result = build_settings_context(
            "fandom", str(au_env["fandom_dir"]), None,
            [{"role": "user", "content": "帮我分析角色"}],
        )
        system = result[0]
        assert "Fandom 设定管理助手" in system["content"]
        # Fandom 模式不含 AU 信息（cast_registry、当前铁律列表）
        assert "当前角色列表" not in system["content"]
        assert "当前铁律" not in system["content"]

    def test_fandom_mode_no_au_context(self, au_env: dict[str, Path]):
        result = build_settings_context(
            "fandom", str(au_env["fandom_dir"]), None,
            [{"role": "user", "content": "test"}],
        )
        system_content = result[0]["content"]
        assert "pinned" not in system_content.lower()

    def test_messages_appended(self, au_env: dict[str, Path]):
        msgs = [
            {"role": "user", "content": "你好"},
            {"role": "assistant", "content": "你好！"},
        ]
        result = build_settings_context(
            "fandom", str(au_env["fandom_dir"]), None, msgs
        )
        # system + 2 messages
        assert len(result) == 3
        assert result[1]["role"] == "user"
        assert result[2]["role"] == "assistant"

    def test_history_truncation(self, au_env: dict[str, Path]):
        msgs = [{"role": "user", "content": f"msg{i}"} for i in range(20)]
        result = build_settings_context(
            "fandom", str(au_env["fandom_dir"]), None, msgs
        )
        # system + 10 truncated messages
        assert len(result) == 11
