# UX-TASK — UI/UX 体验改进任务单

> **任务批次**：UX-001 ~ UX-005
> **优先级**：Phase 1.1（与 CRUD 补全、Trash 系统同批次）
> **前置条件**：Linux CC 任务 0-3（DECISIONS.md 更新、目录重构、Trash 系统、CRUD API 补全）完成后开始
> **Owner**：Human Maintainer
> **执行代理**：Antigravity（前端主体）、Linux CC（后端 context_summary）

---

## 参考文档

本任务单引用以下三份设计文档（均已放入项目知识库）：

| 文档 | 内容 | 引用方式 |
|------|------|---------|
| `ui-rename-proposal.md` | 全量术语改名方案 + 技术选项解释文案 | UX-001 的实施依据 |
| `guidance-assessment.md` | 用户引导设计评估 + 缺失点清单 | UX-002 的实施依据 |
| `interaction-details.md` | 5 个交互细节补充设计 | UX-003 ~ UX-005 的实施依据 |

**代理实施前必须完整阅读对应参考文档。**

---

## 全局约束

1. **后端 API 字段名不改**。`perspective`、`importance`、`narrative_weight`、`pinned_context` 等后端字段保持英文。所有改名仅在前端 i18n 层做映射。
2. **不触碰核心状态机**。本批次任务不涉及 confirm/undo/import/dirty/facts lifecycle 的任何逻辑变更。
3. **所有 UI 文案统一走 `locales/zh.json`**。不允许在组件中硬编码中文字符串。
4. **创作模式为 Phase 2**，本批次所有设计仅针对嗑粮模式。

---

## UX-001 术语改名与技术选项人话化

### 任务身份
Antigravity（前端）

### 背景
用户实测反馈：大量选项名称使用英文、开发术语或 AI 行业黑话（如 Worldbuilding、Lore、narrative_weight、pinned_context、embedding_lock），连产品 Owner 都看不懂部分选项。目标用户是 LOFTER/AO3 写文太太，不是开发者。

### 目标
1. 将所有用户可见的术语替换为中文圈同人写手的日常用语
2. 为技术选项（API配置、搜索引擎模型、上下文长度等）添加引导文字
3. 枚举值的显示名做前端映射（后端枚举值不变）

### 实施依据
**完整改名方案见 `ui-rename-proposal.md`**，以下为关键改动摘要：

**导航/页面名称**：
- Worldbuilding → 世界观
- Lore → 设定集
- AU Settings → 故事设置
- AU Lore → 本篇设定
- Fandom Lore → 原作资料
- Facts / 事实表 → 剧情笔记

**角色相关**：
- importance: high/medium/low → 主角/配角/龙套
- core_always_include → 必带角色
- aliases → 别名 / 其他称呼
- origin_ref: fandom/X → 来源：原作X
- origin_ref: original → 来源：原创角色

**剧情笔记（原 Facts）状态**：
- unresolved → 待填坑
- active → 生效中
- resolved → 已填坑
- deprecated → 已作废

**剧情笔记类型（fact_type）**：
- plot_event → 剧情事件
- character_detail → 人物细节
- relationship → 人物关系
- worldbuilding → 世界观
- foreshadowing → 伏笔

**剧情笔记字段**：
- narrative_weight: high/medium/low → 重要性：★★★ / ★★ / ★（或"关键/普通/次要"）
- content_raw → 原文摘录（或"描述"）
- content_clean → AI 参考文本
- chapter_focus → 本章要推的线
- resolves → 填了哪个坑

**写作设置**：
- perspective → 人称
- emotion_style: implicit/explicit → 情感写法：行为暗示（Show）/ 直接描写（Tell）
- custom_instructions → 文风备注
- pinned_context / 铁律 → 写作底线
- ignore_core_worldbuilding → 不使用原作世界观

**模式切换**：
- 写作模式 → ✍️ 写文
- 设定模式 → 📋 改设定

**层级结构**：
- Fandom → 直接显示作品名（如"原作：底特律变人"）
- AU → 保持 AU + 显示名字（如"AU：星际皇室"）

