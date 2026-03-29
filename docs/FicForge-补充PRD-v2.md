# FicForge · 粮坊 — 补充 PRD v2

> 本文档补充主 PRD（docs/fanfic-system-PRD-v2.md）中未覆盖或需要修正的功能设计。
> 优先级标注：🔴 Phase 1.1 必须 / 🟡 Phase 2 建议 / 🟢 Phase 3 可选
> 
> ⚠️ 本文档中关于 Fandom-AU 角色关系的设计**取代**主 PRD 中的 character_overrides 机制。

---

## 0. Fandom-AU 角色关系模型（架构修正）

### 0.1 核心理念

**Fandom 角色是人格 DNA，AU 角色是基于 DNA 的全新个体。**

同人创作的本质是：保留角色的人格内核（性格底色、行为模式、关系动力学），在完全不同的世界背景下重新演绎。这不是"修改几个字段"的继承关系，而是"基于同一灵魂的重新创作"。

示例：

```
Fandom 层 Connor 的人格 DNA：
  - 战略共情者（用理性算计执行"爱"）
  - 隐性控制欲与占有欲
  - 极致可靠但背负道德十字架
  - 表面温和得体，内在时刻掌控全局

AU "现代咖啡馆" 的 Connor：
  - 同样的 DNA → 咖啡馆新手，认真但天然呆
  - 控制欲表现为：把每杯咖啡的配方精确到毫升

AU "星际皇室" 的 Connor：
  - 同样的 DNA → 皇帝 Connor Ellis，Alpha，31岁
  - 战略共情表现为：用信息素和政治手腕维护秩序
  - 控制欲表现为：对双胞胎弟弟 Colin 的隐性掌控
```

三个 Connor 共享人格 DNA，但设定文件完全不同——不是"改几行"能解决的。

### 0.2 取消的概念

| 取消 | 原因 |
|------|------|
| ~~character_overrides/ 目录~~ | 覆写机制不适用于同人 AU——差异太大，覆写等于重写 |
| ~~Fandom → AU 继承关系~~ | 无法定义"哪些继承哪些不继承"，用户也不想管 |
| ~~"Fandom 修改影响所有 AU"~~ | AU 角色是独立个体，不应被 Fandom 层修改波及 |

### 0.3 新的模型

```
Fandom 层 = 创作者的角色知识库（人格 DNA 模板）
  core_characters/Connor.md    ← "我对 Connor 这个角色的理解"
  core_characters/Hank.md      ← "我对 Hank 的理解"  
  worldbuilding/仿生人社会.md   ← 原作世界观笔记

  作用：
    ① 用户自己回顾参考
    ② AI 设定模式的参考上下文
    ③ 新建 AU 时的素材来源
    ④ 不直接注入任何 AU 的 prompt（除非 AU 显式复制）

AU 层 = 独立的完整设定
  characters/Connor.md          ← 本 AU 的 Connor（独立文件）
  characters/Colin.md           ← 本 AU 原创角色
  worldbuilding/圣锚星系.md     ← 本 AU 的世界观

  作用：
    ① 实际被 RAG 检索和 P5 注入的内容
    ② 用户可自由编辑，不影响 Fandom 层和其他 AU

两者的关系 = "DNA 供体 → 新个体"，不是"父类 → 子类"
```

### 0.4 目录结构变更

```
原设计：
  AU/
    character_overrides/    ← 取消
    original_characters/    ← 取消

新设计：
  AU/
    characters/             ← 所有角色（不分来源）
      Connor.md             ← origin_ref: fandom/Connor
      Colin.md              ← origin_ref: original
    worldbuilding/          ← 所有世界观（不分来源）
      圣锚星系.md            ← origin_ref: original
```

角色 frontmatter 新增 `origin_ref` 字段：

```yaml
---
name: Connor Ellis
aliases: [皇帝陛下, Connor]
importance: high
origin_ref: fandom/Connor    # 标记灵感来源，纯元数据，无功能绑定
---
```

- `origin_ref: fandom/{name}` → 从 Fandom 层适配而来
- `origin_ref: original` → 本 AU 原创
- `origin_ref` 缺失 → 视为 original

此字段仅用于 UI 展示（如角色卡片上显示"源自 Fandom"标签）和统计，不影响任何运行时逻辑。

### 0.5 新建 AU 角色的三种方式

**方式一：AI 适配（推荐）**

```
用户在 AU 设定模式：
"这个 AU 的 Connor 是星际皇室的皇帝，Alpha，和弟弟 Colin 关系复杂"

AI 读取 Fandom 层 Connor 的 DNA，生成 AU 版本：
  → 保留人格内核（战略共情、控制欲、占有欲）
  → 重新包装外部设定（皇帝身份、信息素、星际背景）
  → 用户审阅确认后保存为 AU/characters/Connor.md
```

**方式二：直接复制（原作向 AU）**

```
用户："这个 AU 就是原作设定，不改"

系统直接复制 Fandom/core_characters/Connor.md 
  → AU/characters/Connor.md（独立副本）
  → 后续修改不影响 Fandom 层
```

**方式三：从零创建**

```
用户手动创建或粘贴设定文本
  → AI 辅助提取 frontmatter
  → 保存为 AU/characters/xxx.md
```

### 0.6 Fandom 层修改的影响

**Fandom 层修改不会自动影响任何 AU。**

- 用户在 Fandom 层更新了 Connor 的人格分析 → 已有 AU 的 Connor 不变
- 用户在 Fandom 层新增了角色 → 已有 AU 不会自动出现该角色
- 用户删除 Fandom 层角色 → 已有 AU 的对应角色不受影响

但系统可以提供**可选的同步提示**（Phase 2）：

```
"Fandom 层的 Connor.md 已更新。
 以下 AU 中有基于此角色的设定：
   - 现代咖啡馆 AU
   - 星际皇室 AU
 是否查看差异？"
 [查看] [忽略]
```

