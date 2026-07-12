// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 设定模式 Tool Schema 定义。参见 D-0029、补充 PRD v2 §1.5。 */

import { FACT_TYPE_VALUES, NARRATIVE_WEIGHT_VALUES } from "./enums.js";

// ===========================================================================
// AU 设定模式 — 9 个 tool
// ===========================================================================

const _AU_TOOLS: readonly Record<string, unknown>[] = [
  {
    type: "function",
    function: {
      name: "create_character_file",
      description: "在当前 AU 中创建角色设定文件。如果 Fandom 层有同名角色，自动标记 origin_ref。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "角色名（如 Connor Ellis）" },
          aliases: { type: "array", items: { type: "string" }, description: "别名列表" },
          importance: {
            type: "string",
            enum: ["main", "supporting", "minor"],
            description: "main=主角, supporting=配角, minor=龙套",
          },
          origin_ref: { type: "string", description: "fandom/角色名（来自Fandom）或 original（原创）" },
          content: { type: "string", description: "完整 Markdown 设定内容（含核心人格、核心限制等段落）" },
        },
        required: ["name", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modify_character_file",
      description: "修改当前 AU 中已有的角色设定文件",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "要修改的文件名（如 Connor.md）" },
          new_content: { type: "string", description: "修改后的完整 Markdown 内容" },
          change_summary: { type: "string", description: "本次修改的简要说明" },
        },
        required: ["filename", "new_content", "change_summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_worldbuilding_file",
      description: "在当前 AU 中创建世界观设定文件",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "世界观名称" },
          content: { type: "string", description: "完整 Markdown 内容" },
        },
        required: ["name", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modify_worldbuilding_file",
      description: "修改当前 AU 中已有的世界观设定文件",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string" },
          new_content: { type: "string" },
          change_summary: { type: "string" },
        },
        required: ["filename", "new_content", "change_summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_fact",
      description: "添加事实表条目",
      parameters: {
        type: "object",
        properties: {
          content_raw: { type: "string", description: "原文引用" },
          content_clean: { type: "string", description: "用第三人称客观描述的逻辑抽提" },
          characters: { type: "array", items: { type: "string" }, description: "关联角色名" },
          fact_type: { type: "string", enum: [...FACT_TYPE_VALUES], description: "事实类型" },
          narrative_weight: { type: "string", enum: [...NARRATIVE_WEIGHT_VALUES], description: "叙事权重" },
          status: { type: "string", enum: ["active", "unresolved"] },
        },
        required: ["content_raw", "content_clean", "fact_type", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modify_fact",
      description: "修改已有的事实表条目",
      parameters: {
        type: "object",
        properties: {
          fact_id: { type: "string" },
          content_clean: { type: "string" },
          narrative_weight: { type: "string", enum: [...NARRATIVE_WEIGHT_VALUES] },
          status: { type: "string", enum: ["active", "unresolved", "resolved", "deprecated"] },
        },
        required: ["fact_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_pinned_context",
      description: "添加一条铁律（P0 层，每次续写无条件注入 prompt 顶部）",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "铁律内容，请保持精简" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_writing_style",
      description: "修改文风配置",
      parameters: {
        type: "object",
        properties: {
          field: { type: "string", enum: ["perspective", "emotion_style", "custom_instructions"] },
          value: { type: "string" },
        },
        required: ["field", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_core_includes",
      description: "修改核心绑定列表（P5 低保设定，每次续写必定完整注入的文件）",
      parameters: {
        type: "object",
        properties: {
          filenames: { type: "array", items: { type: "string" }, description: "要绑定的设定文件名列表" },
        },
        required: ["filenames"],
      },
    },
  },
] as const;

// ===========================================================================
// 对话路径 disabled tool 黑名单
// ===========================================================================
// 融合后单一主力版「记忆=自动为主」：对话接受后由 M9 自动提取事实，不给对话加 facts
// 手编工具（add_fact / modify_fact / update_core_includes）。从对话 tool list 物理移除
// （schema 层），LLM 看不到就不会调。单一真相源：黑名单一处定义，对话任何路径都从这里 import。

const SIMPLE_DISABLED_TOOLS: ReadonlySet<string> = new Set(["add_fact", "modify_fact", "update_core_includes"]);

const _SIMPLE_AU_MODIFY_TOOLS: readonly Record<string, unknown>[] = _AU_TOOLS.filter((tool) => {
  const fn = (tool as { function?: { name?: string } }).function;
  const name = fn?.name ?? "";
  return !SIMPLE_DISABLED_TOOLS.has(name);
});

// ===========================================================================
// Fandom 设定模式 — 4 个 tool
// ===========================================================================

const _FANDOM_TOOLS: readonly Record<string, unknown>[] = [
  {
    type: "function",
    function: {
      name: "create_core_character_file",
      description: "创建 Fandom 角色 DNA 档案（core_characters/）",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "角色名" },
          content: { type: "string", description: "完整 Markdown 设定内容" },
        },
        required: ["name", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modify_core_character_file",
      description: "修改已有的 Fandom 角色 DNA 档案",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string" },
          new_content: { type: "string" },
          change_summary: { type: "string" },
        },
        required: ["filename", "new_content", "change_summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_worldbuilding_file",
      description: "创建 Fandom 世界观设定文件",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "世界观名称" },
          content: { type: "string", description: "完整 Markdown 内容" },
        },
        required: ["name", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modify_worldbuilding_file",
      description: "修改已有的 Fandom 世界观设定文件",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string" },
          new_content: { type: "string" },
          change_summary: { type: "string" },
        },
        required: ["filename", "new_content", "change_summary"],
      },
    },
  },
] as const;