**技术选项人话化**（完整文案见 `ui-rename-proposal.md` 第五节）：
- embedding_lock → "搜索引擎模型" + 引导："AI 用这个模型来查找和你写的内容相关的设定。换了模型需要重新处理一遍所有设定，大约需要几分钟。"
- context_window → "一次能读多少字" + 引导："AI 每次续写时能参考的最大文字量。数字越大，AI 能记住的前文和设定越多。大部分模型是 128k（约10万字），一般不用改。"
- api_base → "接口地址" + 引导："你的 AI 服务商提供的地址，比如 DeepSeek 就填 https://api.deepseek.com"
- api_key → "密钥" + 引导："在你的 AI 服务商网站上获取，类似一串密码，用来验证你的身份"
- mode: api/local/ollama → 在线API / 本地模型 / Ollama，各自一行说明
- index_status → ✅"设定已就绪" / ⚠️"设定需要重新处理" / 🔄"正在处理设定…"
- ChromaDB、RAG、token 等术语永远不出现在用户面前

### 允许改动文件
- `src-ui/src/locales/zh.json`（新建或修改）
- `src-ui/src/ui/**/*`（所有 UI 组件中的显示文案）
- `src-ui/src/ui/shared/**/*`（公共组件）

### 禁止改动文件
- `src-python/**/*`（后端任何文件）
- `src-ui/src/api/**/*`（API 调用层的字段名不改）

### 验收标准
- [ ] 所有用户可见的英文术语已替换为中文
- [ ] 所有技术选项有引导文字
- [ ] 枚举值在 UI 展示为中文，API 请求仍发英文
- [ ] 无硬编码中文字符串（全部走 i18n）
- [ ] 手动走查全部页面无遗漏

---

## UX-002 用户引导体系

### 任务身份
Antigravity（前端）

### 背景
现有 PRD 定义了 10 分钟成功路径和新建 AU 引导，但以下关键引导完全缺失：首次启动欢迎流程、所有页面的空状态、Fandom/AU 两层结构解释、里程碑触发式功能引导、错误信息友好文案。

### 目标
补全用户引导体系，让新用户不看文档也能上手。

### 实施依据
**完整评估和设计方案见 `guidance-assessment.md`**，以下为子任务拆分：

#### UX-002-A 首次启动欢迎流程

实现引导式的首次启动流程（非表单堆砌）：

```
Step 1 — 欢迎页
  "欢迎使用 FicForge · 粮坊"
  "AI 帮你写同人，记住每一个设定，不再崩人设。"
  [开始设置 →]

Step 2 — API 配置（引导式）
  "首先，连接你的 AI 模型"
  "推荐 DeepSeek，便宜好用，注册就送额度"
  [我有密钥] → 填Key + 测试连接
  [还没有？] → 跳转注册教程链接
  [我用本地模型 / Ollama] → 切换对应配置

Step 3 — 创建第一个 Fandom
  "你想写哪个作品的同人？"
  输入框 + 说明："比如 底特律：变人、原神、咒术回战..."
  或 [跳过，稍后创建]

Step 4 → 进入首页
  如果创了 Fandom → 引导创建第一个 AU
  如果跳过 → 首页空状态引导
```

**实现方式**：前端检查 `settings.yaml` 是否有 `api_key`（通过 API 调用），无则触发欢迎流程。已完成的用户不再触发。

#### UX-002-B 所有页面的空状态

每个"还没有内容"的页面必须有引导文案和操作入口：

| 页面 | 空状态文案 | 操作入口 |
|------|----------|---------|
| 首页（无 Fandom） | "还没有作品，创建你的第一个 Fandom 开始写文吧" | [+ 创建 Fandom] [📥 导入旧文] |
| 设定集（无角色） | "还没有角色设定。添加角色后，AI 续写时会自动参考人设，避免崩人设。" | [+ 添加角色] [📥 从原作导入] [🤖 让AI帮你整理] |
| 剧情笔记（无记录） | "还没有剧情笔记。记下重要剧情和伏笔，AI 会帮你记住并在续写时参考。写了几章后，点击「提取」让 AI 自动从正文中总结。" | [+ 手动记一笔] [✨ 从已有章节提取] |
| 写作底线（无条目） | "还没有写作底线。写作底线是 AI 绝对不能违反的规则，比如：「两人目前还没有在一起」「角色 A 不知道角色 B 的秘密」" | [+ 添加一条底线] |
| 章节列表（无章节） | "还没有章节，去写作页开始第一章吧" | [✍️ 开始写作] |
| 世界观（无文件） | "还没有世界观设定。添加后，AI 会在续写时参考这个世界的规则。" | [+ 添加世界观] |