### 0.7 对 RAG 和上下文组装的影响

```
原设计：
  P4 RAG 检索 characters collection → 包含 Fandom + AU 的角色 chunks
  P5 核心设定 → 合并 Fandom 设定 + AU 覆写

新设计：
  P4 RAG 检索 characters collection → 只包含 AU/characters/ 的 chunks
  P5 核心设定 → 只读 AU/characters/ 下的设定
  Fandom 层设定不参与任何 AU 的 prompt 组装

ChromaDB collection 简化：
  每个 AU 只索引自己目录下的文件
  Fandom 层的文件不索引到任何 AU 的 collection
```

### 0.8 对 cast_registry 的影响

```
原设计：
  project.yaml cast_registry 引用 Fandom + AU 的角色

新设计：
  project.yaml cast_registry 只引用 AU/characters/ 下的角色
  角色名来源：AU/characters/*.md 的 frontmatter name + aliases
  Fandom 层角色不自动出现在 cast_registry 中
```

---

## 1. 写作/设定双模式切换

### 1.1 概述

写作界面增加模式切换按钮，在"写作模式"和"设定模式"之间切换。两种模式共享同一个 UI 布局（输入框 + 正文区 + 侧边栏），但 AI 的行为完全不同。

**优先级：🔴 Phase 1.1**

### 1.2 模式定义

| 维度 | ✍️ 写作模式（默认） | 🔧 设定模式 |
|------|-------------------|------------|
| AI 输出 | 章节正文（小说文本） | 结构化设定变更建议 |
| 输入框 placeholder | "输入指令或留空直接续写..." | "描述你想要的设定变更..." |
| AI system prompt | 写作助手（PRD §4.1 的 P0 层） | 设定管理助手（见 1.4） |
| AI 可操作范围 | 只写正文 | 可修改设定文件、facts、pinned_context 等 |
| 输出呈现 | 打字机效果流式渲染 | 变更清单卡片（用户逐条确认） |
| 确认流程 | 确认这一章 / 丢弃 | 逐条确认 / 全部确认 / 编辑后确认 / 丢弃 |

### 1.3 UI 设计

```
┌──────────────────────────────────────────────────┐
│ [✍️ 写作] [🔧 设定]          ← 顶部切换按钮组     │
├──────────────────────────────────────────────────┤
│                                                  │
│  写作模式：正文区（打字机渲染）                     │
│  设定模式：变更清单（确认卡片）                     │
│                                                  │
├──────────────────────────────────────────────────┤
│ 输入框                              [发送]        │
└──────────────────────────────────────────────────┘
```

切换时：
- 不清空当前正文（写作模式的草稿保留）
- 不清空设定模式的历史对话
- 切换按钮旁显示当前模式名称，避免用户混淆
- 首次切换到设定模式时显示引导提示（一次性）：
  "在设定模式中，你可以用自然语言描述设定需求，AI 会帮你创建和修改角色设定、世界观、事实表等文件。所有变更需要你确认后才会生效。"

### 1.4 设定模式的实现方案：Tool Calling

**为什么不让 AI 手写 JSON：** LLM 手写 JSON 经常格式错误（漏括号、多逗号），且角色名可能和 cast_registry 不一致。

**方案：使用 LLM 原生的 tool calling 功能。** AI 不写 JSON，而是返回"我想调用哪个函数、用什么参数"——这是 DeepSeek/GPT/Claude 都原生支持的结构化输出能力，可靠性远高于手写 JSON。

**核心原则：AI 只建议，不执行。** AI 返回 tool_calls 列表，前端将其渲染为确认卡片，用户确认后前端调用对应 API。AI 没有任何直接读写文件的权限。

### 1.5 Tool 定义