// ===========================================================================
// FicForge Lite simple mvp — 查看类工具（不改写状态）
// ===========================================================================

const _SIMPLE_VIEW_TOOLS: readonly Record<string, unknown>[] = [
  {
    type: "function",
    function: {
      name: "show_chapter",
      description:
        "在对话流中折叠展示一个已确认章节的正文（用户可点击展开）。当用户问'看一下第 N 章' / '展示第 N 章' / '让我看看第 N 章'等查看类需求时调用，不改任何文件。",
      parameters: {
        type: "object",
        properties: {
          chapter_num: {
            type: "integer",
            minimum: 1,
            description: "要查看的章节号，必须是已确认的章节（用户的当前章节-1 或更小）",
          },
        },
        required: ["chapter_num"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_setting",
      description:
        "在对话流中折叠展示一个设定文件的正文（用户可点击展开）。当用户问'看一下角色 Alice' / '展示设定 X' / '让我看看世界观'等查看类需求时调用，不改任何文件。",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description:
              "设定文件的相对路径，格式为 '{category}/{filename}.md'。category 取值：'characters' / 'worldbuilding'（AU 层）或 'core_characters' / 'core_worldbuilding'（Fandom 层）。例：'characters/Alice.md' / 'worldbuilding/Magic.md'",
          },
        },
        required: ["file_path"],
      },
    },
  },
] as const;

// ===========================================================================
// FicForge Lite simple mvp — chat_reply 闲聊回答工具
// ===========================================================================
// 简版是对话式 UI：用户消息可能是续写指令、查看 / 修改设定请求、或元问题 / 闲聊 /
// 澄清反问。前三种通过 text 路径（章节）/ show_* tool / modify_* tool 表达；
// 闲聊回答则统一通过 chat_reply tool —— 这样 UI 才能干净区分"AI 是要回答还是
// 写章节"，避免 text 输出无脑被识别为章节草稿。问题 7 修复（2026-05-04）。

const _SIMPLE_REPLY_TOOL: Record<string, unknown> = {
  type: "function",
  function: {
    name: "chat_reply",
    description:
      "向用户输出对话式回答（闲聊 / 元问题 / 澄清反问 / 进度查询等）。当用户的消息不是续写章节、查看 / 修改设定的请求时调用此工具。content 字段填写你要对用户说的话（按用户语言）。不要用此工具输出章节正文 —— 章节正文应直接输出 markdown 文本不调任何工具。",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "你要对用户说的话。建议 100-200 字内，平实自然语气。",
        },
      },
      required: ["content"],
    },
  },
};

// ===========================================================================
// 公共接口
// ===========================================================================

export function get_tools_for_mode(mode: string): Record<string, unknown>[] {
  if (mode === "au") {
    return [..._AU_TOOLS];
  } else if (mode === "fandom") {
    return [..._FANDOM_TOOLS];
  } else if (mode === "simple") {
    // FicForge Lite: 简版有效 AU 修改工具（黑名单过滤后） + 2 个查看类工具 + chat_reply
    return [..._SIMPLE_AU_MODIFY_TOOLS, ..._SIMPLE_VIEW_TOOLS, _SIMPLE_REPLY_TOOL];
  } else {
    throw new Error(`不支持的设定模式: ${mode}`);
  }
}

// ===========================================================================
// 工具名契约（单一真相源，盲审 2026-07-11 架构维）
//
// 此前引擎 schema 用 `name: "add_fact"` 声明、UI 执行器用 `toolName === "add_fact"`
// 分派，两侧是独立字面量 —— 只改一侧则 LLM 工具调用静默落空且无编译错误。
// 现在：UI 分派点以本联合类型窄化 + assertNever 收尾（改名/漏分支即编译红）；
// 与上方工具定义的字面量之间由 settings_tools.test 的集合相等断言锁双向漂移。
// ===========================================================================

/** 全部修改类设定工具（AU 9 个 + Fandom core_* 2 个；view/chat_reply 不在内）。 */
export const SETTINGS_MUTATING_TOOL_NAMES = [
  "create_character_file",
  "modify_character_file",
  "create_worldbuilding_file",
  "modify_worldbuilding_file",
  "add_fact",
  "modify_fact",
  "add_pinned_context",
  "update_writing_style",
  "update_core_includes",
  "create_core_character_file",
  "modify_core_character_file",
] as const;

export type SettingsMutatingToolName = (typeof SETTINGS_MUTATING_TOOL_NAMES)[number];

export function isSettingsMutatingToolName(name: string): name is SettingsMutatingToolName {
  return (SETTINGS_MUTATING_TOOL_NAMES as readonly string[]).includes(name);
}

/** 简版对话可执行的修改类工具（= get_tools_for_mode("simple") 的修改类子集）。 */
export const SIMPLE_MUTATING_TOOL_NAMES = [
  "create_character_file",
  "modify_character_file",
  "create_worldbuilding_file",
  "modify_worldbuilding_file",
  "add_pinned_context",
  "update_writing_style",
] as const;

export type SimpleMutatingToolName = (typeof SIMPLE_MUTATING_TOOL_NAMES)[number];

export function isSimpleMutatingToolName(name: string): name is SimpleMutatingToolName {
  return (SIMPLE_MUTATING_TOOL_NAMES as readonly string[]).includes(name);
}