#### UX-002-C Fandom/AU 两层结构解释

在首次创建 Fandom 时，显示一段引导说明（一次性，可折叠）：

```
"FicForge 用「原作」和「AU」两层来管理你的同人设定。

 原作 = 你写的是哪个作品（比如底特律、原神）
        放角色的原始人格分析、作品世界观等通用资料

 AU   = 你这篇文的具体设定（比如星际皇室AU、现代咖啡馆AU）
        放这篇文里角色的具体形象、独特世界观、剧情笔记

 一个原作下可以有多个 AU，共享原作资料但互不干扰。
 不想分层？直接建 AU 写就行，原作资料可以以后再补。"
```

#### UX-002-D 里程碑触发式功能引导

根据用户写作进度，在关键节点触发一次性引导：

| 触发条件 | 引导内容 | 可关闭 |
|---------|---------|-------|
| 定稿第 3 章后 | "你已经写了3章了！现在可以试试「剧情笔记」—— 记下重要剧情和伏笔，AI 续写时会自动参考。" [✨ 从最近3章自动提取] [稍后再说] | ✅ |
| 定稿第 5 章后（且无底线） | "写了5章了，有没有什么 AI 绝对不能搞错的规则？比如角色关系、秘密、性格底线？添加到「写作底线」，AI 每次续写都会严格遵守。" [➕ 添加底线] [不需要] | ✅ |
| 首次出现 unresolved fact | "💡 你有一个待填的坑：「{fact内容前20字}...」写下一章时，可以把它设为「本章要推的线」，AI 会在这章重点推进这个剧情。" [设为本章重点] [先自由发挥] | ✅ |
| 首次添加角色且 core_always_include 为空 | "💡 你还没有设置「必带角色」。把主角设为必带，AI 每次续写都会记住他们的人设。" [去设置] [稍后] | ✅ |

**实现方式**：前端维护 `onboarding_state`（localStorage），记录每个里程碑是否已触发/已关闭。已触发的不再重复显示。

#### UX-002-E 错误信息友好文案

将后端 `error_code` 映射为用户友好文案：

| error_code | 用户看到的文案 |
|-----------|-------------|
| `invalid_api_key` | "密钥验证失败，请检查你的 Key 是否正确" |
| `rate_limited` | "请求太频繁了，等 {retry_after} 秒后再试" |
| `insufficient_balance` | "API 额度用完了，请去服务商充值" |
| `timeout` | "AI 想太久了没回应，再试一次？" |
| `context_length_exceeded` | "这章的设定太多了，AI 读不完。试试减少一些角色设定或缩短底线。" |
| `content_filtered` | "AI 服务商拒绝了这次请求（可能触发了内容审查），换个说法试试？" |
| `connection_failed` | "连不上 AI 服务，检查一下网络和接口地址？" |
| `api_base_missing` | "还没有配置接口地址，去「故事设置」填一下" |

### 允许改动文件
- `src-ui/src/ui/**/*`（所有 UI 组件）
- `src-ui/src/ui/shared/**/*`（公共组件，含 EmptyState、OnboardingGuide 等新组件）
- `src-ui/src/locales/zh.json`
- `src-ui/src/hooks/**/*`（onboarding state hook）
- `src-ui/src/stores/**/*`（如有状态管理）

### 禁止改动文件
- `src-python/**/*`（后端任何文件）

### 验收标准
- [ ] 全新安装后触发欢迎引导流程，可正常走完
- [ ] 所有页面的空状态有引导文案和操作入口
- [ ] Fandom 创建时显示两层结构说明
- [ ] 定稿第3章 / 第5章 / 首次 unresolved fact / 首次添加角色时触发对应引导
- [ ] 引导可被用户关闭且不再重复出现
- [ ] 所有 API 错误码有友好中文文案

---

## UX-003 多稿交互与定稿流程

### 任务身份
Antigravity（前端）

### 背景
后端草稿机制已实现（`.drafts/` 持久化、confirm 绑定 draft_id），但前端的多稿浏览、触发方式、定稿流程的具体交互未设计。

### 目标
实现完整的多稿浏览和定稿交互流程。

### 实施依据
**完整交互设计见 `interaction-details.md` 第 1、3 节**，以下为关键要求：