设定模式的 LLM 请求中附带以下 tools（OpenAI 兼容格式）：

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "create_character_file",
        "description": "在当前 AU 中创建角色设定文件。如果 Fandom 层有同名角色，自动标记 origin_ref。",
        "parameters": {
          "type": "object",
          "properties": {
            "name": { "type": "string", "description": "角色名（如 Connor Ellis）" },
            "aliases": { "type": "array", "items": {"type": "string"}, "description": "别名列表" },
            "importance": { "type": "string", "enum": ["high", "medium", "low"] },
            "origin_ref": { "type": "string", "description": "fandom/角色名（来自Fandom）或 original（原创）" },
            "content": { "type": "string", "description": "完整 Markdown 设定内容（含核心人格、核心限制等段落）" }
          },
          "required": ["name", "content"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "modify_character_file",
        "description": "修改当前 AU 中已有的角色设定文件",
        "parameters": {
          "type": "object",
          "properties": {
            "filename": { "type": "string", "description": "要修改的文件名（如 Connor.md）" },
            "new_content": { "type": "string", "description": "修改后的完整 Markdown 内容" },
            "change_summary": { "type": "string", "description": "本次修改的简要说明" }
          },
          "required": ["filename", "new_content", "change_summary"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "create_worldbuilding_file",
        "description": "在当前 AU 中创建世界观设定文件",
        "parameters": {
          "type": "object",
          "properties": {
            "name": { "type": "string", "description": "世界观名称" },
            "content": { "type": "string", "description": "完整 Markdown 内容" }
          },
          "required": ["name", "content"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "modify_worldbuilding_file",
        "description": "修改当前 AU 中已有的世界观设定文件",
        "parameters": {
          "type": "object",
          "properties": {
            "filename": { "type": "string" },
            "new_content": { "type": "string" },
            "change_summary": { "type": "string" }
          },
          "required": ["filename", "new_content", "change_summary"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "add_fact",
        "description": "添加事实表条目",
        "parameters": {
          "type": "object",
          "properties": {
            "content_raw": { "type": "string", "description": "原文引用" },
            "content_clean": { "type": "string", "description": "用第三人称客观描述的逻辑抽提" },
            "characters": { "type": "array", "items": {"type": "string"}, "description": "关联角色名" },
            "fact_type": { "type": "string", "enum": ["plot_event", "character_detail", "relationship", "worldbuilding", "foreshadowing"] },
            "narrative_weight": { "type": "string", "enum": ["low", "medium", "high"] },
            "status": { "type": "string", "enum": ["active", "unresolved"] }
          },
          "required": ["content_raw", "content_clean", "fact_type", "status"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "modify_fact",
        "description": "修改已有的事实表条目",
        "parameters": {
          "type": "object",
          "properties": {
            "fact_id": { "type": "string" },
            "content_clean": { "type": "string" },
            "narrative_weight": { "type": "string", "enum": ["low", "medium", "high"] },
            "status": { "type": "string", "enum": ["active", "unresolved", "resolved", "deprecated"] }
          },
          "required": ["fact_id"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "add_pinned_context",
        "description": "添加一条铁律（P0 层，每次续写无条件注入 prompt 顶部）",
        "parameters": {
          "type": "object",
          "properties": {
            "content": { "type": "string", "description": "铁律内容，请保持精简" }
          },
          "required": ["content"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "update_writing_style",
        "description": "修改文风配置",
        "parameters": {
          "type": "object",
          "properties": {
            "field": { "type": "string", "enum": ["perspective", "emotion_style", "custom_instructions"] },
            "value": { "type": "string" }
          },
          "required": ["field", "value"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "update_core_includes",
        "description": "修改核心绑定列表（P5 低保设定，每次续写必定完整注入的文件）",
        "parameters": {
          "type": "object",
          "properties": {
            "filenames": { "type": "array", "items": {"type": "string"}, "description": "要绑定的设定文件名列表" }
          },
          "required": ["filenames"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

**AI 没有 delete 类 tool。** 删除操作必须由用户在 UI 上手动执行，不允许 AI 建议删除。

### 1.6 设定模式的 AI System Prompt

```
你是 FicForge 的设定管理助手。用户正在配置 AU "{au_name}"（属于 Fandom "{fandom_name}"）。

你的职责：
1. 理解用户用自然语言描述的设定需求
2. 通过 tool calling 返回具体的操作建议
3. 同时用自然语言向用户解释你的建议

你有以下工具可用（但你不会直接执行，用户需要确认后才会执行）：
- create_character_file / modify_character_file（角色设定）
- create_worldbuilding_file / modify_worldbuilding_file（世界观）
- add_fact / modify_fact（事实表）
- add_pinned_context（铁律）
- update_writing_style（文风）
- update_core_includes（核心绑定）

你不能操作的（需要提示用户去 Fandom 设定库操作）：
- Fandom 核心角色 DNA 档案（core_characters/）
- Fandom 世界观笔记（worldbuilding/）

参考上下文：
- 你可以读取 Fandom 层的角色 DNA 档案，作为理解角色人格内核的参考
- 但你的建议产出的文件保存在 AU 层，不影响 Fandom 层

当用户想基于 Fandom 角色创建 AU 版本时：
- 读取 Fandom 层的人格 DNA
- 保留内核特质（性格底色、行为模式、关系动力学）
- 根据用户描述的 AU 背景重新包装外部设定
- 用 create_character_file 工具输出全新的独立设定文件
- origin_ref 设为 "fandom/{原始角色名}"

当用户粘贴大段文本时：
- 提取 frontmatter 元数据（name / aliases / importance）
- 识别并标注"## 核心限制"段落
- 保留原文完整性，不删减用户内容
- 如果 Fandom 层有同名角色 → origin_ref 设为 fandom/{name}

回复格式：
- 先用自然语言简要说明你的建议
- 然后通过 tool_calls 返回具体操作
- 两者都要有——自然语言让用户理解意图，tool_calls 让前端执行
```

### 1.7 LLM 返回示例

```json
{
  "content": "我基于 Fandom 层 Connor 的人格 DNA（战略共情者、隐性控制欲），为你的星际皇室 AU 创建了角色设定。保留了人格内核，重新包装为皇帝身份。同时添加了 Connor 和 Colin 的关系事实和当前状态的铁律。",
  "tool_calls": [
    {
      "id": "call_1",
      "type": "function",
      "function": {
        "name": "create_character_file",
        "arguments": "{\"name\":\"Connor Ellis\",\"aliases\":[\"皇帝陛下\",\"Connor\"],\"importance\":\"high\",\"origin_ref\":\"fandom/Connor\",\"content\":\"# Connor Ellis\\n\\n## 基本信息\\n姓名：Connor Ellis\\n爵位：皇帝陛下，圣锚星系最高统治者\\n年龄：31岁\\n第二性别：Alpha\\n\\n## 核心人格\\n战略共情者。本质是系统的终极维护者与优化者...\\n\\n## 核心限制\\n- 绝不会在公开场合表露对 Colin 的私人情感\\n- 所有决策必须通过理性计算论证\"}"
      }
    },
    {
      "id": "call_2",
      "type": "function",
      "function": {
        "name": "add_fact",
        "arguments": "{\"content_raw\":\"Connor 和 Colin 是双胞胎兄弟，关系经历了激烈对抗到热恋的演变\",\"content_clean\":\"Connor Ellis 与其双生弟弟 Colin 为双生兄弟，关系经历对抗→信任危机→权力让渡→热恋黏糊的完整演变\",\"characters\":[\"Connor Ellis\",\"Colin\"],\"fact_type\":\"relationship\",\"narrative_weight\":\"high\",\"status\":\"active\"}"
      }
    },
    {
      "id": "call_3",
      "type": "function",
      "function": {
        "name": "add_pinned_context",
        "arguments": "{\"content\":\"Connor 和 Colin 目前处于热恋期，正面临'圣所'生育计划的首要压力\"}"
      }
    }
  ]
}
```

### 1.8 前端处理流程

```
LLM 返回 response
        ↓
1. 提取 response.content → 展示为 AI 的自然语言说明
2. 提取 response.tool_calls → 渲染为确认卡片列表
3. 如果 tool_calls 为空 → 只展示文字（AI 选择不调用工具，可能在提问或说明）
```

**别名归一化**（确认前执行）：
- tool_call 参数中的角色名（如 characters 数组），和 cast_registry 比对
- 如果"康纳"是"Connor Ellis"的别名 → 自动替换为主名
- 归一化失败（未注册的角色名）→ 保持原样，不阻断

**重复检测**（确认前执行）：
- create_character_file 的 name 已存在于 AU/characters/ → 卡片上显示警告："⚠️ Connor.md 已存在" + 改为 [覆盖] [改为修改] [跳过]
- add_pinned_context 的内容和现有铁律高度重复 → 卡片上显示提示："⚠️ 已有相似铁律"

### 1.9 前端变更确认 UI

```
┌─────────────────────────────────────────────────┐
│ AI 说：                                          │
│ "我基于 Fandom 层 Connor 的人格 DNA，为你的        │
│  星际皇室 AU 创建了角色设定..."                     │
│                                                  │
│ AI 建议以下操作：                                  │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ 📄 create_character_file                      │ │
│ │ 创建角色：Connor Ellis                         │ │
│ │ 皇帝陛下，圣锚星系最高统治者，Alpha，31岁...   │ │
│ │         [✅ 确认] [✏️ 编辑] [⏭️ 跳过]         │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ 📋 add_fact                                   │ │
│ │ Connor Ellis 与 Colin 为双生兄弟...            │ │
│ │         [✅ 确认] [✏️ 编辑] [⏭️ 跳过]         │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ 📌 add_pinned_context                         │ │
│ │ "Connor 和 Colin 目前处于热恋期..."            │ │
│ │         [✅ 确认] [✏️ 编辑] [⏭️ 跳过]         │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│           [全部确认] [全部跳过]                    │
└─────────────────────────────────────────────────┘
```

### 1.10 [编辑] 按钮行为

用户点 [编辑] 后，根据 tool 类型打开不同的编辑器。用户修改后的内容替换 AI 原始输出，确认时用修改后的版本调 API。

| tool 名称 | 编辑器类型 | 可编辑字段 |
|-----------|----------|----------|
| create_character_file | Modal 内 Markdown 编辑器 | name、aliases、importance、content 全部可改 |
| modify_character_file | Modal 内 Markdown 编辑器 | new_content、change_summary 可改 |
| create_worldbuilding_file | Modal 内 Markdown 编辑器 | name、content 可改 |
| modify_worldbuilding_file | Modal 内 Markdown 编辑器 | new_content 可改 |
| add_fact | Facts 编辑表单（和新建 Fact 弹窗一致） | 所有字段可改 |
| modify_fact | Facts 编辑表单 | 所有字段可改 |
| add_pinned_context | 单行/多行文本输入框 | content 可改 |
| update_writing_style | 对应字段的下拉选择器或文本框 | value 可改 |
| update_core_includes | 文件多选列表（从 AU/characters/ 列出） | filenames 可改 |

**确认后执行**：
- 逐条调用对应的后端 API（tool 名称 → API 端点映射见 §5）
- 每条显示执行结果（✅ 成功 / ❌ 失败 + 错误原因）
- 失败的条目可重试
- 全部执行完成后，更新 cast_registry 和 ChromaDB 索引

### 1.11 Tool 名称 → API 端点映射

| Tool | 前端调用的 API |
|------|-------------|
| create_character_file | POST /api/v1/lore (category=characters) |
| modify_character_file | PUT /api/v1/lore (category=characters) |
| create_worldbuilding_file | POST /api/v1/lore (category=worldbuilding) |
| modify_worldbuilding_file | PUT /api/v1/lore (category=worldbuilding) |
| add_fact | POST /api/v1/facts |
| modify_fact | PUT /api/v1/facts/{fact_id} |
| add_pinned_context | POST /api/v1/pinned |
| update_writing_style | PUT /api/v1/project (writing_style 字段) |
| update_core_includes | PUT /api/v1/project (core_always_include 字段) |

### 1.12 设定模式的对话历史

- 设定模式保留本次会话的对话历史（和写作模式独立）
- 用户可以多轮对话逐步完善设定
- 对话历史仅存内存（关闭 AU 后清空），不持久化
- 每轮对话 AI 的上下文包含：
  - Fandom 层角色 DNA（cast_registry 中有 origin_ref: fandom/* 的角色，读取 Fandom 层对应文件）
  - 当前 AU 的 cast_registry 列表
  - 当前 AU 的 pinned_context
  - 之前已确认的变更摘要
  - 不包含章节正文（设定模式不需要）

### 1.13 大文本导入流程

当用户在设定模式中粘贴超过 500 字的文本时：

```
用户粘贴 3000 字的角色设定
                    ↓
前端检测到长文本，在输入框上方弹出：
"检测到大段文本，如何处理？"
  [📄 导入为角色设定] [🌍 导入为世界观] [💬 作为普通指令发送]
                    ↓
选择"导入为角色设定"后，AI 分析文本：
1. 提取角色名 → frontmatter name
2. 识别别名 → frontmatter aliases
3. 判断重要性 → frontmatter importance
4. 识别核心限制段落 → 标注 ## 核心限制
5. 保留原文完整内容（不删减任何用户文字）
6. 如果 Fandom 层有同名角色 → 自动设置 origin_ref: fandom/{name}
                    ↓
展示变更确认卡片：
"将创建角色设定文件：
 - 文件名：Connor.md
 - name: Connor Ellis
 - aliases: 皇帝陛下, Connor
 - importance: high
 - 核心限制已识别：2 段
 - 来源：基于 Fandom/Connor 适配
 
 [✅ 确认创建] [✏️ 编辑后创建] [⏭️ 取消]"
                    ↓
确认后：
1. 保存 .md 文件到 AU/characters/
2. 自动向量化存入 ChromaDB
3. 自动注册到 cast_registry
4. 如果识别到关系信息 → 建议创建对应 facts
```

### 1.14 设定模式的上下文组装策略

设定模式的 AI 不需要和写作模式相同的六层上下文，使用精简版：

```
设定模式 prompt 组装：
  System: 设定管理助手 prompt（见 1.6）+ tool 定义（见 1.5）
  
  上下文注入：
    1. Fandom 角色 DNA 摘要（每个角色取 ## 核心本质 段落，非全文）
    2. AU cast_registry 列表（角色名 + aliases + importance）
    3. AU pinned_context 列表
    4. AU writing_style 配置
    5. 本次对话历史（含之前的 tool_calls 和确认结果）
    6. 本次已确认的变更摘要
  
  不注入：
    - 章节正文（设定模式不需要）
    - facts 全文（只在用户提到事实表时按需注入摘要）
    - RAG 检索结果（设定模式不触发 RAG）
  
  token 预算：
    - Fandom DNA 摘要：每个角色最多 500 token（取 ## 核心本质 或 ## 核心特质 段落）
    - cast_registry：通常很短（<200 token）
    - pinned_context：通常 <500 token
    - 对话历史：保留最近 5 轮，超出则截断最早的轮次
    - 总计预估：2000-4000 token（远小于写作模式的 P0-P5 组装）
```

### 1.15 设定模式的"撤销"

设定模式**不提供 undo 按钮**（复杂度太高——文件创建、facts 添加、铁律修改是异构操作，无法统一回滚）。

**兜底机制：**
- 所有通过设定模式确认的操作都写入 ops.jsonl（op_type 为对应操作类型）
- 文件创建/修改 → 用户可在 UI 上手动删除（走垃圾箱）
- 事实添加 → 用户可在 Facts 面板标记 deprecated
- 铁律添加 → 用户可在 AU Settings 直接删除
- 垃圾箱提供 30 天内恢复

**设定模式确认卡片的"已确认"状态：**

```
确认后卡片变为灰色，显示执行结果：
┌──────────────────────────────────────────────┐
│ ✅ 已创建：Connor Ellis (characters/Connor.md) │
│                               [↩️ 撤销此项]   │
└──────────────────────────────────────────────┘
```

[撤销此项] 按钮行为：
- create_file → 删除刚创建的文件（移入垃圾箱）
- add_fact → 将刚添加的 fact 标记 deprecated
- add_pinned → 删除刚添加的铁律
- modify_file → 无法撤销（没有保存旧版本），显示"请手动编辑恢复"

此撤销仅在当前会话内可用（卡片还在屏幕上时）。离开页面后通过垃圾箱恢复。

### 1.16 新建 AU 时的默认设定与引导

当用户新建一个 AU 后，系统自动完成：

```
1. 创建 AU 目录结构：
   characters/
   worldbuilding/
   chapters/main/
   .drafts/
   .trash/

2. 初始化 project.yaml（默认值）
3. 初始化 state.yaml（current_chapter=1）
4. cast_registry 为空（不自动继承 Fandom）
5. core_always_include 为空
6. writing_style 使用全局默认值
```

创建完成后弹出引导：

```
┌───────────────────────────────────────────┐
│ 🎉 AU "星际皇室" 已创建！                  │
│                                           │
│ 接下来你想？                               │
│                                           │
│ [🤖 用 AI 设定模式快速配置]                │
│    描述你的 AU 设定，AI 帮你创建角色和世界观  │
│                                           │
│ [📥 从 Fandom 导入角色]                    │
│    选择已有的角色设定复制到本 AU             │
│                                           │
│ [✍️ 直接开始写作]                          │
│    跳过配置，边写边加                       │
│                                           │
└───────────────────────────────────────────┘
```

选择"用 AI 设定模式快速配置"：
- 直接进入写作界面的设定模式
- 输入框自动聚焦
- 提示："描述这个 AU 的背景设定和主要角色..."

选择"从 Fandom 导入角色"：
- 弹出 Fandom 角色列表（多选）
- 选中的角色文件复制到 AU/characters/（origin_ref: fandom/{name}）
- 复制后打开 AU Lore 页面让用户修改

选择"直接开始写作"：
- 进入写作界面写作模式
- 侧边栏提示："还没有配置角色和设定，AI 续写的质量可能不佳。随时切换到 🔧 设定模式配置。"

---

## 2. Fandom 设定模式

### 2.1 概述

Fandom 层拥有独立的 AI 设定助手，用于管理角色 DNA 档案和世界观笔记。入口在 Fandom 设定库页面。

**优先级：🔴 Phase 1.1**

### 2.2 Fandom 层的定位

Fandom 层是**创作者的个人角色知识库**，不是"所有 AU 的公共设定层"。

| 用途 | 说明 |
|------|------|
| 用户自己回顾参考 | "我对 Connor 这个角色的核心理解是什么？" |
| AI 设定模式的参考 | AI 读取 DNA 档案来理解角色内核，帮用户在新 AU 中适配 |
| 新建 AU 时的素材来源 | 用户可选择从 Fandom 导入角色到 AU |
| 不直接参与任何 AU 的运行时 | Fandom 设定不注入 prompt、不参与 RAG、不影响 AI 写作 |

### 2.3 Fandom AI 的 System Prompt

```
你是 FicForge 的 Fandom 设定管理助手。用户正在整理 Fandom "{fandom_name}" 的角色知识库。

这里存放的是用户对原作角色的人格分析和理解，作为所有 AU 创作的参考素材。

你可以建议的操作：
- 创建/修改核心角色 DNA 档案（core_characters/）
- 创建/修改世界观笔记（worldbuilding/）

当用户粘贴角色分析文本时：
- 提取角色名和别名
- 保留原文完整性
- 标注核心人格特质段落
- 不要尝试"简化"或"结构化"用户的分析——用户的原始理解就是最好的 DNA 档案

当用户描述角色时：
- 帮助补充可能遗漏的维度（如决策模式、隐藏面向、关系模式）
- 但始终以用户的理解为准，不要覆盖用户的判断

你不能操作的：
- 任何 AU 级别的设定
- 章节正文
- 事实表
- 铁律
```

### 2.4 UI 入口

在现有的 FandomLoreLayout 页面中增加 AI 对话区域：

```
┌──────────────────────────────────────────┐
│ ← 底特律变人 设定库                  [+] │
├──────────────────────────────────────────┤
│ 🤖 AI 设定助手                           │
│ ┌──────────────────────────────────────┐ │
│ │ 粘贴你对角色的理解，或描述想要        │ │
│ │ 添加的角色和世界观...                  │ │
│ │                              [发送]  │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ 📁 core_characters (2)                   │
│   📄 Connor.md                           │
│   📄 Hank.md                             │
│                                          │
│ 📁 worldbuilding (1)                     │
│   📄 仿生人社会.md                        │
│                                          │
│ 🗑️ 垃圾箱 (0)                            │
└──────────────────────────────────────────┘
```

---

## 3. 全实体 CRUD 操作权限

### 3.1 概述

系统中所有用户可见的实体都必须支持完整的创建、查看、编辑、删除操作。删除操作统一走垃圾箱机制（见第 4 节）。

**优先级：🔴 Phase 1.1**

### 3.2 实体操作矩阵

| 实体 | 创建方式 | 查看 | 编辑 | 删除 | 备注 |
|------|---------|------|------|------|------|
| **Fandom** | Library [+ 新建 Fandom] / AI 引导 | Library 列表 | 名称可改 | 移入垃圾箱 | 删除时其下所有 AU 一并移入 |
| **AU** | Fandom 卡片下 [+ 新建 AU] / AI 引导 | Fandom 展开列表 | 名称可改 | 移入垃圾箱 | 删除时章节/facts/设定/ops 全部移入 |
| **Fandom 角色 DNA** | Fandom 设定库 [+] / AI / 粘贴导入 | 设定库列表 | Markdown 编辑器 + 保存 | 🗑️ 移入垃圾箱 | 删除不影响已有 AU |
| **Fandom 世界观** | Fandom 设定库 [+] / AI / 粘贴导入 | 同上 | 同上 | 🗑️ 移入垃圾箱 | 同上 |
| **AU 角色** | AU Lore [+] / 设定模式 AI / 从 Fandom 导入 / 粘贴导入 | AU Lore 列表 | Markdown 编辑器 + 保存 | 🗑️ 移入垃圾箱 | |
| **AU 世界观** | AU Lore [+] / 设定模式 AI / 粘贴导入 | AU Lore 列表 | Markdown 编辑器 + 保存 | 🗑️ 移入垃圾箱 | |
| **章节** | 续写 → 确认 | 章节列表 | 正文区直接编辑（标记 dirty） | 🗑️ 移入垃圾箱 + 二次确认 | |
| **草稿** | 续写自动生成 | 草稿翻页 | 正文区编辑 | [丢弃] 直接删除 | 草稿不进垃圾箱 |
| **事实条目** | Facts [+ 新建] / AI 提取 / 设定模式 | Facts 列表 | 详情面板 + 保存 | 标记 deprecated（不物理删除） | 见 3.3 |
| **铁律条目** | AU Settings [+ 新增] / 设定模式 | 铁律列表 | 点击编辑 + 失焦保存 | 🗑️ 直接删除（不进垃圾箱） | 内容简短可重建 |

### 3.3 事实条目的"删除"

Facts 不走垃圾箱，因为它们存储在 facts.jsonl 中（不是独立文件）。删除事实条目的行为：

- 用户点击删除 → 弹出确认："将此事实标记为已废弃(deprecated)？AI 将不再参考此条信息。"
- 确认后：status 改为 deprecated + ops 记录
- Facts 列表默认不显示 deprecated 条目（可通过过滤器查看）
- 如需彻底删除（Phase 2）：从 jsonl 中物理移除 + ops 记录

### 3.4 编辑保存机制

| 实体类型 | 保存机制 | 理由 |
|---------|---------|------|
| 设定文件（.md） | **手动保存**（明确的 [保存] 按钮） | 内容较长，可能编辑到一半想放弃 |
| 铁律条目 | **失焦自动保存** | 单行文本 |
| 事实表条目 | **手动保存**（详情面板 [保存] 按钮） | 多字段表单 |
| 文风/参数配置 | **手动保存**（[保存] 按钮） | 避免误操作 |
| 章节正文编辑 | **不自动保存**（标记 dirty） | PRD 已有 dirty 机制 |

**保存反馈**：
- 保存中：按钮显示 loading 旋转图标
- 成功：按钮变为 "✅ 已保存"（1.5 秒后恢复）
- 失败：Toast 通知具体错误 + 按钮恢复为 [保存]

**未保存提醒**：
- 用户修改了内容但未保存，尝试离开页面时：
  "有未保存的更改，确定要离开吗？[保存并离开] [不保存离开] [取消]"

### 3.5 新建实体弹窗统一设计

**禁止使用浏览器原生 prompt / confirm / alert。** 所有新建弹窗使用应用内 Modal 组件。

角色/世界观新建 Modal：

```
┌─────────────────────────────────────────┐
│ 新建角色设定                        ✕   │
├─────────────────────────────────────────┤
│                                         │
│ 角色名 *                                │
│ ┌─────────────────────────────────────┐ │
│ │ 如：Connor Ellis                    │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ 别名（可选，逗号分隔）                   │
│ ┌─────────────────────────────────────┐ │
│ │ 如：皇帝陛下, Connor                │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ 或者，直接粘贴已有设定：                  │
│ ┌─────────────────────────────────────┐ │
│ │ 粘贴你的角色设定文本，AI 将自动      │ │
│ │ 提取信息并创建设定文件。              │ │
│ │                                     │ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│                                         │
│               [取消]  [创建]             │
└─────────────────────────────────────────┘
```

如果用户在"粘贴已有设定"区域输入了文本，点击 [创建] 后走 AI 解析流程（提取 frontmatter + 保存文件）。如果没有粘贴，直接创建带基础 frontmatter 的空文件，打开编辑器。

### 3.6 删除确认弹窗

普通实体：

```
┌─────────────────────────────────────────┐
│ 删除确认                            ✕   │
├─────────────────────────────────────────┤
│ 确定要删除 "Connor.md" 吗？              │
│ 该文件将移入垃圾箱，30 天内可恢复。       │
│               [取消]  [移入垃圾箱]       │
└─────────────────────────────────────────┘
```

危险实体（AU / Fandom / 章节）：

```
┌─────────────────────────────────────────┐
│ ⚠️ 删除确认                         ✕   │
├─────────────────────────────────────────┤
│ 确定要删除 AU "星际皇室" 吗？             │
│                                         │
│ 以下内容将一并移入垃圾箱：                │
│  • 12 个章节                             │
│  • 28 条事实                             │
│  • 4 个角色设定                           │
│  • 1 个世界观设定                         │
│                                         │
│ 30 天内可从垃圾箱恢复。                   │
│                                         │
│ 请输入 AU 名称确认：                      │
│ ┌─────────────────────────────────────┐ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│               [取消]  [确认删除]         │
└─────────────────────────────────────────┘
```

---

## 4. 垃圾箱系统

### 4.1 概述

所有删除操作不物理删除文件，而是移入垃圾箱目录。用户可在垃圾箱中恢复或永久删除。

**优先级：🔴 Phase 1.1**

**例外（不进垃圾箱）**：
- 草稿文件（临时性质，丢弃即删除）
- 铁律条目（内容简短，误删可快速重建）
- 事实条目（标记 deprecated 而非物理删除）

### 4.2 存储结构

```
fandoms/
├── {fandom_name}/
│   ├── .trash/                          ← Fandom 级垃圾箱
│   │   ├── manifest.jsonl               ← 删除记录
│   │   ├── characters/                  ← 删除的核心角色 DNA
│   │   │   └── {name}_{timestamp}.md
│   │   ├── worldbuilding/               ← 删除的世界观笔记
│   │   │   └── {name}_{timestamp}.md
│   │   └── aus/                         ← 删除的整个 AU
│   │       └── {au_name}_{timestamp}/
│   │
│   └── aus/
│       └── {au_name}/
│           ├── .trash/                  ← AU 级垃圾箱
│           │   ├── manifest.jsonl
│           │   ├── chapters/
│           │   │   └── ch0003_{timestamp}.md
│           │   ├── characters/
│           │   │   └── {name}_{timestamp}.md
│           │   └── worldbuilding/
│           │       └── {name}_{timestamp}.md
│           └── ...
```

### 4.3 manifest.jsonl 格式

```json
{
  "trash_id": "tr_1711700000_a3f2",
  "original_path": "characters/Connor.md",
  "trash_path": "characters/Connor_1711700000.md",
  "entity_type": "character_file",
  "entity_name": "Connor Ellis",
  "deleted_at": "2026-03-29T12:00:00Z",
  "expires_at": "2026-04-28T12:00:00Z",
  "metadata": {
    "file_size_bytes": 3200,
    "preview": "皇帝陛下，圣锚星系最高统治者..."
  }
}
```

### 4.4 自动过期

- 默认保留 **30 天**
- 可在全局设置中配置：7 / 14 / 30 / 60 / 永不自动删除
- 后端启动时扫描 manifest.jsonl，物理删除已过期条目
- 过期删除时物理删除文件 + 从 manifest 移除记录

### 4.5 API 端点

```
GET    /api/v1/trash?scope=fandom|au&path=...     ← 列出垃圾箱
POST   /api/v1/trash/restore                      ← 恢复（body: {trash_id, scope, path}）
DELETE /api/v1/trash/{trash_id}?scope=...&path=... ← 永久删除单条
DELETE /api/v1/trash/purge?scope=...&path=...      ← 清空垃圾箱
```

恢复冲突处理：原路径已存在同名文件 → 返回 409，前端提示用户重命名或覆盖。

### 4.6 删除操作的后端流程

```
1. 生成 trash_id（tr_{timestamp}_{4random}）
2. 生成带时间戳的垃圾箱文件名
3. 移动文件到 .trash/ 对应目录
4. 在 manifest.jsonl 追加记录
5. 如果文件已被 ChromaDB 索引 → 入队删除 chunks
6. 如果是角色文件 → 从 cast_registry 移除
7. ops.jsonl 追加 delete_file 记录
```

### 4.7 恢复操作的后端流程

```
1. 从 manifest.jsonl 查找 trash_id
2. 检查原路径是否被占用 → 占用返回 409
3. 移动文件从 .trash/ 回原路径
4. 从 manifest.jsonl 删除记录
5. 重新向量化（入队后台任务）
6. 重新注册 cast_registry（如果是角色文件）
7. ops.jsonl 追加 restore_file 记录
```

### 4.8 垃圾箱 UI

每个设定库页面底部 + Library 页面底部显示垃圾箱入口：

```
┌──────────────────────────────────────────┐
│ 🗑️ 垃圾箱 (3)                           │
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │ 📄 Connor.md                         │ │
│ │ 删除于 2026-03-29 12:00              │ │
│ │ 28 天后自动清除                       │ │
│ │            [恢复] [永久删除]          │ │
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │ 📁 AU: 现代咖啡馆                    │ │
│ │ 删除于 2026-03-28 15:30              │ │
│ │ 包含：3 章节, 12 事实, 2 角色         │ │
│ │            [恢复] [永久删除]          │ │
│ └──────────────────────────────────────┘ │
│                        [清空垃圾箱]       │
└──────────────────────────────────────────┘
```

---

## 5. 设定文件 CRUD API 完善

### 5.1 需要新增的端点

```
# 创建设定文件
POST /api/v1/lore
Body: { base_path, category, filename, display_name, aliases, content }
返回：201 { path, filename }

# 读取设定文件内容
GET /api/v1/lore/content?base_path=...&category=...&filename=...
返回：200 { filename, display_name, aliases, content, origin_ref }

# 更新设定文件
PUT /api/v1/lore
Body: { base_path, category, filename, display_name, aliases, content }
返回：200

# 删除设定文件（移入垃圾箱）
DELETE /api/v1/lore?base_path=...&category=...&filename=...
返回：200 { trash_id }

# 列出设定文件
GET /api/v1/lore/list?base_path=...&category=...
返回：200 [{ filename, display_name, aliases, size_bytes, origin_ref }]

# 从 Fandom 导入角色到 AU
POST /api/v1/lore/import-from-fandom
Body: { fandom_path, au_path, filenames: ["Connor.md", "Hank.md"] }
行为：复制文件 + 设置 origin_ref: fandom/{name}
返回：200 { imported: [...] }

# 删除 Fandom
DELETE /api/v1/fandoms/{name}?data_dir=...
返回：200 { trash_id }

# 删除 AU
DELETE /api/v1/fandoms/{fandom}/aus/{au}?data_dir=...
返回：200 { trash_id }

# 删除章节（移入垃圾箱）
DELETE /api/v1/chapters/{chapter_num}?au_path=...
返回：200 { trash_id }

# 重命名 Fandom
PUT /api/v1/fandoms/{name}/rename
Body: { new_name, data_dir }

# 重命名 AU
PUT /api/v1/fandoms/{fandom}/aus/{au}/rename
Body: { new_name }
```

### 5.2 向量化联动

设定文件的 CRUD 操作需要同步 ChromaDB：

| 操作 | ChromaDB 行为 |
|------|-------------|
| 创建/修改 AU 设定文件 | 入队 vectorize_settings_file（切块 + 嵌入 + 写入 characters/worldbuilding collection） |
| 删除 AU 设定文件 | 入队 delete_settings_chunks |
| 恢复 AU 设定文件 | 入队 vectorize_settings_file |
| Fandom 设定文件 CRUD | 不触发 ChromaDB 操作（Fandom 文件不参与 RAG） |

### 5.3 cast_registry 联动

| 操作 | cast_registry 行为 |
|------|-------------------|
| 创建 AU 角色文件 | 自动注册（name + aliases） |
| 修改 AU 角色的 name/aliases | 更新 registry |
| 删除 AU 角色文件 | 从 registry 移除 |
| 恢复 AU 角色文件 | 重新注册 |

---

## 6. 需要更新的 DECISIONS.md

| 编号 | 新增/修改 | 内容 |
|------|---------|------|
| D-0022 | 新增 | Fandom 角色是人格 DNA 模板，AU 角色是独立个体。两者无继承关系。取消 character_overrides 机制。 |
| D-0023 | 新增 | 删除操作统一走垃圾箱（.trash/ + manifest.jsonl），保留 30 天。草稿、铁律、事实条目例外。 |
| D-0024 | 新增 | 写作界面支持写作/设定双模式切换。设定模式 AI 返回变更清单，用户逐条确认后执行。 |
| D-0025 | 新增 | AU 设定模式只能操作 AU 级文件。Fandom 级文件需在 Fandom 设定模式中操作。 |
| D-0026 | 新增 | 所有新建弹窗使用应用内 Modal，禁止浏览器原生 prompt/confirm/alert。 |
| D-0027 | 新增 | 设定文件编辑使用手动保存。未保存离开时弹出确认。 |
| D-0028 | 新增 | Fandom 层设定不参与任何 AU 的 prompt 组装和 RAG 检索。仅作为 AI 设定模式的参考上下文。 |
| D-0029 | 新增 | 设定模式 AI 通过 LLM 原生 tool calling 返回操作建议（非手写 JSON）。AI 无执行权限，所有操作需用户确认后由前端调 API 执行。AI 无 delete 类 tool。 |

---

## 附录：实现优先级排序

```
第一批（修 bug）：
  B-001~B-012（已在进行）

第二批（CRUD 基础 + 垃圾箱）：
  1. 全实体删除功能 + 垃圾箱后端
  2. 新建弹窗统一 Modal 化
  3. 编辑保存机制完善（保存按钮 + 反馈 + 未保存提醒）
  4. 设定文件 CRUD API 补齐
  5. AU 目录结构调整（取消 character_overrides，合并为 characters/）

第三批（双模式 + AI 辅助）：
  6. 写作/设定双模式切换 UI
  7. 设定模式 AI system prompt + 变更清单解析 + 确认 UI
  8. Fandom 设定模式入口 + AI 助手
  9. 大文本导入流程（粘贴 → AI 解析 → 创建文件）
  10. 从 Fandom 导入角色到 AU 功能

第四批（完善）：
  11. 垃圾箱自动过期清理
  12. 未保存离开提醒
  13. 首次使用引导（Phase 2）
```
