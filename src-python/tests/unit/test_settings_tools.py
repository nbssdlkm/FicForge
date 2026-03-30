"""设定模式 Tool Schema 单元测试。"""

from core.domain.settings_tools import get_tools_for_mode


class TestToolSchemaFormat:
    def test_au_tools_count(self):
        tools = get_tools_for_mode("au")
        assert len(tools) == 9

    def test_fandom_tools_count(self):
        tools = get_tools_for_mode("fandom")
        assert len(tools) == 4

    def test_invalid_mode_raises(self):
        import pytest
        with pytest.raises(ValueError):
            get_tools_for_mode("invalid")

    def test_openai_format(self):
        """所有 tool 符合 OpenAI function calling 格式。"""
        for mode in ("au", "fandom"):
            for tool in get_tools_for_mode(mode):
                assert tool["type"] == "function"
                func = tool["function"]
                assert "name" in func
                assert "description" in func
                assert "parameters" in func
                params = func["parameters"]
                assert params["type"] == "object"
                assert "properties" in params
                assert "required" in params

    def test_au_tool_names(self):
        names = {t["function"]["name"] for t in get_tools_for_mode("au")}
        expected = {
            "create_character_file", "modify_character_file",
            "create_worldbuilding_file", "modify_worldbuilding_file",
            "add_fact", "modify_fact",
            "add_pinned_context",
            "update_writing_style", "update_core_includes",
        }
        assert names == expected

    def test_fandom_tool_names(self):
        names = {t["function"]["name"] for t in get_tools_for_mode("fandom")}
        expected = {
            "create_core_character_file", "modify_core_character_file",
            "create_worldbuilding_file", "modify_worldbuilding_file",
        }
        assert names == expected

    def test_no_delete_tools(self):
        """D-0029: AU tools 中没有 delete 类操作。"""
        for tool in get_tools_for_mode("au"):
            name = tool["function"]["name"]
            assert "delete" not in name.lower()

        for tool in get_tools_for_mode("fandom"):
            name = tool["function"]["name"]
            assert "delete" not in name.lower()

    def test_returns_copy(self):
        """get_tools_for_mode 返回副本，不是引用。"""
        tools1 = get_tools_for_mode("au")
        tools2 = get_tools_for_mode("au")
        assert tools1 is not tools2