#### 多稿触发与浏览
- 续写完成后显示 [✅ 定稿] [🔄 换一版] [🗑️ 丢弃]
- 点击 [换一版]：默认"用相同指令重新生成"，可选"修改指令后重新生成"
- 多稿间用左右箭头翻页（不是 tab），翻页时正文区域整体替换
- 每稿底部小字显示生成时间 + 模型 + temperature
- 用户可在草稿上直接编辑（编辑后标记"已修改"）
- 建议最多 5 稿（超过 5 稿提示但不阻止）

#### 定稿流程
- [✅ 定稿] → 二次确认弹窗（简洁：正文预览前200字 + [确认定稿] [取消]）
- 确认后前端发送 `confirm_chapter` 请求，携带当前展示的 `draft_id`
- 定稿成功后弹出 facts 提取引导（可选，不阻断）：
  - "💡 要不要记几条剧情笔记？AI 可以帮你从这章提取："
  - [✨ 让AI提取]  [自己记]  [跳过，继续写下一章 →]
  - 可勾选"以后定稿后都不再提醒"
- 定稿后自动切到下一章状态：输入框聚焦，chapter_focus 选择器刷新

#### 草稿恢复
- 进入写作界面时检查 `.drafts/` 是否有当前章节的草稿
- 若有 → 强制进入草稿浏览模式，必须先 [定稿某一个] 或 [全部丢弃]
- 不允许在有未处理草稿时生成新内容

### 允许改动文件
- `src-ui/src/ui/writer/**/*`（主写作页组件）
- `src-ui/src/ui/shared/**/*`（Modal、Toast 等）
- `src-ui/src/locales/zh.json`

### 禁止改动文件
- `src-python/**/*`
- confirm_chapter / undo / dirty 等核心逻辑

### 验收标准
- [ ] 续写后可点 [换一版] 生成新草稿
- [ ] 多稿间可左右翻页，显示稿件编号和元信息
- [ ] 定稿操作携带正确的 draft_id
- [ ] 定稿后弹出 facts 提取引导（可跳过、可永久关闭）
- [ ] 崩溃/刷新后能恢复未处理的草稿
- [ ] 有草稿时不允许生成新内容

---

## UX-004 续写参考摘要（需后端配合）

### 任务身份
- **后端**：Linux CC（Claude Code）
- **前端**：Antigravity

### 背景
用户添加了角色设定和剧情笔记后，无法感知 AI 续写时是否参考了这些内容。Context 可视化面板（P0-P5 token 展示）过于技术化，普通用户不会打开。需要一个轻量的参考反馈。

### 实施依据
**完整设计见 `interaction-details.md` 第 2 节**。

### 后端任务（Linux CC）

#### 目标
`assemble_context()` 完成上下文组装后，除返回 prompt 外，额外返回 `context_summary` 对象。

#### 返回格式

```python
@dataclass
class ContextSummary:
    characters_used: list[str]       # 被注入的角色名列表
    worldbuilding_used: list[str]    # 被注入的世界观文件名列表
    facts_injected: int              # 注入的 facts 总条数
    facts_as_focus: list[str]        # chapter_focus 对应的 fact content_clean 前 20 字
    pinned_count: int                # 生效的写作底线条数
    rag_chunks_retrieved: int        # RAG 召回的 chunk 数
    total_input_tokens: int          # 总输入 token 数
    truncated_layers: list[str]      # 被截断的层名列表（如 ["P5_core_settings"]）
    truncated_characters: list[str]  # 被截断（未注入）的角色名列表
```

#### 传递方式
- SSE 生成开始前，先发一个 `event: context_summary` 事件，payload 为上述 JSON
- 或在 generate API 响应中增加一个 `context_summary` 字段（非流式场景）

#### 允许改动文件（后端）
- `src-python/core/services/context_assembler*`（组装器，添加 summary 收集逻辑）
- `src-python/core/domain/context*`（新增 ContextSummary 数据类）
- `src-python/api/routes/generate*`（SSE 事件或响应字段）
- `src-python/tests/**/*`（对应测试）

#### 禁止改动文件（后端）
- confirm/undo/import/dirty 主流程
- state schema
- repository interface
- facts lifecycle

#### 核心约束
- **不改变现有 prompt 组装逻辑**，仅在组装过程中"旁路收集"元信息
- ContextSummary 是只读统计，不参与任何业务决策
- 组装失败或异常时 context_summary 可为 null，前端做容错

### 前端任务（Antigravity）

#### 目标
续写结果下方展示轻量参考摘要。

#### UI 设计

**正常状态**（正文下方一行灰色小字）：
```
📎 本次参考了：Connor 设定 · 圣锚星系世界观 · 3条剧情笔记 · 1条底线    [详情 ▼]
```

**展开详情**：
```
📎 本次 AI 参考了以下内容：

  👤 角色设定（2个）
     Connor Ellis（完整注入）
     Colin（完整注入）

  🌍 世界观（1个）
     圣锚星系（智能检索匹配）

  📝 剧情笔记（3条）
     ★★★ "Connor 和 Colin 目前处于热恋期" — 生效中
     🔴  "那句没说完的话" — 本章重点推进
     ★★  "圣所计划的压力" — 生效中

  🚧 底线（1条生效）

  ⚠️ 被精简的内容：无
```

**截断警告状态**（正文下方黄色警告）：
```
⚠️ 本次有设定被精简：龙套角色「陈律师」的设定未注入（超出容量）
   [查看详情] [调整必带角色]
```

#### 允许改动文件（前端）
- `src-ui/src/ui/writer/**/*`
- `src-ui/src/ui/shared/**/*`
- `src-ui/src/api/client*`（解析 context_summary 事件）
- `src-ui/src/locales/zh.json`

### 验收标准
- [ ] 后端：assemble_context 返回 ContextSummary，包含所有定义字段
- [ ] 后端：SSE 流在正文前发送 context_summary 事件
- [ ] 后端：ContextSummary 收集不影响现有组装性能（无额外 I/O）
- [ ] 后端：对应单元测试通过
- [ ] 前端：续写完成后正文下方显示参考摘要一行
- [ ] 前端：点击详情可展开完整列表
- [ ] 前端：有截断时显示黄色警告
- [ ] 前端：context_summary 为 null 时优雅降级（不显示摘要条，不报错）

---

## UX-005 必带角色入口与 Fandom/AU 设定模式区分

### 任务身份
Antigravity（前端）

### 背景
1. `core_always_include`（必带角色）是"不崩人设"最核心的功能，但 UI 上没有入口，用户不知道这个功能存在。
2. Fandom 设定模式和 AU 设定模式的 UI 布局、tool 定义、AI 角色定位不同，需要明确区分实现。

### 实施依据
**完整设计见 `interaction-details.md` 第 4、5 节**。

#### UX-005-A 必带角色入口

在设定集（AU Lore）的角色卡片上添加 [📌 必带] 切换按钮：

```
┌────────────────────────────────┐
│ 📌 Connor Ellis    主角         │
│ 别名：皇帝陛下, Connor          │
│ 来源：原作 Connor               │
│ [📌 必带] ← 蓝色高亮，已开启    │
└────────────────────────────────┘
```

- 点击切换必带状态（调用 `PUT /api/v1/project` 更新 `core_always_include`）
- 设为必带时，若角色设定无 `## 核心限制` 段落，弹提示建议添加
- 推荐不超过 3 个必带角色（超过时提示但不阻止）
- 设定集页面底部常驻说明："「必带」角色的设定每次续写都会完整提供给 AI，确保不会崩人设。建议只设主角（1-3个），设太多会占用 AI 的记忆空间。"

#### UX-005-B Fandom 设定模式 UI

Fandom 设定模式嵌入在 Fandom 设定库页面内（非全屏），定位为"角色分析伙伴"：

```
┌──────────────────────────────────────────┐
│ ← 底特律变人 · 原作资料                   │
├──────────────────────────────────────────┤
│ 🤖 AI 助手                               │
│ ┌──────────────────────────────────────┐ │
│ │ （对话历史区域）                        │ │
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │ 粘贴角色分析或描述...        [发送]   │ │
│ └──────────────────────────────────────┘ │
│ ── 文件列表 ──                            │
│ 📁 角色 · 📁 世界观                       │
└──────────────────────────────────────────┘
```

**与 AU 设定模式的关键区别**：

| 维度 | Fandom | AU |
|------|--------|-----|
| UI 布局 | 嵌入设定库页面 | 写作界面全屏切换 |
| AI System Prompt | 角色分析伙伴（见补充PRD §2.3） | 设定管理助手（见补充PRD §1.6） |
| 可操作文件 | core_characters/*.md, worldbuilding/*.md | characters/*.md, worldbuilding/*.md |
| 可操作数据 | 无（Fandom 层无 facts/底线） | facts, pinned_context, writing_style, core_includes |
| Tool 数量 | 4 个（create/modify × character/worldbuilding） | 9 个 |
| 对话历史 | 内存，关闭 Fandom 页面清空 | 内存，切回写文模式不清空 |

**Fandom 的 4 个 tool**（前端构造 LLM 请求时使用）：
- `create_core_character_file`
- `modify_core_character_file`
- `create_worldbuilding_file`
- `modify_worldbuilding_file`

映射到相同的 Lore CRUD API，只是 `base_path` 指向 Fandom 路径而非 AU 路径。

### 允许改动文件
- `src-ui/src/ui/writer/**/*`（AU 设定模式）
- `src-ui/src/ui/fandom/**/*`（Fandom 设定模式、设定库页面）
- `src-ui/src/ui/lore/**/*`（设定集页面、角色卡片）
- `src-ui/src/ui/shared/**/*`
- `src-ui/src/locales/zh.json`
- `src-ui/src/api/client*`（Fandom 层 tool 定义构造）

### 禁止改动文件
- `src-python/**/*`
- 核心状态机逻辑

### 验收标准
- [ ] 角色卡片上有 [📌 必带] 切换按钮，操作后 core_always_include 正确更新
- [ ] 必带角色数量过多时显示提示
- [ ] 设为必带但无核心限制段落时弹出建议
- [ ] Fandom 设定模式有独立的 AI 对话区域，嵌入设定库页面
- [ ] Fandom AI 使用 4 个 tool（不出现 AU 的 5 个额外 tool）
- [ ] AU 设定模式使用 9 个 tool，在写作界面全屏切换
- [ ] 两个设定模式的 System Prompt 不同
- [ ] Fandom 设定模式操作只影响 Fandom 层文件（D-0025 合规）

---

## 执行顺序建议

```
第一批（阻塞最小，可立即开始）：
  UX-001 术语改名          ← 纯文案替换，不依赖任何后端变更
  UX-002-B 空状态          ← 纯前端组件
  UX-002-E 错误信息文案     ← 纯前端映射

第二批（需后端 CRUD 完成后）：
  UX-002-A 首次启动引导    ← 依赖 API 测试连接 + Fandom 创建 API
  UX-002-C Fandom/AU 说明  ← 依赖 Fandom 创建流程
  UX-005-A 必带角色入口    ← 依赖 core_always_include 的 CRUD API
  UX-003 多稿交互          ← 依赖 .drafts/ API + confirm API

第三批（需后端 context_summary）：
  UX-004 续写参考摘要      ← 后端先完成 ContextSummary，前端再接

第四批（可随时插入）：
  UX-002-D 里程碑引导      ← 纯前端逻辑，但需要确认章节流程稳定后测试
  UX-005-B Fandom 设定模式 ← 依赖设定模式 tool calling 后端支持
```

---

## 风险提示

1. **UX-001 工作量大但风险低**：纯文案替换，不涉及逻辑变更，最安全的起步任务。
2. **UX-004 后端部分触及 context_assembler**：这是核心模块（OWNERS.md 中 Claude Code Primary），必须由 Linux CC 执行，且改动需保守——仅旁路收集，不改变组装逻辑。
3. **UX-005-B 的 tool 定义**：Fandom 和 AU 的 tool 列表必须严格隔离（D-0025），前端构造 LLM 请求时需根据当前上下文选择正确的 tool 集合。
4. **里程碑引导（UX-002-D）依赖 state 读取**：前端需要读取 `current_chapter` 判断写作进度，但不写入任何 state 字段。

---

## 需要新增的 DECISIONS.md 条目

| 编号 | 内容 |
|------|------|
| D-0030（建议） | 后端 API 字段名保持英文，前端通过 i18n 映射为中文显示。术语改名不涉及后端变更。 |
| D-0031（建议） | assemble_context 返回 ContextSummary 作为只读统计旁路，不参与任何业务决策，不改变现有组装逻辑。 |
