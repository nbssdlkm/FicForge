# 同人写作辅助系统 PRD v2

## 1. 项目概述

### 1.1 背景
现有 AI 写作工具在处理长篇连载时存在共同瓶颈：context window 有限导致设定遗忘、前后矛盾。本系统通过结构化上下文工程解决这一问题，专为同人写作场景设计。

目标用户画像：嗑冷 CP、找不到符合心意的粮、转向 AI 产粮的读者兼导演。不是传统意义上的"作者"，而是追更体验的参与者。

### 1.2 核心设计原则
- **上下文精准而非堆叠**：不追求塞满 context，每次只注入最相关的内容
- **状态驱动而非摘要驱动**：用动态事实表维护剧情状态，不压缩正文
- **人为主导，AI 辅助**：所有关键决策由用户控制，但操作门槛尽可能低
- **本地优先**：所有数据存储在本地

### 1.3 两种使用模式

**嗑粮模式**（默认）
- 用户是读者兼导演，AI 是产粮机
- 输入可以极简（"然后呢"、"他今天心情不好"）
- 界面类似聊天窗口
- temperature 默认偏高，**保留惊喜感**：系统只约束边界条件，不约束具体内容
- 确认章节操作轻量

**创作模式**
- 用户是作者，AI 是工具
- 更多手动控制选项
- 界面类似编辑器
- temperature 默认偏低，输出稳定可控

两种模式可随时切换，切换按钮常驻界面。

### 1.4 Phase 1 默认优先级声明

**Phase 1 的所有默认值、默认流程、默认 UI 位置，以"嗑粮模式用户"优先。**

创作模式作为增强能力提供，但不主导默认交互。具体体现：
- 首页进入后默认是聊天式写作区，而非项目管理面板
- `chapter_focus` 显示在主写作区，不藏在高级设置
- 确认章节是轻量操作，不强制先做完整审查
- 导入后优先引导"继续写"，而不是"先补全 facts"

这条原则会在 UI 取舍时作为决策依据——当嗑粮体验和创作控制冲突时，Phase 1 优先保前者。

### 1.5 首次10分钟成功路径（First 10 Min Success）

新用户第一次打开应用，必须能在 10 分钟内完成以下路径：

```
安装启动（<2分钟）
  → 填写 API Key，测试连接成功
  → 创建第一个 Fandom 和 AU（或导入旧文）

开始写作（<5分钟）
  → 成功生成 1 段续写
  → 能感知"AI 记住了上章结尾"（last_scene_ending 生效）

初步理解（<10分钟）
  → 知道 chapter_focus 是"本章推进目标"，尝试选了一个
  → 确认 1 章（或 1 个短片段）
```

**这个路径是 UI 和 onboarding 流程的设计约束**，不是运营指标：
- API Key 设置页必须有"测试连接"按钮，失败时有可读的错误提示
- 新建 AU 后，系统必须能在没有任何 facts 的情况下正常生成（空 facts 不崩溃）
- 首次生成的加载等待有进度提示，不能白屏卡住
- chapter_focus 的 UI 文案用"本章想推进的故事节点"，不用技术术语

### 1.6 导入后的能力分层说明

**导入旧文 ≠ 系统已完整理解全文。** 这是用户最容易产生的预期偏差，必须提前说明。

导入完成后，系统的理解分三层：

| 层级 | 内容 | 状态 |
|------|------|------|
| 原文可检索 | 全部章节向量化入库，RAG 可召回历史片段 | ✅ 导入即完成 |
| 最近章节状态感知 | 引导提取最近 5-20 章 facts，characters_last_seen 全量扫描初始化，last_scene_ending 自动提取 | ✅ 引导用户完成 |
| 全文结构化理解 | 所有历史伏笔以 facts 形式组织、冲突检测、完整状态树 | ❌ 需用户逐步补齐 |

**产品承诺**：导入后可以正常续写，RAG 会帮助召回相关历史；但早期伏笔的精准推进依赖用户手动补充 facts，系统不会自动分析全文。这是设计取舍，不是功能缺陷。

### 1.7 社区资产预留

这个系统的数据结构天然支持"可分享资产"，现在就定义清楚未来可打包共享的最小单元，为圈层传播奠定基础。

**可共享资产类型：**

| 资产包 | 包含内容 | 典型场景 |
|--------|----------|---------|
| Fandom 模板包 | fandom.yaml + core_characters/ + core_worldbuilding/ | 分享原神/咒术回战等 Fandom 的基础设定 |
| AU 模板包 | project.yaml（脱敏） + writing_style + pinned_context | 分享"现代咖啡馆 AU 起手配置" |
| 角色设定包 | 单个 .md 设定文件 | 分享精心写好的人物卡 |
| 文风预设包 | writing_style + custom_instructions | 分享"行为暗示情绪"风格配置 |

**Phase 1 实现边界**：只做本地导入导出（zip 压缩包）；Phase 3 再做社区分享平台或在线索引。

**导出格式原则**：模板导出只包含初始设定结构（"干净的起手盘"），必须物理剔除以下内容：
- `state.yaml`（用户阅读进度，属于个人运行态）
- `facts.jsonl`（用户专属剧情事实，属于个人存档）
- `ops.jsonl`（操作日志，属于个人存档）
- `chapters/` 目录（章节正文，属于个人创作内容）
- `api_key`（API 密钥）
- `local_model_path` / 所有绝对路径（含操作系统真实用户名，同人圈隐私风险）
- 非通用 `api_base`（如私有代理/中转地址，清空为默认值；仅保留公共厂商官方地址）
- `license.api_mode` 重置为 `"self_hosted"`（防止 managed 模式配置泄露到模板中）

导出包**保留**：project.yaml（脱敏）、writing_style、pinned_context、characters/ 设定文件、worldbuilding/、timeline.yaml（故事时间线结构，视为可分享设定资产）。

**⚠️ 导出前剧透审查提示**：导出 AU 模板时，UI 弹出提示："角色设定文件和 pinned_context 可能包含剧情推进中添加的后期内容（如角色真实身份、已揭晓的秘密、后期关系变化等铁律），请在导出前审查并移除不希望透露的信息。"——角色设定和 pinned 规则随写作推进会自然累积剧透，而模板的定位是"干净起手盘"。Phase 1 仅做 UI 提示，Phase 2 可支持"导出指定章节快照前的设定版本"。

**模板导入时的字段重建规则（与导出脱敏对称）：**

导入模板包后，系统自动执行以下初始化，确保导入结果是一个干净的新项目：

```
必须重新生成：
  project_id  → 生成新 UUID
  au_id       → 生成新 UUID
  created_at  → 设为当前时间
  updated_at  → 设为当前时间
  revision    → 重置为 1（project.yaml 和 state.yaml 均重置）

必须清空/重置：
  embedding_lock → 清空（继承全局配置，用户按需重新锁定）
  index_status   → 设为 "stale"（导入后无索引，首次打开时自动构建）
  state.yaml     → 按新建 AU 默认值初始化（current_chapter=1, 空 facts/dirty/focus）
  # 注：license 是全局 settings.yaml 字段，不属于 AU 级配置，不在此处理
  # license 缓存态的刷新由应用启动/登录流程负责

保持继承：
  writing_style / pinned_context / cast_registry / core_always_include
  schema_version（保留源模板版本号，导入时据此触发按需迁移）
  timeline.yaml（故事时间线结构，原样继承）
  model_params_override（AU 级模型参数覆盖，若有则继承模板作者的调参偏好）
  → 这些是模板的核心价值，原样保留
```

### 1.8 商业化预留

**基础功能永久免费**。商业化通过以下方式实现，现在只预留接口，不实现：

**两个可行方向：**

1. **托管 API 模式（模型钱）**：用户选择"使用平台 API"而不是填自己的 Key，请求走自建 API 中转站（OpenAI 兼容接口），支持套餐计费或按量计费。中转站与应用解耦，应用只需切换 `api_base` 和 `api_key` 指向平台端点即可接入。

2. **高级功能订阅（功能钱）**：档案员自动提取、批量模式、Agent 流水线、故事树等 Phase 2/3 功能作为付费功能，通过 `feature_flags` 控制解锁。

**现在需要预留的字段（Phase 1 字段留空，不实现逻辑）：**

```yaml
license:
  tier: "free"               # free | pro
                             # team 为 Phase 3+ 占位符，暂不承诺团队协作能力
                             # 嗑粮模式本质是私密个人娱乐，不适合 team 概念
                             # 创作模式未来可能有协作需求，但不是本产品当前重点
  feature_flags: []
  api_mode: "self_hosted"    # self_hosted | managed
```

**中转站接入预留接口（Phase 2/3 实现）：**

```
GET  /platform/license        → 验证用户许可证，返回 tier 和 feature_flags
GET  /platform/api_credential → 返回当前用户的临时 api_key（短期有效）
GET  /platform/plans          → 返回可用套餐列表
```

**⚠️ 计费必须在中转站服务端完成，绝不依赖客户端上报：**

客户端是本地可控代码，恶意用户可拦截或修改任何客户端请求。正确架构：
- 客户端用临时 api_key 向中转站发 `/v1/chat/completions`
- 中转站代理请求给大模型，从响应 `usage` 字段读取真实 token 消耗，在服务端扣余额
- 客户端无感知，**不需要也不应该有 `POST /platform/usage` 接口**

**最小账号与会话边界（Phase 2D/3 设计前提，现在定清楚）：**

```
账号凭证：
  用户用邮箱/第三方 OAuth 登录平台，获取长期 refresh_token
  refresh_token 存 settings.local.yaml（不同步），用于换取短期 access_token
  access_token 用于调用 /platform/* 接口，有效期建议 1 小时

api_credential 下发：
  managed 模式下，/platform/api_credential 返回的临时 api_key 有时效（如 24h）
  不落 settings.yaml，只存内存；应用重启后重新请求

多设备处理：
  同一账号允许多台设备登录（桌面+手机）
  license/feature_flags 跟随账号，各设备从 /platform/license 获取
  中继访问（Remote Session）和 managed API 使用同一套账号体系

设备解绑：
  在平台 Web 控制台管理已登录设备（Phase 3 实现）
  Phase 2 只做"退出登录清除本地 token"
```

**免费层永久包含**：所有 Phase 1 核心功能。self_hosted 模式下用户使用自己的 API Key，不受平台限制。

### 1.9 产品定位澄清：长篇同人连续创作工具，而非通用 RP 前端

虽然本产品具备聊天式界面、RAG、上下文组装、角色相关能力，但**产品核心与 SillyTavern 等 RP 前端根本不同**：

> 这不是"和角色聊天"的工具，而是**面向长篇同人连续创作与接续体验的工具**。

核心价值是：
- 不容易忘设定
- 不容易崩人物
- 不容易乱填坑
- 能围绕同一篇作品持续推进
- 用户可以低门槛**继续吃同一篇粮**

### 1.10 多端路线：桌面优先、同步第二、纯移动第三

目标用户（嗑粮读者）的**真实使用场景明显偏移动**——随时随地在手机上续粮，而不是坐在电脑前操作结构化系统。因此多端能力是产品成立的关键，但推进顺序要务实：

**Phase 1：桌面本地 MVP**（当前目标）
- 桌面端完成完整闭环：创建项目、导入旧文、生成、确认、undo、dirty、设定维护
- 这是所有后续能力的前提

**Phase 2：远程访问 + 多端同步**（提前，不再是愿景）
- 手机能接续桌面的粮
- 远程访问（手机访问桌面实例）+ 真正的多端同步
- 这是产品体验完整的关键里程碑

**Phase 3：纯移动端独立使用**
- 没有电脑也能用
- 前提是自填 API Key 或平台托管 API

### 1.11 桌面端与移动端的职责边界

**移动端不是缩小版桌面端**，而是承担不同职责：

| 职责 | 桌面端 | 移动端 |
|------|--------|--------|
| 项目创建与初始化 | ✅ 主场 | ❌ |
| 导入旧文 | ✅ | ❌ |
| 设定库维护 | ✅ | ❌ |
| facts 管理 | ✅ | Phase 2D Remote Session: 只读浏览；Phase 3 独立移动端: 轻量添加 |
| dirty 处理 | ✅ | ❌ |
| 索引重建 | ✅ | ❌ |
| 复杂配置 | ✅ | ❌ |
| 续写/生成 | ✅ | ✅ 核心场景 |
| 轻量选 chapter_focus | ✅ | ✅ |
| 看上一章 / 草稿 | ✅ | ✅ |
| 轻确认 | ✅ | ✅ |

一句话概括：**桌面端负责"建库和维护"，移动端负责"消费和轻创作"。**

### 1.12 远程访问 vs 多端同步：必须分清的两个概念

这两个概念工程成本和体验完全不同，**不能混写**：

**A. Remote Session Mode（远程访问桌面端）**
- 桌面端是唯一权威运行实例，FastAPI 持续运行
- 手机浏览器访问桌面端当前运行的 Web UI
- 本质：手机远程打开电脑里的那份应用
- 适合 Phase 2 早期过渡
- 优点：实现快、不要求移动端本地能力
- 缺点：依赖桌面端在线、不是独立移动端

**B. Sync Mode（真正多端同步）**
- 桌面端和移动端各自独立运行
- 同步"权威数据"（见 2.6.3），各端自行重建索引等派生数据
- 本质：多个独立实例共享同一份项目数据
- 适合长期方案、移动端独立使用的前提

**架构优势**：本产品 Web-first 架构（React + FastAPI）使 Remote Session Mode 实现成本极低——桌面端本质就是本地 Web 服务套壳，只需将 FastAPI 监听从 `localhost` 改为 `0.0.0.0`，手机浏览器即可局域网直连，无需重写任何 UI。

### 1.13 远程访问的产品约束

**普通用户不应被要求处理以下任何事项**：
- 自备域名
- 自己做公网端口映射
- 自行配置 HTTPS / 证书
- 学习内网穿透 / 家宽公网 IP

**推荐实现路线（由简到完整）**：

```
阶段1（Phase 2 初期）：局域网直连
  → 电脑和手机在同一 Wi-Fi
  → 桌面应用生成局域网访问地址（如 http://192.168.1.x:端口）
  → 手机浏览器直接打开
  → 实现成本极低，只需 FastAPI 绑定 0.0.0.0

阶段2（Phase 2 后期）：平台中继/隧道
  → 桌面应用主动连接平台中继服务
  → 手机通过配对码/扫码获得临时访问链接
  → 用户无感知证书、域名、转发细节
  → 适合外出时也能访问的场景
  → 需要平台提供中继基础设施
```

### 1.14 纯移动端用户覆盖策略

**定位**：纯移动端（无电脑用户）属于 Phase 3 目标，不抢先于桌面可用性和多端同步。

**技术前提**：纯移动端基本只有两条路：
- **路线 A：用户自填 API Key**——适合有配置能力的用户，但首体验偏重
- **路线 B：平台托管 API（managed mode）**——适合普通用户，打开即用，首体验门槛最低

对目标用户（嗑粮读者，非技术用户），**路线 B 是唯一能做到"打开就续粮"的方案**，因此 managed mode 的优先级比纯移动端本地能力更重要。

### 1.15 首次体验分端设计

当前 1.5 节的"首次10分钟成功路径"针对桌面端。移动端需要单独设计：

**桌面端首次体验（10分钟目标）**
见 1.5 节。完成初始化、项目创建、首次生成、确认章节、理解 chapter_focus。

**移动端首次体验（Remote Session / 独立使用）**

目标更激进：**30秒内吃到第一口粮**

```
Remote Session 路线（Phase 2）：
  → 桌面端已运行，生成局域网地址 / 扫码配对
  → 手机打开 → 直接进入当前项目的聊天式写作界面
  → 输入"继续" → 立刻生成
  → 不需要任何额外配置

纯移动端路线（Phase 3, managed mode）：
  → 打开 App → 登录账号（已有 managed API）
  → 选择已同步的项目 或 创建新项目（极简引导）
  → 进入续写界面
  → 首次体验不要求用户理解完整结构化系统
```

移动端首次体验原则：
- **不先逼用户完成桌面式初始化**
- 优先打开已有项目 / 进入续写模式
- facts / dirty / 索引等概念在移动端默认不可见
- 一句话 → 生成 → 吃粮，这就是移动端的核心循环

---

## 2. 系统架构

### 2.1 总体架构

```
┌─────────────────────────────────────────┐
│              本地 Web UI                 │
│  写作区  │  设定库  │  章节管理  │  设置  │
└────────────────┬────────────────────────┘
                 │ HTTP / WebSocket
┌────────────────▼────────────────────────┐
│              FastAPI 后端                │
│                                         │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │  写作引擎   │  │   上下文组装器   │  │
│  │  - 交互模式 │  │  [P0] Pinned     │  │
│  │  - 批量模式 │  │  [P5] 核心设定   │  │
│  └──────┬──────┘  │  [P4] RAG 召回   │  │
│         │         │  [P3] 事实表     │  │
│         │         │  [P2] 最近章节   │  │
│         │         │  [P1] 当前指令   │  │
│  ┌──────▼──────┐  └────────┬─────────┘  │
│  │ Agent 路由器│◄──────────┘            │
│  │  (可关闭)   │                        │
│  └──────┬──────┘                        │
│         │                               │
│  ┌──────▼──────┐  ┌──────────────────┐  │
│  │  档案员     │  │  Import Pipeline │  │
│  │ (Phase 2)   │  │  (前文导入)      │  │
│  └─────────────┘  └──────────────────┘  │
└─────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────┐
│              存储层                      │
│                                         │
│  ChromaDB（向量）    文件系统（结构化）  │
│  - characters        /fandoms/          │
│  - worldbuilding     /settings.yaml     │
│  - chapters                             │
│  - oc                                   │
└─────────────────────────────────────────┘
```

### 2.2 技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| 前端 | React + Vite + TailwindCSS | 轻量，热重载 |
| 后端 | FastAPI + Python | 异步，支持流式输出 |
| 向量库 | ChromaDB | 纯本地，零配置 |
| LLM | 可配置（见 2.3） | 支持 API / 本地路径 / Ollama 三种接入 |
| Embedding | 可配置（见 2.3） | 支持 API / 本地路径 / Ollama 三种接入 |
| Rerank | 可配置（见 2.3，Phase 3） | 支持 API / 本地路径 / Ollama 三种接入 |
| 文件存储 | YAML / Markdown / JSONL | 可读，天然支持 Git |

**打包分发方案（Phase 1 默认实现路线：Tauri 2 + Python sidecar）：**

目标用户不具备配置开发环境的能力，"本地优先"必须落实为"一键安装"。

**主线方案：Tauri 2**
- 前端：现有 React + Vite，不动
- 后端：Python FastAPI 以 sidecar 进程挂载
- ⚠️ Tauri sidecar 只负责"拉起外部进程"，不负责将 Python 代码编译为二进制；需在 CI/CD 中先用 PyInstaller 将 FastAPI + 全部依赖打包成独立可执行文件，再交给 Tauri 打包
- 建议先用"Numpy 兜底向量方案"跑通第一版打包，确认流程可行后再引入 ChromaDB
- 安装引导中静默安装 Visual C++ Redistributable（解决 ChromaDB VCRT 依赖）
- Phase 3 可直接扩展到 Android / iOS

**回退预案（仅在 Tauri sidecar 遇到无法解决的平台问题时启用）：**
- Electron + PyInstaller：体积较大（~150MB+ 壳），但生态更成熟

**开发者模式（仅用于早期内部验证，不算正式交付形态）：**
- 用户手动安装 Python 3.10+ 和 Node.js，运行启动脚本
- 不面向普通用户

**Embedding 本地依赖的降级方案**：

若用户选择 API Embedding（DeepSeek/OpenAI），可跳过本地推理库，但 **ChromaDB 本身依然有 C++ 依赖**（hnswlib + sqlite3），无论哪种 Embedding 模式都无法完全避免。在 Windows 上缺少 MSVC 运行库（VCRUNTIME140.dll）会导致启动崩溃。

**必须处理方案（二选一）：**
- **方案 A（推荐）**：在 Tauri/Electron 安装引导中，检测并静默安装 Visual C++ Redistributable（约 25MB），大多数用户已安装可秒过
- **方案 B（零依赖兜底）**：Phase 1 提供纯 Python + Numpy 实现的简易余弦相似度检索作为可选替代，彻底甩掉 ChromaDB C++ 包袱；代价是无持久化索引，重启后需重建

### 2.3 模型接入方式

系统中所有模型（LLM、Embedding、Rerank）均支持以下三种接入方式，在设置里按模型类型分别配置：

```
方式一：API（默认推荐，零额外配置）
  → 填入 API Base URL 和 API Key
  → 支持所有 OpenAI 兼容接口（DeepSeek、OpenAI、月之暗面等）

方式二：本地路径（local）
  → 用户下载模型文件到本地任意路径
  → 设置里填路径，通过对应库加载：
      LLM      → llama.cpp（本地推断）
      Embedding → ONNX Runtime（轻量推理，避免 PyTorch 2GB+ 体积膨胀）
      Rerank   → ONNX Runtime
  → ⚠️ 禁止使用 sentence-transformers 打包：它强依赖 PyTorch，
    PyInstaller 打出的二进制会突破 2GB，与"轻量化本地安装"目标完全相悖
  → 推荐模型格式：ONNX 格式的 nomic-embed-text 或同类轻量模型
  → 不依赖任何外部服务，完全离线

方式三：Ollama（进阶可选）
  → 已在使用 Ollama 的用户可直接接入
  → 填入 Ollama 服务地址和模型名
  → LLM、Embedding、Rerank 均可通过 Ollama 加载

**⚠️ local 与 ollama 必须保持独立的用户配置项**：两者在产品配置上是不同模式，不得合并为同一个 UI 选项。实现层可共享部分推断/估算逻辑，但配置入口、序列化字段、接口实现均须分开——否则 UI 设置页会变得混乱，且未来按平台差异化能力时无法单独禁用。
```

**各模型推荐选型（API 模式下）：**

| 模型类型 | 推荐 | 说明 |
|---------|------|------|
| LLM | DeepSeek / Claude / GPT-4o | 用户自选，支持所有 OpenAI 兼容接口 |
| Embedding | DeepSeek Embedding / nomic-embed-text | 中文效果好；本地推荐 nomic-embed-text（约300MB） |
| Rerank | bge-reranker（本地）| Phase 3 功能，暂不实现 |

输入框下方提示文字示例：
`本地 Embedding 推荐 nomic-embed-text，下载后填入模型文件夹路径即可`

#### 2.3.1 LLM 运行时切换与降级策略

**四条顶层规则：**

1. **LLM 是运行时可切换资源，不是作品状态的一部分。** `chapters / facts / state / chapter_focus / characters_last_seen` 等故事状态绝不因 LLM 切换而重置或漂移。
2. **Embedding 是 AU 级锁定资源，切换需重建索引。** LLM 切换不触发索引失效；只有 `embedding_lock` fingerprint 变化才触发 `index_status=stale` 与重建。
3. **"本次生成模型"默认不写回项目长期配置。** 用户在写作界面临时切换模型只改运行时会话态（内存），不污染 `project.yaml` 的 `updated_at/revision`。只有用户在 AU 设置页（6.5）显式修改模型配置时才写回。
4. **因额度/限流触发的模型切换，必须经过用户确认，不得静默自动切换。**

**"本次生成模型"的会话态设计：**

```
三层模型配置：
  ① settings.yaml.default_llm        → 全局默认模型（新建 AU 时继承）
  ② project.yaml.llm                 → AU 默认模型（长期配置，写回触发 revision+1）
  ③ 当前会话 session_llm（内存态）    → 本次生成实际使用的模型

加载优先级：③ > ② > ①
写回规则：③ 不持久化，刷新/重启后回退到 ②
UI 入口：写作界面参数配置区（6.4）的模型快速切换器

参数加载链（temperature / top_p 跟着模型走，不跟着 AU 走）：
  切换到模型 X 时自动加载参数：
    ① project.yaml.model_params_override["X"]  → AU 级覆盖（若有）
    ② settings.yaml.model_params["X"]          → 全局该模型的记忆值
    ③ 硬编码默认 {temperature: 1.0, top_p: 0.95} → 首次使用某模型时
  用户在 6.4 面板调参后：
    → 不点"记住"：仅本次生成生效
    → 点"记住到全局"：写回 settings.yaml.model_params["X"]
    → 点"记住到本 AU"：写回 project.yaml.model_params_override["X"]
```

**上下文降级预警（Phase 1 必须实现）：**

当用户切换模型导致 `context_window` 发生显著变化时（如从 128k → 8k），前端在切换确认前展示黄色预警：

```
预警触发条件：新模型的 context_window < 当前模型的 50%
预警内容示例：
  "切换到 [模型名]（上下文窗口 8K）后，系统将大幅精简注入内容：
   角色设定可能仅保留核心摘要，历史检索片段可能被跳过。
   建议在'自定义文风'中补充关键人设要点。"
非阻断：用户可忽略继续切换
```

**文风断裂提示（Phase 1 轻量实现）：**

每次切换模型时，写作界面底部显示一次性 toast："已切换为 [模型名]，不同模型文风可能有差异。可在'自定义文风'中约束写作风格。"

### 2.4 Tokenizer 路由机制

`count_tokens()` 不能用字符数估算——中文在不同模型的分词器下 token 消耗差异可达 2-3 倍，字符估算极易触发 `context_length_exceeded` 报错。

系统根据 `llm.mode` 和 `llm.model` 自动选择分词器：

```python
def count_tokens(text: str, llm_config) -> int:
    if llm_config.mode in ("api", "ollama"):
        # API 模式和 Ollama 模式统一用 tiktoken 估算
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")  # gpt-4/deepseek/llama 通用近似
        return len(enc.encode(text))
    elif llm_config.mode == "local":
        # ⚠️ 本地推理后端（llama.cpp/GGUF）与分词器来源不一定对齐：
        # GGUF 模型目录下通常没有可被 transformers 直接加载的 tokenizer
        # 适配策略（按优先级）：
        #   1. 若 local_model_path 下存在 tokenizer.json → 用 transformers 加载
        #   2. 若 llama.cpp sidecar 提供 /tokenize 端点 → 调用该端点
        #   3. 均不可用 → 降级为 tiktoken cl100k_base 近似估算（同 API 模式）
        # ⚠️ 必须使用 LRU Cache 或 Singleton 模式缓存 tokenizer 实例
        tokenizer = get_cached_tokenizer(llm_config.local_model_path)  # 内部实现上述适配链
        return len(tokenizer.encode(text))
```

**注意**：tiktoken 对 Ollama 模型是近似值，中文误差约 ±10%，作为水位线估算已足够安全。如需精确计算 Ollama 模型的 token 数，可在 fallback 中改为向 Ollama API 的 `/api/tokenize` 端点发请求。

settings.yaml 中可配置 fallback 策略（分词器加载失败时）：

```yaml
# 应用配置
app:
  language: "zh"                       # 界面语言（zh / en）
  data_dir: "./fandoms"
  token_count_fallback: "char_mul1.5" # 字符数×1.5作为保守估算（中文1字≈0.6-1.5 token，1.5倍足够安全且不过度截断），仅在分词器不可用时启用
  schema_version: "1.0.0"             # 升级迁移用，见 2.6.7
```

### 2.5 Context Window 自动推断

不同模型的 context window 差异极大，不应要求用户手动维护：

| 模型 | Context Window |
|------|---------------|
| deepseek-chat / deepseek-reasoner | 65,536 |
| claude-3-5-sonnet / claude-3-7-sonnet | 200,000 |
| gpt-4o / gpt-4-turbo | 128,000 |
| gemini-1.5-pro / gemini-2.0-flash | 1,000,000 |
| qwen-long | 1,000,000 |
| qwen-max | 32,768 |
| llama3 / llama3.1 (local/ollama) | 131,072 |

**三层优先级（由高到低）：**

```
1. project.yaml 的 llm.context_window 手动填写（最高优先级，填任意正整数即生效）
2. 后端内置映射表根据 llm.model 名称自动查找
3. 映射表中找不到的未知模型：保守默认值 32,000
```

**实现规则：**
- `context_window` 在 project.yaml 中**可选填**，填 `0` 或留空则走自动推断
- 手动填写始终优先——模型更新太快、本地模型、Ollama 自定义模型等情况下，用户可随时覆盖自动值
- 映射表维护在后端代码（`model_context_map.py`），不在 YAML 里，方便随模型更新
- AU 设置页 Context 字段显示当前实际使用值，自动推断时标注来源（如"65536·自动"），手动填写时直接显示填写值
- 字段下方提示文字：`留空自动推断 · 本地/新模型请手动填写`

### 2.6 架构分层约束（面向未来多端扩展）

Phase 1 先做桌面本地实现，但代码结构必须像"未来会有移动端和同步服务"那样写。现在分层代价最低；等 Phase 1 写完再改就是重构。

#### 2.6.1 五层结构

```
┌─────────────────────────────────────────────────┐
│  UI 层                                          │
│  写作页 / 章节列表 / facts 面板 / 设置页         │
│  只管界面、交互、状态展示                        │
│  不得知道 YAML 存哪、ChromaDB 怎么删             │
└──────────────────────┬──────────────────────────┘
                       │ 调用
┌──────────────────────▼──────────────────────────┐
│  应用服务层（Use Case）                         │
│  GenerateDraftService                           │
│  ConfirmChapterService                          │
│  UndoLatestChapterService                       │
│  ImportProjectService                           │
│  RebuildIndexService                            │
│  ResolveDirtyChapterService                     │
│  SetChapterFocusService                         │
│                                                 │
│  表达产品规则，不关心底层是本地文件还是远端 API  │
└──────────────────────┬──────────────────────────┘
                       │ 调用
┌──────────────────────▼──────────────────────────┐
│  领域层（Domain）                               │
│  核心对象：Project / Chapter / Draft / Fact /   │
│           StoryState / ChapterFocus             │
│  核心规则：                                     │
│  - current_chapter 如何推进                     │
│  - undo 连带哪些状态回滚                        │
│  - facts append-only 但 rollback 例外           │
│  - characters_last_seen 取 max 合并             │
│  - last_confirmed_chapter_focus 回退/读取时机   │
└──────────────────────┬──────────────────────────┘
                       │ 依赖接口（不依赖具体实现）
┌──────────────────────▼──────────────────────────┐
│  基础设施层（Infrastructure）                   │
│  FastAPI controller（桌面）                     │
│  LocalFileProjectRepository                     │
│  LocalFileChapterRepository                     │
│  LocalFileFactRepository                        │
│  LocalFileDraftRepository                       │
│  LocalChromaVectorRepository                    │
│  LLMProvider（API / 本地路径 / Ollama）         │
│  EmbeddingProvider                              │
│  TokenizerProvider                              │
│  BackgroundTaskQueue                            │
│                                                 │
│  这层最容易换——桌面和移动的差异主要在这里       │
└──────────────────────┬──────────────────────────┘
                       │ 接口预留，Phase 1 不实现
┌──────────────────────▼──────────────────────────┐
│  同步层（Sync，Phase 2D）                       │
│  SyncClient / SyncServerAPI                     │
│  OperationLogStore                              │
│  ConflictResolver                               │
│  DeviceRegistry                                 │
│                                                 │
│  现在不实现，但其他层不得堵死扩展点             │
└─────────────────────────────────────────────────┘
```

**核心约束**：业务规则必须沉到应用服务层/领域层，不能散落在 FastAPI 路由和前端组件里。FastAPI 只负责"收请求、调服务、回结果"。

#### 2.6.2 Repository 接口约束

业务逻辑不得直接访问文件路径或 ChromaDB，必须通过 Repository 接口：

```python
# 领域层只知道接口
class ChapterRepository(ABC):
    def get(self, au_id: str, chapter_num: int) -> Chapter: ...
    def save(self, chapter: Chapter) -> None: ...
    def delete(self, au_id: str, chapter_num: int) -> None: ...
    def list_main(self, au_id: str) -> list[Chapter]: ...

class VectorRepository(ABC):
    def index_chapter(self, chapter: Chapter) -> None: ...
    def delete_chapter(self, au_id: str, chapter_num: int) -> None: ...
    def search(self, query: str, filters: dict, top_k: int) -> list[Chunk]: ...

# 基础设施层提供具体实现
class LocalFileChapterRepository(ChapterRepository): ...
class LocalChromaVectorRepository(VectorRepository): ...

# 未来移动/同步版本只需换适配器
class RemoteChapterRepository(ChapterRepository): ...
class RebuildableVectorRepository(VectorRepository): ...
```

违禁写法举例（不得出现在应用服务层/领域层）：
- `open("fandoms/原神/aus/咖啡馆AU/chapters/main/ch038.md")`
- `chroma_client.delete(where={"chapter": 38})`
- `os.path.exists(f"chapters/.drafts/ch038_draft_A.md")`

#### 2.6.3 权威数据 vs 可重建数据

跨端同步最怕把"可重建索引"当真相去同步，冲突和损坏都会从这里来。

**A. 权威数据（需要同步，Phase 2D）：**

| 数据 | 位置 |
|------|------|
| project.yaml | AU 配置 |
| state.yaml | 运行时状态（含 chapter_focus、characters_last_seen 等）——**同步时必须剔除 `index_status` / `index_built_with` / `sync_unsafe` 三个本地设备派生字段**（见 3.5 注释） |
| facts.jsonl | 事实表 |
| chapters/main/*.md | 已确认章节正文（含 frontmatter） |
| chapters/backups/ | 版本备份 |
| characters/ / oc/ / worldbuilding/ | 设定文件 |
| ops.jsonl | 操作日志（Phase 1 业务关键依赖 + Phase 2D 同步回放基石，见 2.6.5） |
| settings.yaml | 全局配置——**仅同步公开字段**（见下方说明） |
| .drafts/（可选）| 若希望"电脑未确认的稿，手机也能继续看"则同步 |

**settings.yaml 同步边界说明**：

**Phase 1**：仍使用单文件 `settings.yaml`，3.1 文件结构和 3.3 示例均按单文件实现。

**Phase 2D 引入自动迁移**：拆分为双文件，迁移脚本执行：
1. 读取旧 `settings.yaml`
2. 可公开字段写入 `settings.sync.yaml`（模型偏好、语言、schema_version、license 等）
3. 敏感字段写入 `settings.local.yaml`（api_key、local_model_path、data_dir 等）
4. 旧 `settings.yaml` 备份为 `settings.yaml.bak` 后删除
5. 运行时 `load_settings()` 在内存中 Deep Merge 两个文件，应用层无感知拆分

**schema 升级与双文件迁移的执行顺序**：先对旧单文件执行 schema 迁移（补新字段、转换格式），再执行拆分。不能先拆分再分别迁移——否则两个文件的 schema 版本可能不一致，回滚也更复杂。

```
settings.sync.yaml   ← 全文件参与跨端同步
  app.language / schema_version / token_count_fallback / token_warning_threshold / chapter_metadata_display
  default_llm.mode / model / api_base / context_window
  model_params（按模型名索引的参数偏好，跨端同步）
  embedding.mode / model / api_base / ollama_model
  license.tier / feature_flags / api_mode

settings.local.yaml  ← 仅留本设备，绝对不同步
  default_llm.api_key / local_model_path
  embedding.api_key / local_model_path
  app.data_dir
```

Phase 2D 同步层只传输 `settings.sync.yaml`，不碰 `settings.local.yaml`。

**B. 本地派生、可重建、不同步的数据：**

| 数据 | 原因 |
|------|------|
| ChromaDB 向量索引 | 可从正文重建，不同设备向量模型可能不同 |
| tokenizer cache | 运行时产物 |
| token count cache | 运行时产物 |
| 检索中间结果 | 临时产物 |
| 各种 .tmp / job 产物 | 临时产物 |

#### 2.6.4 稳定 ID 与版本字段

为支持未来同步，核心对象现在就加稳定 ID 和时间戳：

```yaml
# project.yaml 补充
project_id: "proj_a1b2c3"      # 全局唯一，创建时生成，永不变更
created_at: "2025-03-23T10:00:00Z"
updated_at: "2025-03-24T14:22:00Z"

# state.yaml 补充
au_id: "au_d4e5f6"             # AU 唯一 ID
updated_at: "2025-03-24T14:22:00Z"

# facts.jsonl 每条补充
# id 已有（f001 等），加 created_at / updated_at
{"id":"f033", ..., "created_at":"2025-03-20T09:00:00Z", "updated_at":"2025-03-20T09:00:00Z"}

# chapters/main/ch038.md frontmatter 补充
---
chapter_id: "ch_g7h8i9"
revision: 1
confirmed_focus: ["f033"]
confirmed_at: "2025-03-24T14:22:00Z"
generated_with:               # 生成来源与统计快照（Phase 1 写入，UI 可选展示）
  mode: "api"
  model: "deepseek-chat"
  temperature: 1.0
  top_p: 0.95
  input_tokens: 12450          # 本次组装的输入 token 数
  output_tokens: 2180          # 模型实际输出 token 数（从 API response.usage 读取）
  char_count: 1623             # 正文字数（不含 frontmatter）
  duration_ms: 8340            # 生成耗时（毫秒，从请求发出到流式完成）
  generated_at: "2025-03-24T14:22:00Z"
---
```

**`updated_at` 写路径契约（所有写操作必须遵守）：**

| 操作 | 必须更新的 updated_at |
|------|----------------------|
| confirm_chapter | `state.yaml`（含 `revision +1`）/ 对应章节 frontmatter（`chapter_id` + `revision +1` + `confirmed_at`）/ ops.jsonl 新增条目 |
| undo_latest_chapter | `state.yaml`（章节号回退后刷新） |
| add/update fact | `facts.jsonl` 对应条目的 `updated_at` |
| resolve dirty chapter | `state.yaml` / 被修改 facts 的 `updated_at` |
| import 初始化 | `state.yaml` / 导入章节 frontmatter 写 `chapter_id`（UUID）+ `revision: 1` + `confirmed_at`（用导入时间） |
| update pinned / cast_registry / writing_style | `project.yaml` 的 `updated_at`（长期配置变更才刷新） |
| update settings | `settings.yaml`（或 Phase 2D 后的 `settings.sync.yaml`）的顶层时间戳 |
| rebuild index | `state.yaml`（更新 `index_status` / `index_built_with`） |

**原则**：
- `project.yaml.updated_at` 只在**长期配置变更**时刷新（pinned、cast_registry、writing_style、模型配置等）；confirm_chapter 是运行时操作，不应污染项目配置的修改时间
- 凡是写路径，调用方负责更新对应文件的 `updated_at`；不允许依赖操作系统文件修改时间
- **同时更新 `revision`**：上表中每个写操作，在更新 `updated_at` 的同时必须对同一对象的 `revision` 字段 +1（见下方 revision 预留定义）。**含被动级联写回**：如 fact 状态变更触发的 chapter_focus 悬空清理、resolves 反向级联等自动写回，同样必须刷新被修改对象的 updated_at 和 revision
- **`op_id` 是 ops.jsonl 操作日志的必须字段，Phase 1 就要写**——日志的 op_id 与业务对象的 revision 是两回事，前者用于日志追溯和撤销回放，后者用于同步冲突检测。

**revision 字段预留（Phase 1 写入，Phase 2D 消费）：**

Phase 2D 同步冲突检测依赖 revision 而非 updated_at（时钟可能不同步）。Phase 1 就要写入字段，但不消费：

```
project.yaml.revision: 1        # 每次长期配置变更 +1
state.yaml.revision: 1          # 每次运行态变更 +1（confirm/undo/dirty 等）
facts.jsonl 每条: revision: 1   # 每次该条 fact 被编辑 +1
章节 frontmatter: revision: 1   # 每次该章节被覆写/确认 +1
```

Phase 2D 冲突解决规则：同一对象双端均有修改时，revision 高者为准；revision 相同则以 updated_at 较新者为准，冲突方标记为待人工确认。Phase 1 只需保证每次写入时 revision +1 即可。

#### 2.6.5 Operation Log 预留

应用服务层每次执行核心动作时，同步写一条操作日志到 `au/{au_name}/ops.jsonl`：

```jsonl
{"op_id":"op_001","op_type":"confirm_chapter","target_id":"ch_g7h8i9","chapter_num":38,"timestamp":"2025-03-24T14:22:00Z","payload":{"focus":["f033"],"characters_last_seen_snapshot":{"林深":38,"陈明":37,"陈律师":35},"last_scene_ending_snapshot":"林深关上了咖啡馆的灯","generated_with":{"mode":"api","model":"deepseek-chat","temperature":1.0,"top_p":0.95,"input_tokens":12450,"output_tokens":2180,"char_count":1623,"duration_ms":8340}}}
{"op_id":"op_002","op_type":"undo_chapter","target_id":"ch_g7h8i9","chapter_num":38,"timestamp":"2025-03-24T14:25:00Z","payload":{}}
{"op_id":"op_003","op_type":"add_fact","target_id":"f034","chapter_num":38,"timestamp":"2025-03-24T14:30:00Z","payload":{"content_clean":"...","status":"unresolved"}}
```

**⚠️ 所有与章节生命周期绑定的操作（`add_fact`、`update_fact_status`）必须在顶层携带 `chapter_num` 字段**——Undo 逻辑依赖此字段按章节过滤操作记录进行精准回滚，缺失将导致回滚失效。

**`edit_fact` 日志语义**：用户通过表单编辑 fact 的 content_clean、characters、narrative_weight、type 等内容字段时记录。**不绑定章节生命周期**（顶层无 `chapter_num`），因此不参与 undo 级联删除——fact 内容编辑是独立用户操作，不随章节回滚。payload 应包含修改前后的字段 diff（至少记录 `target_id` + 变更字段名），供 Phase 2D 同步回放使用。允许修改 `fact.chapter`（归属章节），但 ops 中不记录 `chapter_num`，确保 undo 不会误卷入。

**Phase 1**：ops.jsonl 本地 append-only，**是业务关键依赖**（不是纯调试日志）：
- 撤销最新章时从中读取 `confirm_chapter` 的 `characters_last_seen_snapshot` 来恢复状态
- dirty 解除时从中读取前章快照作为 characters_last_seen 重算基线
- `update_fact_status` 记录用于 deprecated 状态的回滚回放

若 ops.jsonl 写入失败，上述依赖状态机操作将降级为扫描兜底（见撤销逻辑）。Phase 2D 同步层另外用于跨端操作回放。

**sync_unsafe 标记**：若 ops.jsonl 曾写入失败且状态机靠扫描兜底恢复过，后端在 `state.yaml` 中标记 `sync_unsafe: true`。Phase 2D 进入同步模式前必须检查此标记——若为 true，禁止无提示同步，强制弹窗告知用户"本地操作日志存在缺口，同步可能导致数据不一致，建议先在桌面端手动确认状态后再开启同步"。Phase 1 只写标记、不消费。

**Phase 2D**：同步层读取 ops.jsonl 做操作回放和冲突解决，比对比文件 diff 可靠得多。

记录的 op_type 清单：
`confirm_chapter` / `undo_chapter` / `import_project` / `add_fact` / `edit_fact` / `update_fact_status` / `set_chapter_focus` / `resolve_dirty_chapter` / `rebuild_index` / `update_pinned`

**多文件写入顺序契约（confirm / undo / dirty resolve 等涉及多文件的操作）：**

这些操作同时涉及 markdown 章节、state.yaml、facts.jsonl、ops.jsonl、ChromaDB 五类文件。为保证中途崩溃后可恢复，必须按以下固定顺序写入：

```
1. 写入 backup / temp 文件（确保可回滚）
2. 写入正文章节（chapters/main/）与 facts.jsonl
3. 写入 state.yaml（运行态更新）
4. append ops.jsonl（操作日志落盘，崩溃后可据此判断操作是否完成）
5. ChromaDB 向量索引更新（异步，允许延迟；若此步未完成，将 `state.yaml` 的 `index_status` 标记为 `"stale"`，下次启动加载项目时自动触发补建）
```

原则：**ops.jsonl 是事务提交标记**——若崩溃后 ops 中无本次操作记录，视为操作未完成，启动时根据 state + 文件系统实际状态做 reconcile。

**ops.jsonl 并发写入控制**：与 `facts.jsonl` 一样（见 6.7），所有对 `ops.jsonl` 的 append 操作必须使用相同的文件锁机制（`run_in_threadpool` 包装 `filelock`），确保在 FastAPI 异步并发下多行 JSONL 不会被交叉截断损坏——ops 是状态机的唯一凭证，一旦格式损坏，undo / dirty 恢复 / 同步回放将全部失效。

**AU 级互斥锁（AU-level Mutex）**：单文件 filelock 只保护单个文件的原子写入，无法防止复合状态撕裂（如请求 A 写完 state.yaml 还没写 ops.jsonl 时请求 B 冲进来）。因此，`confirm_chapter`、`undo_chapter`、`resolve_dirty_chapter` 这三类改变剧情时间线的操作，在 Service 层入口必须先获取 **AU 粒度的内存互斥锁**（`asyncio.Lock()`，按 `au_id` 分桶），确保同一 AU 同一时间只有一个状态机变更操作在执行。生成任务的 409 幂等规则（见 4.2）是 UI 层防呆，本条是 Service 层的最终防线。

#### 2.6.6 平台能力矩阵

防止以后被"文档上写过本地模型"绑架移动端实现预期：

| 能力 | 桌面（Phase 1） | 安卓（Phase 3+） | iOS（Phase 3+） |
|------|----------------|-----------------|-----------------|
| API 模式（DeepSeek/Claude 等） | ✅ | ✅ | ✅ |
| 本地模型路径 | ✅ | ❌ 默认不承诺 | ❌ 默认不承诺 |
| Ollama（本机） | ✅ | ⚠️ 可选（连接同网络设备） | ⚠️ 可选 |
| 本地 Embedding 模型 | ✅ | ❌ 默认不承诺 | ❌ 默认不承诺 |
| 全量向量索引重建 | ✅ 同步执行 | ⚠️ 后台异步 | ⚠️ 后台异步 |
| 文件系统直接访问 | ✅ | ❌ 通过 Repository | ❌ 通过 Repository |
| 本地 ChromaDB | ✅ | ⚠️ 轻量化或远端 | ⚠️ 轻量化或远端 |
| 跨端同步 | ❌ Phase 2D | ❌ Phase 2D | ❌ Phase 2D |

**移动端推荐路线**（Phase 3 决策时参考）：
- **Tauri 2**：复用现有 React + Vite Web 前端，官方支持 Android / iOS / 桌面，适合 Web-first 路线
- **Capacitor**：同样复用 Web 前端，主打 iOS/Android/Web，Web Native 路线
- **React Native**：需重写移动 UI，不直接复用现有 Web 组件，但原生体验更好

Phase 1 不锁定移动方案，只确保分层架构不堵死任何一条路。

#### 2.6.7 桌面应用封装契约（Phase 1 必须完成，进入 GA 前锁定）

**1. 分发工具选定**

建议选用 **Tauri 2**（推荐）：
- 壳体积小（<10MB），复用现有 React + Vite 前端
- Python FastAPI 以 sidecar 方式随应用分发，官方支持
- 安装引导中静默安装 Visual C++ Redistributable（解决 ChromaDB VCRT 依赖）

**打包必含离线资源：**
- **tiktoken BPE 词表**：tiktoken 首次加载 `cl100k_base` 编码时需联网下载词表文件，在纯离线环境下会直接阻塞或抛出网络异常。CI/CD 打包阶段必须提前下载词表缓存并打入 PyInstaller 依赖集，运行时通过环境变量 `TIKTOKEN_CACHE_DIR` 指向本地缓存目录
- **ONNX 模型文件**（仅限内置本地 Embedding 模式时）：若产品预装了默认 Embedding 模型，需一并打入

**2. Sidecar 生命周期**

```
应用启动 → Tauri 通过 Command API 拉起 Python sidecar
           （环境变量注入 PYTHONUNBUFFERED=1，双保险确保 stdout 无缓冲延迟）
           → FastAPI/Uvicorn 绑定端口 0（由操作系统分配绝对空闲的动态端口，
             从根源消灭端口冲突，无需重试逻辑）
           → sidecar 启动成功后向 stdout 打印固定格式标识：
             [SIDECAR_PORT_READY: {实际端口号}]（代码中必须 print(..., flush=True)）
           → 前端通过 Tauri Command API 监听 sidecar stdout 流，
             正则捕获 SIDECAR_PORT_READY 行后提取端口号，开始轮询 /health
           → ⚠️ 禁止使用本地临时文件（如 sidecar.port）存储端口：
             进程崩溃后文件残留会导致下次冷启动读到幽灵端口，造成假死
           → ⚠️ 冷启动提示：**严禁使用 PyInstaller `--onefile` 单文件模式**——
             单文件模式每次启动需解压全部依赖到 `%TEMP%`，含 ChromaDB/ONNX 模型时在机械硬盘上可能耗时 20-40 秒。
             必须使用 `--onedir`（目录模式），由 Tauri 安装包（NSIS/Wix）将整个目录解压到 Program Files，冷启动 1-3 秒。
             前端仍需显示加载界面："正在初始化本地引擎…"
           → /health 轮询超时设置为 30 秒（不能太短）
           → 30 秒内就绪 → 进入主界面；超时 → 弹出错误并提供"重试"按钮
应用退出 → Tauri 发送 SIGTERM → Python sidecar 完成当前请求后退出
意外崩溃 → Tauri 检测 sidecar 进程消失 → 自动重启，前端重新监听 stdout 获取新端口
```

**Remote Session 模式（Phase 2D，局域网直连）——正式运行模式定义：**

```
启动方式：
  本地模式（默认）：FastAPI 绑定 127.0.0.1:0（动态端口，防冲突，零配置）
  远程模式（手动开启）：FastAPI 绑定 0.0.0.0:{固定端口}（默认 8730，可在设置中自定义）
    ⚠️ 远程模式必须使用固定端口——动态端口会导致手机书签每次重启失效，
    用户必须重新走到电脑前扫码。固定端口让"掏出手机就续粮"成为可能。
    若端口被占用，UI 提示用户更换端口号。
  切换方式：重启 sidecar 以新绑定地址启动（不承诺热切换，重启更稳定可靠）

URL 生成：
  开启远程模式后，自动检测本机局域网 IP，生成访问地址
  桌面端显示 QR 码（如 http://192.168.1.x:端口/）+ PIN 码

访问认证：
  6位数字 PIN 码，每次开启远程模式随机生成
  PIN 码与当前会话绑定，桌面端关闭远程模式后旧 PIN 立即失效
  桌面端关闭应用后旧链接必须立即失效
  不承诺同时多个移动端接入（Phase 2D 初期按单端设计）

前端资源：
  远程模式下 FastAPI 同时托管前端静态资源（`/` 路由返回 React 构建产物）
  手机浏览器访问根路径即可使用

会话生命周期：
  桌面端锁屏（不休眠）：sidecar 通常继续运行，手机可继续使用
  桌面端休眠/睡眠：进程和网络可能挂起，不承诺手机可用；提示用户"请保持电脑唤醒"
  桌面端关闭应用：sidecar 退出，手机显示"连接已断开"

⚠️ Remote Session 是独立子项目，不是"顺手改一个配置"：
  完整实现包括：绑定模式切换、局域网地址发现、QR 码生成、PIN 认证、
  响应式 UI 适配、静态资源托管、文件操作屏蔽、会话恢复

⚠️ Remote Session 下必须屏蔽的功能：
  所有涉及"本地文件路径选择/上传"的入口（导入旧文、本地模型路径配置等）
  提示文案："远程模式下文件导入请在桌面端完成"
  允许的操作：续写生成、chapter_focus 选择、facts 浏览（只读）、章节阅读、轻确认
  ⚠️ facts 新增/编辑在 Remote Session 中不支持（表单交互在小屏上体验差且容易误操作），
  推迟到 Phase 3 独立移动端（含真正同步）时再开放

⚠️ 安全边界说明：局域网 Remote Session 使用明文 HTTP + 单 PIN 码认证，
  仅面向家庭等可信网络环境，不构成互联网级安全方案。
  UI 开启远程模式时应提示："请确保当前处于可信的局域网环境"
```

**3. 默认数据目录**

```
Windows：%APPDATA%\FanficAI\data\    （或用户选择的自定义路径）
macOS：  ~/Library/Application Support/FanficAI/data/
Linux：  ~/.config/FanficAI/data/
```

首次启动时若目录不存在，自动创建并写入默认 `settings.yaml`。

**4. 首次启动初始化流程**

```
1. 检查数据目录是否存在
2. 不存在 → 创建目录 + 写入默认 settings.yaml（API Key 留空）
3. 弹出欢迎引导：填写 API Key → 测试连接 → 进入首页
4. 检查 ChromaDB VCRT 依赖（Windows）→ 若缺失提示安装
```

**5. 升级与数据迁移**

```
升级时：
1. 新版本首次启动，读取 settings.yaml 中的 schema_version 字段
2. 若低于当前版本，执行对应迁移脚本（如 narrative_weight → importance+urgency 映射）
3. 迁移完成后更新 schema_version
4. 迁移失败 → 回滚，保留旧数据，弹出错误报告

打开 AU 时：
5. 读取 project.yaml 中的 schema_version，若低于当前版本，执行 AU 级迁移脚本
6. 模板导入时同理：先校验源模板的 schema_version，按需迁移后再实例化
```

所有数据 schema 变更必须有对应迁移脚本，不允许破坏性升级（见 2.6 向前兼容原则）。

**6. 日志与崩溃恢复**

```
日志落盘路径：{数据目录}/logs/app-{date}.log
日志内容：FastAPI 请求日志、生成任务状态、错误堆栈
用户导出：设置页提供"导出日志"按钮，打包最近7天日志为 zip

崩溃恢复：
- 生成中崩溃 → 重启后检测 .drafts/ 中未完成草稿 → 自动恢复草稿对比界面
- 向量化中崩溃 → 重建任务标记为 interrupted → 重启后提示"上次索引未完成，是否继续"
- 启动时若发现 state / 文件系统 / ops.jsonl 之间不一致（如 state 显示 current_chapter=39 但 ch038.md 不存在，或 ops 中最后一条 confirm 的章节号与 state 不符），则提示用户手动确认状态
```

**7. 项目数据校验与自动修复（AU 打开时执行）**

考虑到"本地文件可读、天然支持 Git、用户可直接碰文件系统"，文件被人为改坏是高概率事件。每次打开 AU 时，后端执行 `validate_and_repair_project()`：

```
校验范围与策略：
  project.yaml  → 缺失字段自动补默认值（参照 3.4 完整字段定义）
  state.yaml    → 缺失字段自动补默认值（参照 3.5）；current_chapter 与实际章节文件数不符时警告
  facts.jsonl   → 逐行解析，损坏行跳过并记录日志，自动生成 .bak 备份
  ops.jsonl     → 同 facts.jsonl 逐行解析；若末尾存在无法解析的损坏行（通常因写入时断电/进程被杀导致半行 JSON），截断丢弃该行并记录日志，允许应用继续启动——丢失的最终操作状态由常规 state/文件系统比对（reconcile）兜底恢复。**⚠️ 截断后必须将 `state.yaml.sync_unsafe` 标记为 `true`**，并在 UI 顶部显示一次性警告："本地操作日志存在缺口，撤销操作可能不完整"——截断意味着日志链已断，undo 的快照恢复和 Phase 2D 同步回放均可能受影响
  章节 frontmatter → 缺 chapter_id/confirmed_at 时自动补生成（chapter_id 使用 UUID，生成后写回文件，此后不再重新派生——避免文件重命名/分支变化导致 ID 不稳定）

处理原则：
  - 能自动补默认值的自动补，补完继续加载
  - 不能自动修复的（如 project.yaml 完全损坏无法解析）标记 project_invalid，
    UI 显示"项目数据损坏"报告并建议用户从备份恢复
  - 所有自动修复操作写入 logs/repair-{date}.log，用户可追溯

外部修改对账：
  - 启动时比对所有 chapters/main/*.md 的操作系统修改时间（mtime）与该章节的 confirmed_at
  - 若 mtime 明显晚于 confirmed_at，自动将该章节号推入 chapters_dirty 列表
  - **文件缺失检测**：若 state.yaml 记录的 current_chapter 表明应存在 ch001-ch{N-1}，
    但实际文件缺失，标记为异常并弹窗提示用户："第X章文件丢失，请从备份恢复或手动处理"
  - **外部新增检测**：若扫描发现存在章节号 ≥ current_chapter 的正文文件（如用户直接在文件系统粘贴了 ch039.md），弹窗提示："检测到外部新增章节，请通过 Import 流程导入或手动调整进度"，并禁用生成按钮直至状态一致——防止正常生成时覆写用户外部添加的文件
  - 界面提示："检测到外部文件更改，请核对事实表并解除脏状态以更新检索库"
  - 适用场景：用户在 Obsidian / VS Code / Git pull 等外部工具中直接修改了章节文件
```

#### 2.6.8 后台任务抽象

以下任务天然异步，必须通过任务系统执行，不得在 HTTP 请求中同步阻塞：

```python
class BackgroundTaskQueue(ABC):
    def enqueue(self, task_type: str, payload: dict) -> str: ...  # 返回 task_id
    def get_status(self, task_id: str) -> TaskStatus: ...
    def cancel(self, task_id: str) -> None: ...

# 异步任务清单
ASYNC_TASKS = [
    "vectorize_chapter",      # 章节向量化
    "delete_chapter_chunks",  # 章节向量删除（undo 专用，见 6.3 步骤5）
    "rebuild_index",          # 全量重建索引
    "import_pipeline",        # 前文导入
    "resolve_dirty_chapter",  # dirty 章节重处理
    "extract_facts_light",    # 轻量事实提取
    # Phase 2+
    "run_archivist",          # 档案员扫描
]
```

**Phase 1**：桌面先用 `in-process` 线程池实现（`asyncio` + `ThreadPoolExecutor`），前端轮询任务状态。不要写成"点按钮同步卡住地跑完"。

**⚠️ 队列并发约束**：所有涉及 ChromaDB 写入的任务（`vectorize_chapter`、`delete_chapter_chunks`、`resolve_dirty_chapter`、`rebuild_index`）必须在一个**单工作线程（`max_workers=1` 的独立 Executor）**中串行消费，彻底杜绝 SQLite 底层的 `database is locked` 并发写异常。读操作（RAG 检索）不受此限制，可在主线程执行。**⚠️ 初始化 ChromaDB 客户端时，必须显式开启 SQLite WAL（Write-Ahead Logging）模式**——默认 journal 模式下，耗时写事务（如全量索引重建）会阻塞并发读操作，导致用户在后台重建时点击"续写"触发 RAG 检索超时。

**防御性校验（defense-in-depth）**：`vectorize_chapter` worker 在实际写入 ChromaDB 前，必须先检查对应章节文件是否仍存在（`if not os.path.exists(chapter_path): return`）——即使 undo 的 cancel 未能及时阻断任务，worker 自身也能安全退出，避免为已删除的章节写入幽灵数据。

**异步任务重试机制**：ChromaDB 写入任务（`vectorize_chapter`、`delete_chapter_chunks`、`resolve_dirty_chapter`、`rebuild_index`）失败时（如单次 I/O 超时、SQLite 临时锁异常），自动重试最多 3 次，采用指数退避间隔（1s → 2s → 4s）。3 次均失败后将 `index_status` 标记为 `stale`，向 UI 暴露错误提示用户介入。单次超时不应直接阻断用户写作流程。

**Phase 3**：替换为持久化任务队列（如 Celery、ARQ），支持跨设备任务状态查询。

---

## 3. 数据结构设计

### 3.1 完整文件结构

```
/settings.yaml               # 全局配置（应用根目录，见 3.3）
/logs/                        # 应用日志（见 2.6.7）
/locales/                     # 前端 i18n 文件（见 Phase 1 checklist）
/fandoms/
└── {fandom_name}/
    ├── fandom.yaml              # Fandom 元信息
    ├── core_characters/         # 全 AU 通用核心设定
    │   ├── {char_name}.md
    │   └── ...
    ├── core_worldbuilding/      # 全 AU 通用世界观（如有）
    │   └── ...
    └── aus/
        └── {au_name}/           # 一个 AU = 一篇同人文
            ├── project.yaml     # AU 配置
            ├── state.yaml       # 运行时状态（chapter进度、焦点、脏章节等）
            ├── facts.jsonl      # 动态事实表
            ├── ops.jsonl        # 操作日志（Phase 1 业务关键依赖，见 2.6.5）
            ├── timeline.yaml    # 故事时间线
            ├── characters/      # AU 限定设定（补充/覆盖核心）
            │   ├── {char_name}.md
            │   └── ...
            ├── oc/              # 原创角色 + 功能性角色
            │   └── {char_name}.md
            ├── worldbuilding/   # AU 世界观设定
            │   └── ...
            ├── chapters/
            │   ├── main/        # 主线章节（Phase 1 所有章节存这里）
            │   │   ├── ch001.md
            │   │   └── ...
            │   ├── backups/     # 章节版本备份（覆盖已确认章节时自动保存旧版）
            │   │   └── ch038_v1.md
            │   ├── .drafts/     # 草稿临时存储（确认后清理，见 4.3）
            │   │   └── ch038_draft_*.md
            │   ├── branches/    # 分支章节（Phase 2 启用，Phase 1 创建空目录占位）
            │   │   └── ...
            │   └── snapshots/   # facts 快照（Phase 2 分支机制使用）
            │       └── ...
            └── imports/         # 原始导入文件存档
                └── ...
```

**章节文件命名规约**：所有章节编号在落盘为文件名时，**强制使用 4 位补零**（`ch%04d.md`，如 `ch0001.md`、`ch0038.md`、`ch1000.md`）。3 位补零在超过 999 章时会导致操作系统文件列表字典序错乱（`ch099.md` → `ch1000.md` → `ch100.md`），破坏 `scan_characters_in_chapter` 的时间线因果。文档中出现的 `ch038.md` 等为简写示例，实际文件名为 `ch0038.md`。

### 3.2 fandom.yaml

```yaml
name: "原神"
created_at: "2025-03-23"
core_characters: [林深, 陈明, 张云]   # Fandom 级角色名索引，仅供新建 AU 时预填 cast_registry 参考；运行时角色加载依赖 project.yaml 的 cast_registry 和文件系统
wiki_source: "https://wiki.biligame.com/ys/"  # 可选，留空则无
```

### 3.3 settings.yaml（全局配置，应用根目录）

存放与具体 AU 无关的应用级配置，所有 AU 共用：

```yaml
updated_at: "2025-03-24T14:22:00Z"  # 顶层时间戳，任何配置变更时更新（见 2.6.4 写路径契约）

# LLM 配置（新建 AU 时的初始值，可在 project.yaml 的 llm: 字段中覆盖）
default_llm:
  mode: "api"                          # api / local / ollama
  model: "deepseek-chat"
  api_base: "https://api.deepseek.com" # mode=api 时使用
  api_key: ""                          # 留空则从环境变量读取
  local_model_path: ""                 # mode=local 时填模型文件夹路径
  ollama_model: ""                     # mode=ollama 时填模型名
  context_window: 0            # 0 = 自动推断（见 2.5），新建 AU 时的初始值

# 模型参数表（按模型名索引，参数跟着模型走而非跟着 AU 走）
# 用户为某个模型调过参数后自动记住，下次使用该模型自动加载
# 不同模型的 temperature 含义和合理范围不同（如 Claude 0-1, DeepSeek 0-2），不应共享同一组值
model_params:
  deepseek-chat: {temperature: 1.0, top_p: 0.95}
  # claude-sonnet: {temperature: 0.7, top_p: 0.90}
  # 首次使用某模型时若无记录，使用硬编码默认值 {temperature: 1.0, top_p: 0.95}
  # 用户在写作界面（6.4）调参后点击"记住"，写入此表

# Embedding 配置
embedding:
  mode: "api"                          # api / local / ollama
  model: ""                            # mode=api 时填模型名，如 DeepSeek: "text-embedding-v3"，OpenAI: "text-embedding-ada-002"
  api_base: ""                         # mode=api 时使用，留空则复用 default_llm.api_base
  api_key: ""                          # 留空则复用 default_llm.api_key；不同厂商时需单独填写
  local_model_path: ""                 # mode=local 时填模型文件夹路径（推荐 nomic-embed-text）
  ollama_model: "nomic-embed-text"     # mode=ollama 时使用

# 应用配置
app:
  language: "zh"                       # 界面语言（zh / en，对应 locales/ 下的 i18n 文件）
  data_dir: "./fandoms"                # 数据存储根目录，用户可修改
  token_count_fallback: "char_mul1.5"  # 字符数×1.5作为保守估算，见 2.4
  token_warning_threshold: 32000       # 绝对上限；实际触发阈值 = min(此值, context_window*0.5)，见 4.3 动态水位线
  chapter_metadata_display:            # 章节元数据信息栏（类似 Chatbox 消息元数据）
    enabled: true                      # 总开关
    fields:                            # 用户可选显示哪些字段，全部默认开启
      model: true                      # 生成模型名
      char_count: true                 # 正文字数
      token_usage: true                # 输入/输出 token 数
      duration: true                   # 生成耗时
      timestamp: true                  # 生成时间
      temperature: true                 # Temperature
      top_p: true                        # Top-p
  schema_version: "1.0.0"             # 数据 schema 版本，升级时自动迁移（见 2.6.7）

# 商业化预留（Phase 1 留空，不实现逻辑；见 1.8）
license:
  tier: "free"               # free | pro（team 为 Phase 3+ 占位符，暂不实现）
  feature_flags: []          # 已解锁的付费功能列表，空=只用免费功能
  api_mode: "self_hosted"    # self_hosted（用自己Key）| managed（走平台中转站）
  # ⚠️ 重要：license 字段在本地文件中只是【缓存态 / UI 显示态】
  # 付费功能的实际权限必须由平台 /platform/license 端点校验结果决定
  # 不能仅凭本地 YAML 判断是否解锁——用户可直接修改本地文件绕过付费
  # managed 模式和付费功能的 entitlement 由服务端下发，本地只做展示缓存
```

**Key 加载优先级：**
```
环境变量（最高优先级）
  → settings.yaml 中对应字段
  → 若 embedding.api_key 为空，则复用 default_llm.api_key（仅同厂商时适用）
```

**注意**：settings.yaml 含有 API Key，应加入 `.gitignore`，避免误提交。

### 3.4 project.yaml（AU 级别，完整字段）

```yaml
project_id: "proj_a1b2c3"     # 全局唯一，创建时生成，永不变更
au_id: "au_d4e5f6"            # AU 唯一 ID
name: "现代咖啡馆AU"
fandom: "原神"
schema_version: "1.0.0"       # AU 配置 schema 版本，模板导入时校验兼容性并触发迁移（见 2.6.7）
revision: 1                   # 每次长期配置变更 +1（见 2.6.4 revision 预留）
created_at: "2025-03-23T10:00:00Z"
updated_at: "2025-03-24T14:22:00Z"

# LLM 配置（嵌套结构，与 settings.yaml 一致，覆盖 default_llm 对应字段）
llm:
  mode: "api"                  # api / local / ollama
  model: "deepseek-chat"
  api_base: "https://api.deepseek.com"
  context_window: 0            # 0 或留空 = 自动根据模型名推断（见 2.5）；手动填写则覆盖自动值

# AU 级模型参数覆盖（可选，大多数用户不需要）
# 留空则继承全局 settings.yaml.model_params 中该模型的参数
# 使用场景："这篇文我用 DeepSeek 时想更狂野一点"
model_params_override:
  # deepseek-chat: {temperature: 1.3, top_p: 0.95}
  # 仅在需要与全局默认不同时填写

# 生成配置
chapter_length: 1500         # 每章目标字数，用户可调整
                             # ⚠️ UI 校验：若 chapter_length × 1.5（估算 token）逼近当前模型输出硬上限的 80%，
                             # 显示黄色警告："目标字数过高，可能触发模型单次输出截断"

# 文风配置（注入 system prompt）
writing_style:
  perspective: "third_person"        # third_person / first_person
  pov_character: "林深"              # perspective 为 first_person 时必填，代指"我"是谁
  emotion_style: "implicit"          # implicit（行为暗示）/ explicit（直接描写）
  custom_instructions: ""            # 用户自定义文风说明，自由填写

# 世界观继承
ignore_core_worldbuilding: false     # 是否忽略 Fandom 核心世界观（现代AU等差异极大时可设为true）

# Agent 流水线
agent_pipeline_enabled: false

# 本 AU 出场人物注册表（cast registry，静态全集；与运行时 active_chars 不同，见 4.1）
# ⚠️ 单一事实源：cast_registry 由设定库界面操作自动同步，用户不直接编辑此 YAML
# 同步规则：
#   - 设定库新建角色文件 → 自动加入对应分组
#   - 设定库删除角色文件 → 自动从 cast_registry 移除
#   - 改变角色类型（如 oc 升级为 au_specific）→ 在设定库 UI 操作，自动迁移
#
# 文件系统对账（启动时执行）：
#   考虑到"本地文件可读、天然支持 Git"，用户可能直接在磁盘新建角色文件
#   每次启动 AU 时，后端执行一次 reconcile：
#     - 扫描 characters/ / oc/ 目录，发现 cast_registry 中没有记录的文件 → 提示用户确认添加
#     - cast_registry 中有记录但文件已不存在 → 标记为 missing，提示用户
#   以"设定库界面"操作为主入口，文件系统直接修改可被 reconcile 发现，但不自动静默写入
#
# ⚠️ 分组语义（标签集合，允许重叠，不是互斥枚举）：
#   from_core：出场且使用 core_characters/ 下的核心设定（无 AU 限定补充）
#   au_specific：出场且在 characters/ 下有 AU 限定设定文件（可同时在 from_core）
#   oc：原创/功能性角色，仅存在于 oc/ 目录
#   一个角色可同时在 from_core 和 au_specific，表示"既使用核心设定，又有 AU 补充"
cast_registry:
  from_core: [林深, 陈明]      # 出场且使用 core_characters/ 下的核心设定
  au_specific: [林深, 陈明]    # 出场且在 characters/ 下有 AU 补充设定文件（可与 from_core 重叠）
  oc: [陈律师]                 # 原创/功能性角色（oc/ 目录下）
# 加载逻辑：au_specific 的角色合并核心+AU限定设定；from_core 中不在 au_specific 的只用核心设定
# cast_registry 是角色全集，供 P5 核心设定加载和角色名识别使用
# 运行时 active_chars（4.1 P4层）= 最近3章出场角色 ∪ 输入角色 ∪ chapter_focus 涉及角色，是当章子集
#
# ⚠️ 迁移风险备注：Phase 1 以角色名字符串作为 characters_last_seen / facts.characters /
#   cast_registry / 角色过滤的关键索引（名字即 key），这是临时策略。
#   Phase 2 起应预留 stable character_id（UUID），届时所有引用角色名的地方迁移为 ID 引用，
#   以支持重命名、别名、译名切换等场景。Phase 1 不需要改，但开发时避免在更多地方新增名字硬依赖。

# 核心人物（每次必带全文设定）
core_always_include: [林深, 陈明]

# 强制注入约束（P0层，绝对不可截断，优先级高于所有其他层）
# 用于写最不能被 AI 违背的铁律，如人物关系现状、剧情底线
pinned_context:
  - "林深和陈明目前还没有在一起"
  - "林深绝不会主动道歉，除非剧情已明确推进到这一步"

# RAG 配置（Phase 2 启用章节 RAG 时生效，Phase 1 保留字段备用）
rag_decay_coefficient: 0.05    # 章节时间衰减系数，越大衰减越快；0 表示关闭衰减

# Embedding 模型锁定（锁定后切换需重建向量索引）
# 留空则继承 settings.yaml 的 embedding 配置
# 警告：修改此字段后必须重建 ChromaDB 索引，否则向量检索结果将失效（Dimension Mismatch）
# 锁定整个配置快照而非仅模型名，确保能唯一标识"当前索引是怎么建出来的"
embedding_lock:
  mode: ""                     # api / local / ollama；留空继承全局配置
  model: ""                    # 模型名或本地路径
  api_base: ""                 # 若与全局不同则填写
  api_key: ""                  # 若与全局不同则填写（如全局用 DeepSeek 但本 AU 用 OpenAI 中转站跑 Embedding）

# 低保预算（Phase 1 即启用——"不崩人物"是核心价值，小 context 本地模型最先丢的就是最想保的东西）
core_guarantee_budget: 400     # 强制留给 core_always_include 的 ## 核心限制 段落，不可被 P1-P4 挤占（单位：token）

# 故事树（Phase 2 预留，Phase 1 始终为 main）
current_branch: "main"
```

### 3.5 state.yaml（运行时状态与章节推进状态）

> **注意**：此文件存放运行时状态、章节推进状态、待处理状态，不是"客观 vs 主观"的区分，而是"长期配置（project.yaml）vs 运行时变化量"的区分。

```yaml
au_id: "au_d4e5f6"            # 冗余存储，权威源为 project.yaml.au_id；此处副本供同步层快速识别归属，无需加载完整 project.yaml
                                # 新建/导入时必须与 project.yaml.au_id 同步重置
revision: 1                    # 每次运行态变更 +1（见 2.6.4 revision 预留）
updated_at: "2025-03-24T14:22:00Z"
current_chapter: 38          # 当前待写章节号（下一章编号）；已写完最新章为 current_chapter - 1
last_scene_ending: "林深关上了咖啡馆的灯"
last_confirmed_chapter_focus: ["f033"]  # 上一章确认时的 focus，供"延续上章焦点"功能读取
                                         # 来源：确认章节时写入；撤销最新一章时回退到前一章 frontmatter 的 confirmed_focus（见 6.3 步骤9）
                                         # 持久化来源：章节 frontmatter 的 confirmed_focus 字段
characters_last_seen:
  林深: 37
  陈明: 35
  陈律师: 32
chapter_focus: ["f033"]        # 本章推进焦点（fact id 数组，最多2个）；空数组则自由发挥
chapters_dirty:                # 已确认但文本被手动编辑、facts 尚未同步的章节列表
  - 22
  - 35
index_status: "ready"          # 向量索引状态：ready | stale | rebuilding | interrupted
index_built_with:              # 构建当前索引时的完整 embedding 配置快照（fingerprint）
  mode: "api"                  # api / local / ollama
  model: "text-embedding-v3"   # 模型名或本地路径
  api_base: "https://api.deepseek.com"  # 服务地址（local 模式留空）
  # 一致性校验时比对完整对象，而不只是 model 字段
  # mode + model + api_base 三者同时一致才认为索引可复用
sync_unsafe: false              # ops.jsonl 曾写入失败且靠扫描兜底恢复时标记为 true
                                # Phase 2D 进入同步前必须检查此标记（见 2.6.5）
                                # **重置机制**：UI 弹窗提示用户核对事实表和章节状态，确认无误后
                                # 可点击"我已确认状态无误，解除警告"将此标记设回 false
# ⚠️ 以上三个字段（index_status / index_built_with / sync_unsafe）属于【本地设备派生状态】，
# 描述的是本机 ChromaDB 索引和本地 ops 日志的健康状况，Phase 2D 同步时必须剔除，
# 绝对不能跨设备覆盖——否则不同设备使用不同 Embedding 模型时会触发无限重建死循环
# （如桌面用 DeepSeek embedding → 同步 → 手机发现不一致 → 重建 → 同步回桌面 → 又不一致 → 再重建...）
```

**字段归属原则**：`project.yaml` 存 AU 长期配置、写作策略、注入策略、模型策略（改动不频繁）；`state.yaml` 存运行时变化量、章节推进状态、当前焦点、待处理队列（随写作流程实时更新）。`chapter_focus`、`chapters_dirty`、`characters_last_seen` 是运行时状态，属于 state；`cast_registry`、`pinned_context`、`llm` 配置是长期策略，属于 project。

### 3.6 facts.jsonl

每行一条，**常规流程采用 append-only**（只追加不删改），通过 status 字段管理生命周期；**仅在显式章节回滚/撤销时允许物理删除该章节对应条目**（见 4.3 撤销最新一章）。

```jsonl
# ⚠️ 以下示例中的 f001/f033 等为简写，实际生成格式为 f_{时间戳}_{4位随机}（如 f_1711230000_a3xq），见 6.7 Fact ID 生成规则
{"id":"f001","content_raw":"林深在第2章提到手腕有一道旧疤，从不解释来源","content_clean":"林深手腕有一道旧疤，从不解释来源","characters":["林深"],"timeline":"现在线","story_time":"D+0","chapter":2,"status":"unresolved","type":"character_detail","narrative_weight":"high","created_at":"2025-03-20T09:00:00Z","updated_at":"2025-03-20T09:00:00Z"}
{"id":"f031","content_raw":"林深在第35章主动先开口道歉","content_clean":"林深曾经主动先开口道歉","characters":["林深","陈明"],"timeline":"现在线","story_time":"D+89","chapter":35,"status":"active","type":"plot_event","narrative_weight":"medium","created_at":"2025-03-22T14:00:00Z","updated_at":"2025-03-22T14:00:00Z"}
{"id":"f033","content_raw":"第31章陈明说了句没说完的话，两人都没再提","content_clean":"有一句没说完的话，两人都没有再提起","characters":["陈明","林深"],"timeline":"现在线","chapter":31,"status":"unresolved","type":"foreshadowing","narrative_weight":"high","created_at":"2025-03-21T11:00:00Z","updated_at":"2025-03-21T11:00:00Z"}
{"id":"f004","content_raw":"第10章揭示林深手腕的疤是当年救陈明留下的","content_clean":"林深手腕的疤是当年救陈明留下的","characters":["林深","陈明"],"timeline":"现在线","chapter":10,"status":"resolved","type":"character_detail","resolves":"f001","narrative_weight":"high","created_at":"2025-03-18T10:00:00Z","updated_at":"2025-03-22T16:00:00Z"}
```

**字段说明：**

| 字段 | 说明 |
|------|------|
| content_raw | 带章节编号，用于管理和追溯 |
| content_clean | 纯叙事描述，注入 prompt 时用这个（防格式污染） |
| characters | 涉及的角色列表，支持按角色过滤 facts |
| timeline | 所属时间线标签，用户自定义 |
| story_time | 故事内时间（可选），用于时间线排序 |
| chapter | 产生于第几章（叙事时间） |
| status | `active`：当前有效事实，已发生，参与上下文注入 / `unresolved`：当前有效且伏笔尚未推进完成（比 active 优先级更高，注入时优先保留，chapter_focus 优先从此选取）/ `resolved`：伏笔已被剧情消解，不再注入上下文，可用于 RAG 历史召回 / `deprecated`：被新事实替代而废弃，不参与任何注入或召回 |
| type | character_detail / relationship / backstory / plot_event / foreshadowing / world_rule |
| resolves | 若本条解决了某个伏笔，填被解决的 fact id |
| narrative_weight | low / medium / high；Phase 2 Director Agent 据此自动挑选 chapter_focus，Phase 1 用户手动填写供参考 |
| source | `manual`（用户手动创建/编辑）/ `extract_auto`（轻量提取自动生成）/ `import_auto`（导入时自动提取）；Phase 1 写入但不参与业务逻辑，Phase 2 档案员据此区分人工修订与自动提取的可信度优先级——**人工修订永远高于自动提取** |
| revision | 每次该条 fact 被编辑时 +1，初始为 1；Phase 1 写入，Phase 2D 同步冲突检测消费（见 2.6.4） |

**unresolved fact 推进但未完结时的状态迁移规则：**
- 只要伏笔/悬念仍未完全消解，该 fact **保持 `unresolved`**，用户可在 `content_clean` 中追加推进备注（如"第40章有进一步暗示但未揭晓"）
- 仅当悬念功能已消失、但事实本身仍有效时，才转为 `active`（如"那句没说完的话"已不再是悬念，但说话本身是已发生事实）
- 若推进过程中产生了新的未完成悬念，**新建一条 `unresolved` fact**，不复用旧条目——保持每条 fact 语义单一，避免一条 fact 承载多层含义导致后期维护混乱

### 3.7 timeline.yaml

**Phase 1 定位：** 仅用于前端时间轴可视化（用户手动维护事件列表），**不参与任何上下文过滤或排序逻辑**。Phase 1 的 facts 过滤严格依赖 `status` 字段和 `chapter` 字段，不依赖 `story_time`。Phase 2 启用档案员后，可扩展为自动时间冲突检测；Phase 2 引入时间解析引擎后，可支持 `story_time ≤ 当前场景时间` 的精确过滤。

```yaml
axes:
  现在线:
    anchor: "故事开始"
    events:
      - {story_time: "D+0",  chapter: 1,  summary: "林深咖啡馆开业"}
      - {story_time: "D+15", chapter: 3,  summary: "陈明第一次进店"}
      - {story_time: "D+89", chapter: 35, summary: "林深道歉"}

  三年前:
    anchor: "大学毕业前"
    events:
      - {story_time: "Y-3",    chapter: 8,  summary: "两人初识"}
      - {story_time: "Y-3+2m", chapter: 15, summary: "那件没说清楚的事"}

  林深记忆碎片:
    anchor: "不定时插叙"
    events:
      - {story_time: "unknown", chapter: 22, summary: "手腕那道疤的来源"}
```

### 3.8 世界观继承规则

与人物设定相同，世界观也分两层：

```
core_worldbuilding/（Fandom 级别，全 AU 通用）
  → 适合放：作品原有的世界规则、背景设定
  → 例：原神的提瓦特大陆基本设定

aus/{au_name}/worldbuilding/（AU 级别）
  → 适合放：AU 特有的世界观
  → 例：现代 AU 的城市背景、咖啡馆设定
  → 可以和核心世界观完全无关（如现代 AU 基本不用原有世界观）
```

**合并规则：**
- AU 世界观文件与核心世界观文件**同名**时：AU 版本完全覆盖
- 不同名时：两者都注入，AU 版本优先级更高
- 现代 AU 等与原作世界观差异极大时：可在 project.yaml 中设置 `ignore_core_worldbuilding: true`，完全跳过核心世界观（字段已在 3.4 project.yaml 中定义）

### 3.9 人物设定文件

**核心设定（core_characters/林深.md）：**

```markdown
---
name: 林深
aliases: ["深深", "林老板"]    # 别名列表，用户手动维护；scan 时匹配别名自动映射回主名
core: true
---

## 核心限制
外冷内热，不主动示弱，情绪激动时会摘手表。
（此段为低保摘要，2-3句，预算紧张时只注入这里）

## 性格
外冷内热，习惯用沉默代替表达...

## 行为细节
- 情绪激动时会摘手表
- 从不主动联系人，但会记住所有细节

## 背景
...
```

**注意**：`## 核心限制` 段落是低保机制使用的精简摘要，`build_core_summary()` 只提取这一段。**Phase 1 即生效**：当 P5 层预算不足以容纳完整角色设定时，`core_always_include` 角色的 `## 核心限制` 段落在 `core_guarantee_budget`（默认 400 token）的保护下不可被挤占。内容建议控制在 2-3 句以内，写最不能丢的人设约束。

**AU 限定设定（characters/林深.md）：**

```markdown
---
name: 林深
aliases: ["深深", "林老板"]    # 继承或覆盖核心设定的别名
au_override:              # 覆盖核心设定的字段
  - "背景：改为咖啡馆老板，28岁，非武将出身"
---

## AU 补充
现代咖啡馆老板，28岁...

## 与陈明的关系（AU 版本）
表面上是多年不见的旧识...
```

**功能性角色 / OC（oc/陈律师.md）：**

```markdown
---
name: 陈律师
aliases: ["陈大状"]           # 别名，可选
type: functional          # functional / oc
importance: medium        # low / medium / high（动态可升级）
first_appeared: 3
---

外表温和内心冷酷，40岁，反派幕后黑手。
与陈明有不为人知的秘密关联。
```

importance 字段决定注入方式：
- low：全量注入简短描述
- medium：按需 RAG 召回
- high：等同主要角色处理

---

## 4. 核心模块设计

### 4.1 上下文组装器

每次写作前自动拼装，六层结构（含新增 P0 强制注入层）：

**token 分配：优先级倒序填充（水位线机制）**

不对 P1-P5 各层预先分配固定比例；仅在总输入/输出层面保留 60/40 水位线。各层之间按优先级从高到低依次填充，前面的层填不满才给后面的层用：

```python
def assemble_context(project, user_input) -> list[dict]:
    # 返回标准 messages 数组，格式：[{"role": "system", ...}, {"role": "user", ...}]
    # 绝不能返回字符串——现代模型 API 全部要求 messages 数组格式
    # ── context_window 自动推断（见 2.5）──
    context_window = project.llm.context_window or infer_context_window(project.llm.model)

    # ── 先渲染 System Prompt（含 P0 Pinned），从总预算中扣除 ──
    # ⚠️ P0 Pinned Context 属于 System Role，必须在 build_system_prompt() 内注入，
    # 绝不能放入 layers[]——否则 reverse 后会混入 User 消息底部，
    # 且无法获得 System Role 的高优先级
    system_prompt = build_system_prompt(project)
    # build_system_prompt 内部结构：
    #   1. P0 Pinned Context（保护壳包装）
    #   2. 冲突解决规则
    #   3. 叙事视角 / 情感风格 / 伏笔规约 / 通用规则
    #   4. custom_instructions（过长时优先裁剪此段）
    system_tokens = count_tokens(system_prompt, project.llm)
    budget = int(context_window * 0.60) - system_tokens
    # 预算取 60% 而非 70%：中文场景下 tiktoken 估算误差可达 30%，保守取值防超限
    # ── fail-safe：budget 可能为负（system prompt 过长）──
    if budget <= 0:
        # 优先裁剪 custom_instructions（最低优先级，重新渲染 system_prompt）
        system_prompt = build_system_prompt(project, trim_custom=True)
        system_tokens = count_tokens(system_prompt, project.llm)
        budget = int(context_window * 0.60) - system_tokens
    if budget <= 0:
        # custom 裁完仍不够 → 阻止生成，前端提示"Pinned/自定义说明过长，请精简"
        raise ValueError("system_prompt_exceeds_budget")

    # ── max_tokens：显式传给 API，防止默认值过小导致断章 ──
    # ⚠️ 绝大多数 API 对单次输出有硬性上限（通常 4096 或 8192），
    # 直接传 context_window * 0.40 可能超限导致 400 Bad Request
    # get_model_max_output() 必须返回 min(模型硬性API输出上限, context_window * 0.40)
    # 主流模型硬上限示例（维护在 model_context_map.py）：
    #   gpt-4o: 4096（标准）/ 16384（extended output beta）
    #   deepseek-chat: 8192
    #   claude-3-7-sonnet: 64000（extended thinking）/ 8192（standard）
    #   qwen-max: 8192
    # 若映射表中无记录，保守默认值 4096
    max_tokens = min(get_model_max_output(project.llm.model),
                     int(context_window * 0.40))

    used = 0
    layers = []
    # layers 只收集 User Role 内容（P1–P5），P0 已在 system_prompt 中

    # P1·最高优先级：当前指令（必须完整保留）
    instruction = build_instruction(project, user_input)
    layers.append(instruction)
    used += count_tokens(instruction, project.llm)

    # P3：事实表（收集顺序在 P2 之前，reversed 后 P3 比 P2 更靠近生成点）
    # facts = "事实约束"，recent = "语境背景"，约束应比背景更靠近生成点
    # ⚠️ 结构分离原则：
    # - chapter_focus 中的 facts 已在 P1 build_instruction() 中显式注入为"推进目标块"
    # - P3 只注入其余 facts（背景层），并在注入时附带"不可主动推进"的约束提示
    facts = get_facts(project)
    facts = truncate_facts(facts, budget - used, project.llm)
    layers.append(facts)
    used += count_tokens(facts, project.llm)

    # P2：最近章节原文（收集顺序在 P3 之后，reversed 后 P2 在 P3 前面，P3 更靠近生成点）
    recent = get_recent_chapter(project)
    # ⚠️ get_recent_chapter() 内部必须预先剥离 YAML Frontmatter（使用 frontmatter.loads()），
    # 否则 LLM 会在上下文中看到 chapter_id / revision / confirmed_focus 等系统标记并"有样学样"输出
    # 同理，last_scene_ending 提取也必须基于剥离后的纯正文
    recent = truncate_to_budget(recent, budget - used, project.llm)
    layers.append(recent)
    used += count_tokens(recent, project.llm)

    # P4：RAG 召回（有多少预算用多少；按活跃角色过滤）
    # 活跃角色 = 过去3章出场角色 ∪ user_input 中提取的已知角色名 ∪ chapter_focus 涉及角色
    # 扩大到3章窗口：防止配角短暂掉线后 AI 无设定可用而幻觉乱编
    prev_chars = get_recent_chapters_characters(project, n=3)  # 取最近3章出场角色合集
    input_chars = extract_known_characters(user_input, project)
    # extract_known_characters 同样匹配 aliases，返回主名；如输入含"公子"则返回"达达利亚"
    # ⚠️ chapter_focus 涉及角色必须纳入：用户选定焦点伏笔后，该伏笔关联角色的设定
    # 必须能被 RAG 召回，否则会出现"焦点已选中，但 AI 缺该角色上下文"的体验断裂
    focus_chars = []
    for fid in project.state.chapter_focus:
        fact = get_fact_by_id(fid, project)
        if fact:
            focus_chars.extend(fact.get("characters", []))
    active_chars = list(set(prev_chars) | set(input_chars) | set(focus_chars))
    # 兜底：第一章或无法识别角色时，active_chars 为空会导致 ChromaDB $in:[] 报错
    # 降级为核心主角列表，确保始终有结果
    if not active_chars:
        active_chars = list(project.core_always_include)
    # ⚠️ 最终安全网：若 core_always_include 也为空（如纯 OC 项目未配核心角色），
    # 直接丢弃角色过滤条件，RAG 退化为全局语义检索（Global Search），
    # 确保查询永远不会因空数组报错而阻断生成流程
    char_filter = active_chars if active_chars else None  # None = 不传角色过滤条件
    # ⚠️ RAG query 必须动态组装，不能直接用 user_input
    # 嗑粮模式下 user_input 可能只有"继续"、"然后呢"等极短输入，直接检索会召回垃圾
    # 组装规则：[chapter_focus 的 content_clean] + [last_scene_ending] + [user_input]
    # 若 user_input 长度 < 5 字，优先依赖 focus 和上章结尾语义进行召回
    #
    # ⚠️ 重要：chapter_focus 存的是 ID 数组（如 ["f033","f012"]），不能裸传 ID 去检索
    # 必须先从 facts.jsonl 中映射出对应的 content_clean 纯文本，再参与 query 组装
    # 错误写法：build_rag_query(project.state.chapter_focus, ...)  → 得到 "['f033'] 林深关上了门"
    # 正确写法：focus_texts = [get_fact_content(fid) for fid in project.state.chapter_focus]
    focus_texts = [get_fact_content_clean(fid, project) 
                   for fid in project.state.chapter_focus]
    rag_query = build_rag_query(
        focus_texts,                           # focus 语义最相关（已映射为文本）
        project.state.last_scene_ending,       # 上章结尾提供衔接语境
        user_input                             # 用户输入补充
    )
    rag = retrieve_rag(project, rag_query, budget - used,
                       char_filter=char_filter)
    # ⚠️ RAG 超预算处理：不能直接按字符截断 chunk（会破坏语义导致幻觉）
    # 策略：两轮检索
    # 第一轮：top_k=3，检查返回文本是否超出剩余 budget
    # 若超出：降低 top_k（每次减1）重新检索，直到结果 token ≤ budget 或 top_k=1
    # 若 top_k=1 仍超出：截取至最近完整句号处（不截断半句），宁少勿烂
    layers.append(rag)
    used += count_tokens(rag, project.llm)

    # P5·最低优先级：核心设定（用剩余预算，超出时截断低 importance 角色）
    core = get_core_settings(project, budget - used)
    layers.append(core)

    return build_prompt(system_prompt, reversed(layers),
                        max_tokens=max_tokens)
    # ⚠️ 为什么要 reversed()：
    # layers 收集顺序：P1 → P3 → P2 → P4 → P5（P3 在 P2 之前收集）
    # reversed 后注入顺序：P5 → P4 → P2 → P3 → P1
    # 效果：P3（事实约束）比 P2（最近章节）更靠近生成点，确保约束优先于语境
    # LLM 对"更靠近末尾的内容"权重更高，最重要的内容（P1 当前指令）离生成点最近
```

**零章节冷启动退化策略（新建 AU 首次生成时）：**

新建 AU 尚无任何已确认章节时，各层自然退化为：
- P2 最近章节 = 空（无已确认章节可读取）
- `last_scene_ending` = 空字符串
- P4 RAG = 空（ChromaDB 无数据可召回）
- P3 facts = 空或仅包含用户手动添加的初始设定
- `active_chars` 降级为 `core_always_include`
- 首次生成 prompt 实际生效层：`pinned_context`（P0）+ `core_always_include` 角色设定（P5）+ 用户输入（P1）
- 这是预期行为，不需要特殊分支处理——组装器各层遇到空数据时返回空字符串即可，不应抛异常

**Token 超限裁剪顺序（deterministic，开发时必须严格遵守）：**

当总 token 超出预算时，按以下顺序从后往前削减，直到预算满足：

```
1. P5 核心设定：按 importance 从低到高截断角色
2. P4 RAG 召回：逐步降低 top_k（3→2→1），不截断 chunk 文本；top_k=1 仍超出则截至最近完整句号
3. P2 最近章节：截取末尾，最少保留 500 字
4. P3 事实表：只截 active，unresolved 软降级处理（见下方说明）；
   唯一截断算法：① 综合排序（narrative_weight 降序优先，同等权重内按 chapter 倒序）→ ② 从前往后累加 token 直到预算 → ③ 保留这些 fact → ④ 最终按正序（从旧到新）注入 prompt
5. P1 当前指令：永不截断
6. P0 Pinned：永不截断
```

**注意**：主流模型 context window 128k+，P1-P4 将核心设定完全挤出的概率很低。但本地小 context 模型下此风险真实存在，因此 Phase 1 即启用低保机制（`core_guarantee_budget`，默认 400 token），为 `core_always_include` 的 `## 核心限制` 段落预留不可挤占的最小预算。

**Context Assembler 策略执行链（按顺序执行，不是并发规则）：**

```
1. 候选筛选：按 status（active + unresolved）过滤 facts
2. 标记强制保留：chapter_focus 中的 facts 标记为不可截断
3. 软降级判断：unresolved facts 超预算时按 narrative_weight + recency 排序保留 top N
4. active facts 截断：倒序取 top N（满足预算），最终正序注入
5. RAG 过滤：按 active_chars（3章窗口 ∪ 输入角色 ∪ chapter_focus 涉及角色）过滤
6. fallback：RAG 结果不足时放宽为全局查询
7. 核心设定截断：importance 从低到高裁剪
```

规则不是"同时存在"而是"按顺序执行"——后一步依赖前一步结果，不能乱序。

**不对 P1-P5 各层预先分配固定比例；仅在总输入/输出层面保留 60/40 水位线。**

**概念优先级（截断时保留顺序，与填充顺序不同）：**
0. Pinned Context（绝对不截，P0）
1. 当前指令（必须完整）
2. 事实表（facts 是约束，active 权重+recency 截断；**unresolved 不走常规截断算法，仅在 unresolved 总量自身超出预算时触发独立软降级规则，见下方说明**）
3. 最近章节原文（recent 是语境，尽量完整，不足时截尾）
4. RAG 召回设定（有多少预算用多少，按活跃角色过滤）
5. 核心设定（最后填入，超出时截断 importance 低的角色）

**实际 layers 收集顺序（代码实现）：** P1 → P3 → P2 → P4 → P5（P3 在 P2 之前收集，reversed 后 P3 比 P2 更靠近生成点）

**[P0·绝对优先] Pinned Context**
- 来源：project.yaml 的 `pinned_context` 列表
- 用途：写最不能被违背的叙事铁律（关系现状、剧情底线等）
- 绝对不可截断，属于 **System Role**（在 `build_system_prompt()` 内注入，不进入 `layers[]`）
- **Pinned 是"当前阶段约束"，不是永久真理**：随着剧情推进，用户应主动更新或删除已过期的条目。系统不自动清理，由用户在 AU 设置页手动维护。
- **注入模板（Show, don't tell 保护壳）：**

```
[后台核心铁律——通过行为自然体现，绝不直接陈述]
以下是不可逾越的叙事底线。请通过人物行为、对话、细节自然体现（Show, don't tell），
绝对不要将这些规则直接写成旁白或心理活动陈述。
{pinned_context 每条一行}
```

**[优先级5·最低] 固定核心设定**
- core_always_include 的人物：核心设定 + AU 限定设定合并
- 合并规则：AU 限定设定优先级高于核心设定（覆盖字段以 AU 版本为准）
- importance=low 的功能性角色全量注入简短描述
- 超出预算时按 importance 从低到高截断

**[优先级4] RAG 动态召回**
- 根据用户输入，从向量库检索相关设定 chunks
- collections：`characters`（核心+AU限定人物）/ `worldbuilding`（世界观）/ `oc`（功能性角色+OC）
- top_k：每个 collection 取 3 个 chunk（Phase 1 固定值，作为复杂度控制策略，不代表长窗口模型上的最优召回量；Phase 2 可评估动态 top_k，根据剩余预算自适应调整）
- **角色过滤**：查询时带 `where: {"characters": {"$in": active_chars}}` 过滤（`active_chars` 是运行时推导的当章子集，不是 `cast_registry` 全集），只召回本章活跃角色相关内容，防止无关角色设定污染
- **过滤 fallback**：若过滤后每个 collection 召回结果 < 2 条（说明 active_chars 列表覆盖不全），自动放宽为不带角色过滤的全局查询，取 top 3；防止 AI 引入新角色时因不在活跃列表而完全召不回设定
- 过滤掉已在核心设定层的内容

**[优先级3] 事实表**
- **Phase 1 过滤规则**：仅按 `status=active 或 unresolved` 过滤。`story_time` 字段（如 `"D+89"`、`"Y-3"`）是字符串格式，Phase 1 不做数学比较——时间线逻辑交由模型根据 `timeline` 标签和内容语义自行理解（facts 里已有 `timeline: 现在线` 等标注，足够模型判断）
- **Phase 2** 可扩展为：引入时间解析引擎，实现 story_time ≤ 当前场景时间的精确过滤
- 注入格式：使用 content_clean，不含章节编号，始终第三人称
- **唯一截断算法（active facts 超预算时）**：
  1. 综合排序：**先按 narrative_weight 降序（high > medium > low）**，同等权重内按 chapter **倒序**（最新在前）——确保丢弃的是低价值近期事实，而非早期高权重底层设定
  2. 从前往后累加 token，直到达到预算上限
  3. 保留这些 fact
  4. 最终将留下的 facts 按 chapter **正序（从旧到新）**重新排列后注入 Prompt
  - 注意：步骤1-3是"筛选"，步骤4是"注入顺序"，两个方向不能混淆
- unresolved facts 全部保留（软降级见下方说明），不参与上述截断
- **合并注入规则**：P3 最终注入 Prompt 前，必须将保留下来的 `active` 条目与 `unresolved` 条目合并为一个数组，并**统一按 `chapter` 字段正序（升序）排列**后注入——确保模型读取到的始终是符合时间发展顺序的客观纪事，避免因 active/unresolved 分组边界导致事件因果错乱

**[优先级2] 最近章节原文**
- 最近 1 章完整原文
- 若超出预算，截取最近 2000 字
- **注入顺序说明**：在最终 prompt 中，P3（事实表）位于 P2（最近章节）之后、更靠近生成点。原因：facts 是"事实约束"，recent 是"语境背景"，约束比背景更应靠近生成点，确保模型优先遵守 facts 而非仅延续语感。代码实现时 layers 收集顺序为 P1→P3→P2→P4→P5，reversed 后得到正确的注入顺序 P5→P4→P2→P3→P1。

**[优先级1·最高] 当前指令**
- state.yaml 中的运行时状态（章节数、上章结尾）
- `chapter_focus`（本章推进焦点，见下方说明）
- 用户本次输入

**chapter_focus 主驱动锁规则：**

当 `chapter_focus` 非空时，facts 系统变为"双轨制"：
- **chapter_focus 中的 facts**：主驱动，模型必须优先推进，按推进目标块注入 P1
- **其余 unresolved facts**：仅作为世界背景，模型不应主动推进，由背景信息使用规则约束

若不设置此规则，模型会同时响应 chapter_focus 和其他 unresolved facts，导致"明明选了焦点，剧情仍然跑偏"。

**统一冲突仲裁规则（三套优先级系统的最终决策顺序）：**

系统中存在三套优先级：P0-P5 prompt 层级、facts 内部优先级（unresolved/weight/recency）、chapter_focus 控制权。当它们产生冲突时，以下规则为最终裁决：

```
内容推进链优先级（由高到低）：
1. chapter_focus（当前章节唯一推进目标，覆盖其他 facts）
2. facts（按 unresolved > active，weight > recency 排序）
3. 最近章节语境（RAG 召回的历史片段）

外层硬约束（不参与推进链竞争）：
• pinned_context：叙事底线约束，System Role 注入，不能被推进链自动覆盖；
  若与 facts 产生冲突，说明 pinned 已过期，系统标注 ⚠️ 警告，由用户手动更新

冲突处理原则：
- chapter_focus 覆盖其他所有 unresolved facts 的推进权
- facts 覆盖 recent chapter（冲突时以 facts 为准）
- pinned 与 facts 冲突时：不自动废弃 pinned，Context 面板标注警告
- 模型永远不应试图同时满足冲突双方
```

**Pinned 与 Facts 冲突的处理方式：**
- 系统在组装 context 时做**粗粒度**冲突提示（简单关键词重叠检测，不保证发现所有语义冲突）；发现重叠时在 Context 面板标注⚠️，由用户判断是否真的冲突
- 发现冲突时在 Context 可视化面板标注⚠️警告，提示用户"该 Pinned 条目可能已过期，请检查"
- **不自动废弃 pinned**——用户有义务维护 pinned 的时效性

**chapter_focus vs Agent 默认权威：**
- 若用户**未选择** chapter_focus → Agent 推荐方案自动生效
- 若用户**已选择** chapter_focus → Agent 仅展示推荐理由，不自动覆盖用户选择
- UI 明确区分"推荐（来自 Agent）"和"当前生效（来自用户选择）"两种状态

**chapter_focus 控制权（按模式区分）：**
- **嗑粮模式**：由用户手动选择（Agent 流水线默认关闭），界面推荐但不强制
- **创作模式 + Agent 流水线开启**：由 Director Agent 自动从 unresolved 列表挑选并写入细纲，用户可在细纲确认阶段 override
- 两种模式可随时切换，切换后 chapter_focus 控制权跟着模式走

**chapter_focus 机制（facts 驱动力）：**

facts 是"记忆"，`chapter_focus` 是"当前该干什么"。两者分开才能保证剧情往前走。

`chapter_focus` 存储在 state.yaml 中，为数组，最多 2 个 fact id：

```yaml
chapter_focus: ["f033", "f012"]  # 最多2个；空数组 [] = 自由发挥
```

**chapter_focus 合法性校验规则：**

- 只能选 `status == unresolved` 的 fact；不允许选 active / resolved / deprecated
- UI 层在渲染候选列表时只展示 unresolved 条目，后端写入前二次校验
- **悬空 ID 级联清理**：对任何 fact 执行状态变更（→ deprecated / resolved）或物理删除时，后端必须检查 `state.yaml` 的 `chapter_focus` 和 `last_confirmed_chapter_focus` 数组：
  - **`last_confirmed_chapter_focus`**：静默移除该 fact id（历史快照，不影响当前写作）
  - **`chapter_focus`（当前章焦点）**：**不静默清理**——若被变更的 fact 正在当前 chapter_focus 中，写作界面焦点选择器显示红字警告："⚠️ 当前焦点事实状态已变更，请重新选择"，并阻断基于该焦点的续写，强制用户重新确认意图。防止用户以为仍在推进某伏笔但系统实际已切换为"自由发挥"
- **历史引用容错**：章节 frontmatter 的 `confirmed_focus` 是写入时的快照，不做回写清理。读取时（如 undo 回退、"延续上章焦点"）若发现 fact id 已不存在或 status 非 unresolved，静默跳过该条目，不报错不阻断——历史章节的 frontmatter 允许包含失效引用，它是审计记录而非运行时依赖
- 确认章节后若 chapter_focus 中的 fact 在本章已被解决（status → resolved），下章"延续上章焦点"时自动跳过该条目

写作界面在输入框旁边显示所有 `unresolved` facts 列表，用户点选最多 2 个"设为本章焦点"，界面默认高亮推荐 1 个 `narrative_weight: high` 的 fact。不选则空数组，模型自由发挥。

设置后，P1 层根据 `chapter_focus` 是否为空，注入不同的块：

**当 `chapter_focus` 为空数组 `[]` 且存在 unresolved facts 时，注入铺陈指令：**
（若 unresolved facts 为 0——如新建 AU 首章——则不注入此块，避免 LLM 凭空幻觉出"悬念"来强行"保持悬而未决"）

```
## 本章叙事节奏
本章以延续当前剧情和铺陈氛围为主。
除非用户的具体指令中明确要求推进或解决某项事件，否则保持所有已有伏笔悬而未决，不要急于解决任何悬念，也不要随意挑选 unresolved 事项填坑。
```

这条指令防止模型在看到一堆 unresolved 事项时自行随机填坑。

**当 `chapter_focus` 非空时，注入推进目标块（遍历数组，每个 focus 一行）：**

```
## 本章核心推进目标（必须执行）
请在本章剧情中，对以下悬念给出实质性推进。
"推进"的定义：信息有新增、关系发生变化、或冲突更激化/更接近解决。
"只是顺口提到"或"只是描写氛围/情绪"不算推进。
推进必须带来可感知的新信息或状态变化，使读者阅读后明确感觉剧情比之前更接近某种结果。
如果本章结束后该节点仍无任何实质变化，视为未完成推进。
- {chapter_focus 对应的 content_clean}

## 本章特别注意（仅列最易被触发的1-2个高权重悬念，勿主动推进）
以下悬念极易被顺带提及，请特别克制，本章保持悬而未决：
- {从非 focus 的 unresolved 中筛选 narrative_weight: high 的条目，最多2条}
（注：不全量列出禁止推进列表——大量罗列"禁止"会增加模型对这些词汇的注意力权重，反而适得其反）

## 背景信息使用规则
"当前剧情状态"中其余 unresolved 事项仅作为世界背景。
除非当前指令明确要求，否则保持悬而未决，不要主动解释或解决它们。
```

**Unresolved 软降级（长篇保护）：**

"unresolved 不参与 active facts 的常规截断算法"——这是核心规则。但写到 100 章后 unresolved 可能累积数十条，自身超出 token 预算。此时触发独立软降级规则：

```
正常情况（unresolved 总量 ≤ 预算）：全量注入，不截断
当 unresolved 自身总量超出预算时（独立软降级）：
  1. 按 narrative_weight（high > medium > low）优先保留
  2. 同权重内按 chapter 倒序（更近的优先）
  3. 保留 top N 条完整注入
  4. 剩余条目合并为一行背景摘要注入：
     "（另有 X 条未解决伏笔暂未展示，详见事实表）"
```

**这套软降级规则同时覆盖"unresolved 自身超出预算"的极端情况**——即使 unresolved 总量已超过预算，也按上述规则保留 top N，而不是强行截断（违反规则）或挤爆其他层。系统永远不会因为 unresolved 过多而报错或生成失败。

用户在 Context 可视化面板中可以看到是否触发了软降级。
- 低保机制（Phase 1 即生效）：在 P5 基础上，强制为 core_always_include 预留 `core_guarantee_budget`（默认 400 token）的精简设定（`## 核心限制` 段落），不可被 P1-P4 挤占
- 章节 RAG 时间衰减：历史章节检索加距离惩罚重排序，`rag_decay_coefficient` 可配置
  - **⚠️ 衰减仅对 `chapters` collection 生效**，`characters` 和 `worldbuilding` collection 不受距离惩罚——静态设定（如"主角对坚果过敏"）不应因距离久远而权重降至 0
- Director Agent（批量模式）：自动从 unresolved 列表挑选 1-2 个作为 `chapter_focus` 写入细纲，不再依赖用户手选

**prompt 结构示例：**

```
[System]
你是一位专业的小说作者。

# 后台核心铁律——通过行为自然体现，绝不直接陈述
以下是不可逾越的叙事底线。请通过人物行为、对话、细节自然体现（Show, don't tell），
绝对不要将这些规则直接写成旁白或心理活动陈述：
林深和陈明目前还没有在一起。
林深绝不会主动道歉，除非剧情已明确推进到这一步。

# 冲突解决规则（重要）
当"上一章结尾"、"召回的历史设定片段"与"当前剧情状态（事实表）"发生语义冲突时，
必须且只能以"当前剧情状态（事实表）"为绝对事实依据，忽视其他冲突信息。

若发现"后台核心铁律（pinned_context）"与"当前剧情状态"存在矛盾，请照常执行任务，
系统将在外部提示用户更新过期的铁律条目。

# 叙事视角（来自 writing_style.perspective）
以第三人称叙事视角写作。
# 若 perspective = first_person，则改为：
# 以林深的第一人称视角写作。以下"客观事实"描述的是林深所处的世界状态，
# 请将其转化为林深的主观感知、心理活动和第一人称动作描写。

# 情感表达风格（来自 writing_style.emotion_style）
偏好用行为和细节暗示情绪，避免直接陈述心理状态。
# 若 emotion_style = explicit，则改为：可以直接描写人物心理和情绪。

# 伏笔使用规约（重要）
"当前剧情状态"中标注为 unresolved 的内容，是当前世界中成立的背景约束。
除非指令中明确要求推进，否则请保持其悬而未决，仅作氛围点缀。
不要强行解释或解决任何 unresolved 伏笔，也不要只是顺手"提一句"来刷存在感。

# 通用规则
不要出现任何章节编号或叙事外的结构性标注。
所有背景信息通过人物行为、心理、对话自然呈现。
本章目标字数约 {chapter_length} 字。

# 用户自定义文风（来自 writing_style.custom_instructions，若非空则追加）
{custom_instructions}

[User]
## 人物设定
{优先级5·核心设定 + 优先级4·RAG召回}

## 上一章结尾
{优先级2·最近章节原文}（P2 在前，距生成点较远）

## 当前剧情状态
{优先级3·事实表，使用 content_clean，始终为第三人称客观描述}（P3 在后，更靠近生成点——约束比语境更应靠近生成点）

## 当前状态
现在是第38章。上一章结尾：林深关上了咖啡馆的灯。

## 本章核心推进目标（若 chapter_focus 非空则注入此块，否则省略）
请在本章剧情中，对以下悬念给出实质性推进。
"推进"的定义：信息有新增、关系发生变化、或冲突更激化/更接近解决。
"只是顺口提到"或"只是描写氛围/情绪"不算推进。
推进必须带来可感知的新信息或状态变化，使读者阅读后明确感觉剧情比之前更接近某种结果。
如果本章结束后该节点仍无任何实质变化，视为未完成推进。
- {chapter_focus[0] 对应 fact 的 content_clean}
- {chapter_focus[1] 对应 fact 的 content_clean}（若只有1个则省略此行）

## 请续写
{优先级1·用户输入}
```
**⚠️ 续写 vs 指令模式的注入差异**：上述 `## 请续写 / {用户输入}` 仅适用于"续写"模式。当用户选择"指令"模式时，`build_instruction()` 应将用户输入包装为写作要求块（如 `## 写作要求：{user_input}`），明确告知模型此段内容是写作方向指令而非正文起点，不应作为续写的开头出现在生成文本中。

**⚠️ 工程实现注意（给 Claude Code / AI 程序员）：**

以上 `[System]` / `[User]` 结构**仅为人类阅读示意图**，绝对不能在代码里拼成一整个字符串发给 API。

`assemble_context()` 必须返回标准的 **messages 数组格式**：

```python
return [
    {"role": "system", "content": system_prompt},   # P0 + 所有 System 层内容
    {"role": "user",   "content": user_content}     # P5→P1 拼装的 User 层内容
]
```

所有现代大模型 API（GPT-4o、Claude、DeepSeek）均要求此格式。使用单一字符串拼接会导致 System 指令权限失效或 API 直接报错。

facts.jsonl 中的 `content_clean` 字段**永远使用第三人称客观描述**（如："林深手腕有一道旧疤"），不随写作视角改变。视角转换完全由 system prompt 处理。

这样做的原因：
- 向量检索基于 content_clean，第三人称描述语义一致，避免人称不同导致的匹配混乱
- 同一套 facts 数据库可以支持任意视角切换，无需维护多份数据

### 4.2 写作引擎

#### 交互模式

```
用户在对话框输入
    ↓
判断输入类型（用户手动选择）：
  [续写] → 作为正文起点，AI 接续写入正文
  [指令] → 作为写作要求，不出现在正文里
    ↓
上下文组装器组装 prompt
    ↓
[可选] Agent 流水线
    ↓
流式输出到前端（打字机效果）
    ↓
生成结果作为草稿，未正式提交
用户可：确认 / 重新生成 / 修改输入后重新生成 / 调参重新生成
    ↓
确认后：写入 chapters/main/ + 向量化（档案员触发为 Phase 2 功能）
```

**空意图处理：**
用户输入"然后呢"、"继续"、空输入等 → 识别为空意图 → 不添加任何场景约束 → 纯自由发挥

**生成任务幂等规则（防重复点击）：**
- 同一 `chapter_num` 在存在进行中的生成任务（`generating` 状态）时，前端 `[续写]` 按钮置灰禁用，后端拒绝重复请求（返回 409 Conflict）
- 生成完成（写入 .drafts/）或失败后才解锁下一次生成
- 若用户在不同浏览器标签页打开同一 AU 写作界面，以先发起生成请求的标签页为准，后发请求被拒绝并提示"该章节正在生成中"

#### 批量模式（Phase 2）

```
用户设定：
  - 目标章节数（1-20章）
  - 整体方向描述
  - 关键节点（可选）："第3章必须发生XX"
    ↓
导演 Agent 生成分章大纲
用户确认或修改大纲
    ↓
逐章生成：
  每章生成前：更新事实表 → 重新组装上下文
  每章生成后：档案员自动提取 facts（待定状态，Phase 2 功能）
    ↓
全部完成后，章节列表呈现
用户逐章查看 / 编辑 / 确认
```

### 4.3 草稿机制

同一章可以有多个草稿，只有用户主动确认后才正式提交：

**草稿持久化：**

草稿生成后立即写入 `chapters/.drafts/ch038_draft_A.md`，不依赖浏览器 localStorage。用户刷新或关闭浏览器后重新打开，草稿仍然存在。确认某一稿后，`.drafts/` 中该章所有草稿文件自动清理。

**草稿恢复 UI 初始化：**

进入写作界面时，前端首先拉取 `.drafts/` 目录下当前章节的草稿列表：
- 若存在草稿，UI **强制进入草稿对比模式**（显示 `[← 上一稿] 草稿 1/N [下一稿→]`），用户必须先处理草稿（确认/丢弃其中之一）才能进入正常写作——无论是崩溃恢复还是正常退出后重新打开，行为一致
- 若不存在草稿，UI 进入正常写作状态

```
生成草稿 A → 写入 .drafts/ch038_draft_A.md
生成草稿 B → 写入 .drafts/ch038_draft_B.md
生成草稿 C → 写入 .drafts/ch038_draft_C.md
                               ↓
                    用户左右翻看，选草稿 B
                               ↓
                         确认草稿 B
                               ↓
              **⚠️ confirm_chapter 必须绑定 draft_id**：前端发送确认请求时携带当前展示的草稿文件名
              （如 ch038_draft_B.md），后端校验该文件存在后才执行确认写入。
              防止同章多稿 + 多标签页 + 自动恢复场景下"确认的不是眼前看到的稿"。
                               ↓
              章节写入 chapters/main/ch038.md，frontmatter 写入 confirmed_focus（供历史查阅）：
              ```
              ---
              chapter_id: "ch_xxxxx"
              revision: 1
              confirmed_focus: ["f033"]
              confirmed_at: "2025-03-23T14:22:00"
              generated_with: {mode: "api", model: "deepseek-chat", temperature: 1.0, top_p: 0.95, input_tokens: 12450, output_tokens: 2180, char_count: 1623, duration_ms: 8340, generated_at: "2025-03-23T14:22:00"}
              ---
              （正文）
              ```
              若 ch038.md 已存在（覆盖已确认章节），自动保存旧版本到 chapters/backups/ch038_v{N}.md
              （备份必须放 backups/ 而非 main/，防止全量向量化时读入重复数据）
              **Phase 1：备份只落盘，无 UI 查看入口，用户如需恢复可手动从文件夹取回**
              **Phase 2：在编辑器右上角增加"历史版本"入口，列出备份文件并支持一键恢复**
              向量化存入 ChromaDB
              state.yaml 更新：
                - 仅当确认的章节号 == current_chapter 时，current_chapter +1
                - 若确认的是历史章节（章节号 < current_chapter），保持 current_chapter 不变
                  （⚠️ 正常流程中草稿确认只针对 current_chapter；此条为防御性检查，
                  防止异常路径下误推进 current_chapter。历史章节的修改走 dirty resolve 流程，不走草稿确认）
                - last_scene_ending 仅在推进最新章节时更新
                - last_confirmed_chapter_focus 保存本章 chapter_focus（供下章"延续上章焦点"读取）
                - characters_last_seen **字典合并更新（取 max）**：遍历本章出场角色，仅当新章节号 > 字典中已有记录时才更新——防止回溯修改旧章节时把角色的近期出场记录错误降级（如用户改第22章时出现了陈律师，不应覆盖陈律师在第35章的出场记录）
                - chapter_focus 清空（下一章重新选择）
              .drafts/ch038_draft_*.md 全部清理

Phase 2 启用档案员后额外执行：
              草稿 A、C 的待定 facts 自动作废
              草稿 B 的 facts 正式写入 facts.jsonl
```

**生成失败处理——API 异常状态码分类与精准反馈：**

后端 `LLMProvider` 必须捕获大模型 API 的标准 HTTP 错误，向前端返回结构化的 `error_code`，**严禁向用户抛出原生 JSON 报错或模糊的"生成失败"**。

| 错误类型 | 典型状态码 | 前端 UI 呈现 |
|---------|-----------|-------------|
| 网络超时/返回空 | timeout / 5xx | 自动重试一次；仍失败→"网络异常，请检查连接后重试" |
| 速率限制 | 429 | "请求过于频繁，正在排队重试(1/3)..."；3次失败→"平台拥堵，请稍后或切换模型" |
| 余额/配额耗尽 | 402 / 403(部分厂商) | **弹窗**："API 余额不足或订阅额度已用完。" 操作项：`[去充值]` `[切换模型]` `[修改 API Key]` |
| 上下文超限 | 400(含 length 关键字) | "输入超出模型最大处理能力。" 自动触发强制截断重试；仍失败→建议调低 chapter_length |
| 安全审查拦截 | 400/403(含 safety/flagged) | **红字**："生成被模型安全策略拦截。" 操作项：`[修改指令]` `[切换为限制较松的模型]` |
| API Key 无效 | 401 | "API 密钥无效或已过期，请检查设置" |

所有失败场景下已有草稿不清理，用户可修改参数后重试。流式输出中断时，已接收的部分文本保留在草稿中供用户参考。

**未选草稿清理：**
- 用户确认草稿 B 后，`.drafts/` 中该章其余所有草稿文件自动删除
- 用户主动点"丢弃草稿"时，清空该章全部草稿，回到未生成状态

界面：

```
┌─────────────────────────────────┐
│         （章节正文）              │
│                                 │
│  [← 上一稿]  草稿 2/3  [下一稿→] │
└─────────────────────────────────┘
   [确认这一章]  [再生成一次]  [丢弃草稿]
```

**修改已确认章节：**
- **直接覆写原文件**（`chapters/main/ch038.md`），不进入 `.drafts/` 草稿工作流——草稿流仅限于新章节的生成阶段
- 覆写前自动备份旧版本到 `chapters/backups/ch038_v{N}.md`
- **备份防抖**：同一章节的自动保存触发备份时，若距上一次备份不足 10 分钟，直接覆盖最新备份文件而不新增版本号；仅当跨越时间窗口或用户显式手动保存时才自增版本号——防止沉浸式编辑时高频自动保存产生数百个碎片备份文件
- 保存时自动将该章节号加入 `state.yaml` 的 `chapters_dirty` 列表
- **⚠️ 不在保存时触发 ChromaDB 同步**——写作编辑器可能高频保存（自动保存/Ctrl+S），每次保存都触发向量化会造成 API 额度耗尽和任务队列阻塞
- **ChromaDB 同步推迟到用户点击"完成，解除 Dirty 状态"时执行**：此时一次性删除旧 chunks 并重新向量化，保证逻辑闭环的同时避免冗余开销
- 前端章节列表中，`chapters_dirty` 内的章节显示黄色警告小圆点

**用户点击"标记已处理"时，强制弹出 facts 确认面板（不可跳过）：**

```
┌─────────────────────────────────────────┐
│  第22章已修改，请确认事实表是否仍然准确   │
│                                         │
│  本章直接相关（chapter == 22）：         │
│  ✓ f012 林深手腕有旧疤      [保留][修改] │
│  ✓ f033 那句没说完的话      [保留][修改] │
│                                         │
│  [展开更多：涉及本章出场角色的其他事实]  │
│  （点击展开后显示 characters 关联条目）  │
│                                         │
│  [+ 提取/添加本章新衍生事实]            │
│  （跳转事实表的添加表单，chapter 预填22） │
│                                         │
│  全部确认后：[完成，解除 Dirty 状态]    │
└─────────────────────────────────────────┘
```

- 默认只展示 `chapter == N` 的 facts，减少审阅负担
- 角色相关 facts（`characters` 包含本章出场角色）放到"展开更多候选"，用户按需查看
- 用户必须对默认层每条点击 [保留] 或 [修改/删除] 其中之一，才能解除 dirty 状态
- **⚠️ "删除"的语义**：用户在 UI 中"删除"一条 fact 实际是将其 `status` 设为 `deprecated`（不从 facts.jsonl 中物理移除），符合 append-only 原则。物理删除仅在 undo 级联流程中发生（见 6.3 步骤4）
- **无关联 facts 的 Dirty 章节**：若该章在 facts.jsonl 中没有任何关联条目（如批量导入的早期虚拟章节），点击"解除 Dirty"时跳过 Facts 确认面板（空白面板会让用户困惑），但**仍须执行后续的最新章/历史章分流逻辑**（向量索引重建、最新章的 characters_last_seen 和 last_scene_ending 重算等）——"跳过面板"不等于"跳过 state 刷新"

**Dirty + Undo 交互边界：**

若最新一章处于 dirty 状态，用户点击"撤销最新一章"时：
- **直接允许 undo**，不要求先处理 dirty——撤销本身就是放弃这章，dirty 状态无意义
- 撤销级联执行中，同步从 `chapters_dirty` 移除该章节号（步骤10）
- 备份文件（`backups/ch038_v{N}.md`）依然保留，用户如需查看"修改中的版本"可手动找回

**dirty 状态与生成流程的交互规则：**
- `chapters_dirty` 不为空时，写作界面顶部显示横幅警告
- **不强制阻断生成**：用户可忽略继续写，但警告始终可见直到处理完毕
- **RAG 脑裂提示**：用户点击"续写"时，若 `chapters_dirty` 非空，在 Context 可视化面板对应 chunk 打黄标，同时生成按钮旁轻提示："⚠️ 存在未解除的脏章节，AI 召回的历史片段可能包含修改前的旧版本"——提示而不阻断，让用户知晓但保持流畅的创作体验
- **Token 消耗预警**：由于不同模型（API / 本地 / Ollama）计费方式差异巨大，系统不计算具体金额，统一以 Token 数为客观标尺。后端组装完上下文后，若输入总 token 超过安全水位线，前端 `[续写]` 按钮旁自动显露 ⚠️ 警告图标，hover 显示"本次预估输入约 {N} token"——非阻断，让用户知情决策。**水位线计算**：`min(token_warning_threshold, int(当前生效 context_window * 0.50))`——组装器在 60% 处硬截断，50% 预警线在逼近截断前给用户提示；settings.yaml 的 `token_warning_threshold`（默认 32000）是绝对上限，8K 模型下动态阈值 `8192 * 0.5 = 4096` 会先触发
- **双警告优先级**：若 Dirty 警告和 Token 预警同时触发，采用组合提示："⚠️ 存在未同步修改，预估输入约 {N} token（因脏数据可能有偏差）"——Dirty 属于数据一致性风险，优先级高于单纯的 Token 消耗预警
- 用户完成 facts 确认面板并点击"完成，解除 Dirty 状态"后：
  - 从 `chapters_dirty` 移除该章节号
  - **ChromaDB 同步**：删除该章旧 chunks，重新向量化当前修改版本
  - **characters_last_seen 重算——必须区分最新章与历史章**：
    - **若 N == current_chapter - 1（最新已确认章）**：
      - 从 ops.jsonl 找 `chapter_num == N-1` 的 `confirm_chapter` 记录，读取 `characters_last_seen_snapshot` 作为基线
      - **⚠️ 快照真空兜底**：若 ops.jsonl 中找不到 `N-1` 的快照（如该章节为批量导入产生，从未触发本地 confirm），则退化为：对 `N-3` 到 `N-1` 章执行 `scan_characters_in_chapter` 动态重算基线，再与第 N 章的扫描结果 max 合并；章节不足3章则扫描全部现存章节
      - 重新扫描第 N 章，与基线合并（取 max），覆盖全局 `characters_last_seen`
      - 同时重算 `last_scene_ending`
    - **若 N < current_chapter - 1（历史章）**：
      - **不覆盖全局** `characters_last_seen`——否则第 N+1 到 current_chapter-1 章的所有角色出场记录会被全部抹除
      - 只重建该章的 ChromaDB chunks，facts 确认完成即可
      - **UI 明确提示**："修改历史章节只更新检索库，不自动改写当前全局剧情状态。若希望将修改影响传播到当前进度，请手动执行'重算全局状态'。"
      - 若需刷新全局状态，对最近3章（current_chapter-3 到 current_chapter-1）重跑 scan_characters 并 max 合并（仅在用户明确触发"刷新角色状态"时执行，不自动触发）

### 4.4 故事树（Phase 2）

支持在任意已确认章节处创建新分支：

```
第37章（已确认）
    ├── 主线：第38章草稿A → 第39章 → ...
    └── 分支B：第38章草稿B → （从这里重新往后写）
```

每个分支携带独立的 facts 快照，切换分支时回滚到对应状态。
Phase 1 不实现，但数据结构预留以下字段：

**chapters/ 目录结构**（已在 3.1 文件结构中定义）：
```
chapters/
├── main/               ← Phase 1 所有章节存这里
│   ├── ch001.md
│   └── ch038.md
├── branches/           ← Phase 2 启用，Phase 1 创建空目录占位
│   └── {branch_id}/
│       ├── branch.yaml
│       └── ch038.md
└── snapshots/          ← facts 快照，Phase 2 使用
    └── {branch_id}_ch{N}.jsonl
```

**branch.yaml 字段定义：**
```yaml
branch_id: "branch_001"
name: "另一种和好方式"           # 用户给分支起的名字
forked_from_chapter: 37
forked_from_branch: "main"
created_at: "2025-03-23"
facts_snapshot: "snapshots/branch_001_ch037.jsonl"
```

`current_branch` 字段已在 3.4 project.yaml 中定义，Phase 1 始终为 `"main"`。

### 4.5 Agent 流水线（Phase 2，可关闭，默认关闭）

```
开启时（创作模式推荐）：
场景意图
  → 导演（生成本章细纲，约200字）
    导演的核心职责：
    1. 查阅 unresolved facts 列表
    2. 挑选 1-2 个最适合本章推进的伏笔（考虑剧情阶段和情绪节奏）
    3. 设计能让这些伏笔"实质性推进"的情节点
    4. 写入细纲，自动设置 chapter_focus

    导演必须输出选择理由（建立用户信任的关键）：
    ┌─────────────────────────────────────┐
    │ 本章选择推进：                       │
    │  · f033（权重high，已悬而未决5章）   │
    │  · f012（与当前情绪节奏匹配）        │
    │                                     │
    │ 理由：当前处于情绪积累阶段，          │
    │ 适合推进关系类冲突而非信息揭露。      │
    │                                     │
    │ [采用此方案] [重新选择] [自己选]     │
    └─────────────────────────────────────┘
    用户可 override 选择，不被 Agent 绑架

  → 撰稿人（基于细纲和 chapter_focus 生成正文）
  → 审阅员（输出问题清单：设定冲突/逻辑漏洞/节奏）
  → 编辑（根据问题清单润色终稿）

关闭时（嗑粮模式推荐）：
场景意图
  → 撰稿人（直接生成终稿，chapter_focus 由用户手动选择）

注：关闭后减少约 4/5 的 token 消耗，速度显著提升
```

### 4.6 档案员（Phase 2）

章节确认后自动触发，结果以非打扰式通知呈现。**Phase 1 不实现，Phase 2 启用后章节确认自动触发。**

```python
def run_archivist(chapter_content, project):
    # 1. 提取本章新增事实
    new_facts = extract_facts(chapter_content)
    # 输出结构化 fact 列表，同时生成 content_raw 和 content_clean

    # 2. 检测已有 unresolved facts 是否被解决
    resolved = detect_resolved(chapter_content, project.get_unresolved_facts())

    # 3. 检测疑似倒叙/插叙场景
    timeline_proposals = detect_timeline_shifts(chapter_content)

    # 4. 检测新角色
    new_characters = detect_new_characters(chapter_content, project.get_known_characters())

    # 5. 生成提案推送给用户（非打扰式通知）
    # 用户一键采纳/拒绝
    # 确认的写入 facts.jsonl / timeline.yaml
```

**时间线检测触发提案示例：**
```
档案员：
"第22章第3段疑似回忆场景（检测到：'那年'、'还没有'）
 建议归入：[林深记忆碎片] 时间线
 ✓ 确认  ✗ 忽略  + 新建时间线"
```

**新角色检测触发提案示例：**
```
档案员：
"发现新角色：陈律师
 是否建档？
 [简档（几十字）] [完整档] [忽略]"
```

### 4.7 角色设定生成

设定卡不要求用户手动输入，支持多种生成方式：

**Phase 1 可用：**
```
方式四：导入外部文件
  支持 .md / .txt / .docx
  直接导入，原格式保留，可在编辑器中修改

方式五：手动编写
  直接在编辑器里写
  正文区自由编辑，无格式限制
  但保留最小必填结构（缺失时系统降级，不报错）：
    - frontmatter 的 name 字段（角色名，供角色识别使用）
    - 可选：aliases（别名数组，供 scan 时映射回主名）
    - 可选：importance（低/中/高，供 RAG 决策）
    - 可选：## 核心限制 段落（Phase 1 低保机制使用，见 3.4）
  完全省略 frontmatter 时，文件名作为角色名 fallback
```

**Phase 2 实现：**
```
方式一：Wiki 导入
  输入 Wiki 页面 URL 或角色名
  → 自动抓取并结构化

方式二：从已有章节反向提取
  扫描所有已写章节
  → AI 归纳角色的性格、行为、关系
  → 生成设定卡草稿，用户 review 确认

方式三：用户描述，AI 生成
  输入："林深是那种外冷内热的人，有个秘密..."
  → AI 补全生成完整设定卡
```

所有设定卡生成后均可在编辑器中自由修改，无任何限制。

### 4.8 Import Pipeline（前文导入）

**支持格式：**

Phase 1 实现：

| 格式 | 处理方式 |
|------|---------|
| .txt / .md | 按章节标题切割，向量化入库 |
| .docx | 提取正文，同上 |
| 直接粘贴 | 同 txt |

**章节切分策略**：

```
优先级1：正则识别标准章节标识（第X章、Chapter X 等）→ 按标题切分
优先级2：识别到非标准但连续整数标题 → 按标题切分，整数化为 chapter 元数据
优先级3：无法识别任何章节标识 → 不拒绝导入，自动降级：
         按每 3000 字切分为虚拟章节（chapter 元数据为自动分配的连续整数）
         导入完成后提示："未检测到标准章节标识，已按字数自动切分为 N 个虚拟章节，
         建议后续在设定库补充章节边界"
```

**⚠️ 不拒绝无标准章节名的文本**——直接拒绝违背"首次10分钟成功路径"，很多同人文是纯文本无章节名。

Phase 2 实现：

| 格式 | 处理方式 |
|------|---------|
| .json（Claude 导出） | 半自动审阅流程 |
| .json（ChatGPT 导出） | 半自动审阅流程 |

**对话文件半自动审阅流程：**

```
解析对话文件
    ↓
自动过滤：只保留 AI 长回复（>300字）
人类消息折叠为灰色小标签
    ↓
审阅界面：
  每段 AI 回复显示为卡片
  用户操作：✓ 采用 / ✗ 跳过 / ✂ 部分采用
    ↓
合并采用段落 → 自动识别章节边界
    ↓
完成导入，章节写入 chapters/main/，向量化存入 ChromaDB
```

**注意**：Phase 1 不做全量冷启动分析（那属于 Phase 3），但支持**最近5章的轻量事实提取辅助**。Phase 1 导入完成章节向量化 + state 初始化 + 引导用户提取事实；全量 facts 自动建库、设定卡自动生成等深度分析留给 Phase 3。

**Import 后 state.yaml 自动初始化（Phase 1 必须做）：**

批量导入完成后，后台自动执行以下初始化，确保接续写作时状态机完整：

```
1. current_chapter = 导入的最后一章章节号 + 1（如导入1-50章，则设为51，表示下一章从51开始写）
2. last_scene_ending = 提取最后一章末尾约50字（必须基于剥离 frontmatter 后的纯正文，与 4.1 P2 层注入一致）
3. characters_last_seen = **对全部导入章节执行全量 `scan_characters_in_chapter`**，
   构建完整的 {角色名: 最终出场章节号} 字典
   （纯正则扫描几万字耗时不到 1 秒，远优于仅扫最后 3 章导致早期配角在 RAG 中永久隐身）

   角色名来源优先级（由高到低）：
   ① project.yaml 的 `cast_registry` 中定义的角色名（静态全集）
   ② core_characters/ 目录下的文件名
   ③ oc/ 目录下的文件名
   ④ 导入文本中高频出现的专名（降级 fallback，仅在前三项为空时使用）

   Phase 1 用简单正则匹配已知角色名（来自①②③），无需 LLM
```

若不执行此初始化，用户接续写第51章时 RAG 角色过滤将因 `characters_last_seen` 为空而完全失效。

**所有 characters_last_seen 扫描统一调用 `scan_characters_in_chapter(chapter_text, cast_registry, fallback=False)`**：

- **别名匹配**：扫描时不仅匹配角色主名（`name`），同时匹配设定文件中的 `aliases` 数组。匹配到别名时，在系统底层（`characters_last_seen` 字典、RAG 过滤条件、facts.characters 数组）**强制映射并统一记录为主名**——确保"公子/达达利亚/阿贾克斯"等同人高频别称不会导致角色识别遗漏
- **confirm 章节 / dirty 已处理 / 撤销回滚**：`fallback=False`，只匹配已知角色名及别名（3档）
- **Import 初始化**：`fallback=True`，额外尝试高频专名识别（第4档，出现≥3次的专有名词），结果需用户白名单确认后才注册
- **第四档仅用于 Import 场景**，其他路径绝不触发，保证运行时扫描的确定性

扫描源优先级（`fallback=False` 只走前3档）：
① cast_registry 角色名 + 各角色 `aliases` 别名 → ② core_characters 文件名 → ③ oc 文件名 → ④（仅 Import + fallback=True）高频专名候选

函数返回 `{角色名: 章节号}` 字典，调用方负责 max 合并；第一人称视角时 pov_character 映射到真实角色名后参与匹配。

**Import 初始化其余字段默认值：**

```yaml
last_confirmed_chapter_focus: []   # 导入项目无确认历史，清空
chapter_focus: []                  # 下一章焦点由用户手选
chapters_dirty: []                 # 导入章节不标脏
index_status: "ready"              # 导入流程已完成向量化，标记为就绪
index_built_with:                  # 写入当前生效的 embedding 配置快照，防止下次启动误判触发冗余重建
  mode: {当前 embedding.mode}
  model: {当前 embedding.model}
  api_base: {当前 embedding.api_base}
```

**Import 完成后写入 ops.jsonl**：追加一条 `import_project` 操作记录，payload 包含导入章节范围和初始化的 state 快照，作为后续 reconcile 和 Phase 2D 同步的审计起点。

**Import 冷启动引导（Phase 1）：**

批量导入完成后，前端主动弹出引导提示：

```
✅ 已成功导入 {N} 章内容并完成向量化。

建议提取事实，帮助 AI 更好地理解当前剧情状态：
[✨ 提取最近 5 章（推荐，约1分钟）]
[📚 提取最近 20 章（适合长篇旧文，约5分钟）]
[稍后手动维护]  [跳过]
```

点击后对选定范围逐章调用轻量提取接口，快速建立初始 facts 库。范围越大，初始状态感知越强，但等待时间越长。

**⚠️ 已知限制**：仅提取最近 5 章的 facts，更早章节的伏笔只能依靠 RAG 召回，不会以结构化形式出现在事实表中。对于强伏笔驱动的长篇故事，建议用户在导入后手动补充早期关键 facts，系统不会自动分析全文。

**高频专名确认注册（import fallback）**：若 cast_registry 为空（新用户未建设定库直接导入），Import 初始化时通过 `scan_characters_in_chapter(..., fallback=True)` 提取候选高频专名后，**不自动建档**——直接静默建档会把"咖啡馆"、"这时候"等非角色词污染设定库。

改为弹出白名单确认弹窗：

```
检测到以下高频词，请勾选哪些是需要注册的角色：
☑ 林深    ☑ 陈明    □ 咖啡馆    □ 其实    ☑ 陈律师

[确认注册选中的角色]  [跳过，稍后手动添加]
```

用户勾选确认后，系统才在 `characters/` 目录下生成空设定文件（标记 `unconfirmed_imported: true`）并同步更新 cast_registry。

---

## 5. 存储层设计

### 5.1 章节双重存储

每章同时存两份，职责不同：

```
原文（chapters/main/ch038.md）
  → 给用户阅读和编辑
  → 档案员扫描用
  → 最近章节注入用

向量化版本（ChromaDB collection: chapters）
  → RAG 召回历史细节用
  → 写到相关场景时自动找到历史原文参考
```

### 5.2 向量化粒度

按语义段落切块，**切分点必须落在句号/叹号/问号处**，不能把半句话切断：

```python
import re

def split_chapter_into_chunks(text, max_size=500, overlap_sentences=1):
    # ⚠️ 第零步：剥离 YAML Frontmatter（章节文件顶部的系统元数据）
    # ch038.md 顶部可能存有 confirmed_focus / confirmed_at 等系统字段
    # 必须在切分前剔除，否则 RAG 库里会混入系统代码，AI 会在续写中把代码格式印出来
    # ⚠️ 不要用简单的 `---` 正则匹配（如 re.sub(r'^---[\s\S]*?---\s*\n', '', ...)）
    # 同人作者常在正文中用 `---` 作场景分割线，粗暴正则会把正文楔子误删导致数据永久丢失
    # 必须使用标准 YAML Frontmatter 解析库（如 python-frontmatter 的 `frontmatter.loads()`）
    import frontmatter
    post = frontmatter.loads(text.strip())
    text = post.content

    # 第一步：按段落切（空行或##标题为边界）
    paragraphs = re.split(r'\n\n+|(?=##)', text.strip())

    chunks = []
    current = ""

    for para in paragraphs:
        if len(current) + len(para) <= max_size:
            current += para
        else:
            if current:
                chunks.append(current.strip())
                # overlap：取上一个 chunk 的最后一整句作为新 chunk 开头
                # 比固定字符数的 overlap 语义更完整
                last_sent = re.split(r'(?<=[。！？])', current)
                last_sent = [s for s in last_sent if s.strip()]
                overlap = last_sent[-overlap_sentences] if last_sent else ""
                current = overlap + para
            else:
                current = para

    if current.strip():
        chunks.append(current.strip())

    return chunks
```

**关键原则：**
- 切分点找 `。！？` 而不是字符位置，避免语义失真
- Overlap 用"最后一整句"而不是固定字符数（建议 1 句，约 50-80 字）
- < 100 字的段落合并到相邻段
- > 600 字的段落先按句号切分成若干句，再组合到 max_size 以内

每个 chunk 携带元数据：

```json
{
  "chapter": 38,
  "chunk_index": 3,
  "branch_id": "main",
  "timeline": "现在线",
  "characters": ["林深", "陈明"],
  "content": "林深看着门口..."
}
```

**`branch_id` 字段说明：** Phase 1 统一赋值 `"main"`，成本为零。Phase 2 引入故事树后，RAG 检索时强制带上 `where: {"branch_id": current_branch}` 过滤条件，防止不同分支的章节内容互相污染。现在加这个字段可以避免 Phase 2 的数据库大迁移。

元数据支持过滤查询，如：只召回"同时出现林深和陈明"的段落。

### 5.3 章节确认时的自动触发

```
用户确认这一章
    ↓ 同时触发两件事（用户无感）
1. ch038.md 写入 chapters/main/
2. 按段落切块，向量化存入 ChromaDB（collection: chapters）

⚠️ 以上仅为向量化视角的快速参考。完整的确认流程（含 state.yaml 更新、ops.jsonl 写入、草稿清理、frontmatter 写入等）见 4.3 草稿机制。

Phase 2 启用后额外触发：
3. 档案员扫描，生成 facts 提案（非打扰通知）
```

### 5.4 Facts 注入策略

Facts 注入以 **token 预算**为准（见 4.1 P3 层），而非固定条数：

```
unresolved 条目：不参与常规截断算法；仅在 unresolved 总量自身超出预算时触发独立软降级（见 4.1）
active 条目：按 narrative_weight 降序、同权重内按 chapter 倒序截取，填满预算后停止

经验参考：
  < 50 条时通常可全量注入
  > 50 条时 active 部分开始按倒序截断（旧的被截）
  但实际截断点取决于 token 预算，不是固定的 50 条
```

Facts 在可预见的规模内不做向量化（Phase 3 再议）。

### 5.5 文件路径安全

凡是由用户输入拼装而成的文件名或路径变量（包括 `branch_id`、版本号、AU 名称、Fandom 名称等），在写入文件系统前**必须**通过正则白名单过滤：

```python
import re
def sanitize_filename(name: str) -> str:
    # 只允许字母、数字、中文、下划线、短横线
    if not re.match(r'^[\w\-\u4e00-\u9fff]+$', name):
        raise ValueError(f"Invalid filename: {name}")
    return name
```

未做 sanitize 的路径拼装（如用户输入 `../../etc/passwd` 作为分支名）会导致路径穿越漏洞，文件被写入到错误目录或覆写关键配置。

---

## 6. 前端界面设计

### 6.1 首页（作品库）

```
┌─────────────────────────────────────┐
│  🖊 我的同人创作                     │
│                                     │
│  原神                               │
│  ├── 现代咖啡馆AU    第38章  3天前   │
│  └── 古代权谋AU      第12章  2周前   │
│                                     │
│  咒术回战                           │
│  └── 校园AU          第5章   昨天    │
│                                     │
│  [+ 新建 Fandom]  [+ 新建 AU]       │
└─────────────────────────────────────┘
```

### 6.2 新建 Fandom

```
名称：＿＿＿＿（必填）

人物导入（可选，可跳过）：
  □ 从 Wiki 导入（Phase 2）
  □ 导入文件（.md / .txt / .docx）
  □ 手动创建
  □ 跳过，之后再建

[创建]
```

跳过是重要选项，允许先建项目后补设定。

### 6.3 写作主界面

**嗑粮模式：**

```
┌─────────────────────────────────────┐
│                                     │
│         （章节正文流式显示区）        │
│         打字机效果输出               │
│                                     │
│  [← 上一稿]  草稿 2/3  [下一稿→]    │
│  [确认这一章]         [再生成一次]   │
│                          [丢弃草稿]  │
├─────────────────────────────────────┤
│ 本章推进焦点：                       │
│ [↩ 延续上章] [那句没说完的话] [手腕的疤] [自由发挥] │
│ ────────────────────────────────── │
│ ┌─────────────────────────────────┐ │
│ │ 他又躲进了衣柜，缩在那里...      │ │
│ └─────────────────────────────────┘ │
│  [续写]  [指令]    [🔙 撤销最新一章] │
└─────────────────────────────────────┘
```

**"撤销最新一章"按钮说明：**
- 仅当 `current_chapter > 1` 时显示此按钮（current_chapter == 1 表示无已确认章节，无可撤销目标）；撤销对象为 current_chapter - 1，不可撤销历史章节
- 点击后弹出二次确认："将删除第X章的正文、事实和向量数据，此操作不可逆，确认？⚠️ 注意：本次撤销不会删除您在本章期间手动添加或修改的角色设定和 cast_registry。"若检测到 `.drafts/` 存在 current_chapter 的草稿（即用户正在撰写的下一章），弹窗额外用红字警告："**您当前有尚未确认的新章节草稿，撤销上一章将同时清空这些草稿。**"
- 确认后级联执行：
  0. **⚠️ 前置防御：取消该章节的异步任务**——若后台队列中存在该章节的 `vectorize_chapter` 任务（确认后刚入队尚未完成），必须先调用 `cancel(task_id)` 阻断；否则 undo 删除 chunks 后，延迟执行的向量化会把该章数据重新写回 ChromaDB，产生无法通过常规流程清理的"幽灵向量数据"
  1. `current_chapter - 1`
  2. 删除 `chapters/main/ch0XX.md`，同时清理 `chapters/.drafts/` 下**所有章节号 ≥ N 的草稿文件**（不仅是 `ch0{N}_draft_*.md`，还包括 `ch0{N+1}_draft_*.md` 等）——撤销第 N 章意味着第 N+1 章的草稿基于已被抹除的时间线生成，若不清理，用户重写第 N 章后推进到 N+1 时会看到来自"上一条时间线"的幽灵草稿，造成剧情污染和认知惊悚
  3. **facts 状态回滚**：扫描将要被删除的条目：
     - 若含 `resolves` 字段：将被指向的旧 fact 恢复为 `unresolved`
     - 若本章中用户手动将某旧 fact 标记为 `deprecated`（通过 UI 操作，ops.jsonl 有记录）：将该 fact 恢复为操作前的状态
     - 扫描依据：ops.jsonl 中 `chapter_num == N` 的 `update_fact_status` 操作记录，按时间戳逆序回放
  4. **facts 物理删除**：**禁止使用 `chapter == N` 进行物理删除**（`chapter` 是用户可变字段，用户可能已将 fact 归属到其他章节）。系统扫描 `ops.jsonl` 中 `chapter_num == N` 且 `op_type == "add_fact"` 的所有操作记录，提取 `target_id`，根据这些精准 ID 从 `facts.jsonl` 中定点删除
  5. 删除 ChromaDB 中对应 chunks——**必须通过 BackgroundTaskQueue 排队执行**（封装为 `delete_chapter_chunks` 异步任务推入单线程队列），不能在主线程直接调用 `.delete(where={"chapter": N})`，否则与正在执行的 `vectorize_chapter` 任务产生 SQLite `database is locked` 冲突。步骤0的 cancel 是快路径防御，本条的队列排队是慢路径兜底——即使 cancel 未能阻断，delete 任务也会在 vectorize 完成后串行执行
  6. `last_scene_ending` 回滚：**若 N == 1（撤销第1章），直接设为空字符串**；否则优先从 ops.jsonl 中读取 `chapter_num == N-1` 的 `confirm_chapter` 记录的 `payload.last_scene_ending_snapshot`；若 ops 中无快照，退化为重新读取 ch0{N-1}.md 末尾约50字
  7. `characters_last_seen` 回滚：**若 N == 1，重置为空字典**；否则从 ops.jsonl 中读取 `chapter_num == N-1` 的 `confirm_chapter` 操作记录，取其 `payload.characters_last_seen_snapshot` 字段直接覆盖恢复
     - **⚠️ 快照真空兜底**：若 ops.jsonl 中找不到对应快照（如导入的初始章节从未触发本地 confirm），则退化为：对**全部现存章节**执行 `scan_characters_in_chapter` 并 max 合并重建 `characters_last_seen`——撤销是低频高危操作，必须优先保证数据完整性而非速度，仅扫最近3章会导致仅在早期章节出场的角色记录被永久丢失
  8. `chapter_focus` 清空
  9. `last_confirmed_chapter_focus` **回退**：读取撤销后最新章（ch0{N-1}.md）frontmatter 的 `confirmed_focus` 字段写入；若 N == 1 或该章无 frontmatter，则清空为 `[]`——保留"延续上章焦点"快捷入口，避免用户因撤销损失便利
  10. 若被撤销章节号存在于 `chapters_dirty` 列表，同步移除（防止界面残留幽灵脏警告）
  - **Phase 2 注意**：有档案员时，还需回滚档案员产生的额外状态变更；Phase 1 只需处理上述步骤 0-10

**本章推进焦点说明：**
- 自动读取当前 AU 所有 `status: unresolved` 的 facts 作为选项
- **[↩ 延续上章]**：直接复用上一章的 chapter_focus，减少每章手选的疲劳；若上一章 focus 已 resolved，自动跳过。数据来源优先级：① `state.yaml` 的 `last_confirmed_chapter_focus`（最快，撤销后已回退为前一章 focus）；② 若该字段为空（如 N==1 或前一章无 frontmatter），回退读取上一章正文文件（`ch0{N-1}.md`）frontmatter 的 `confirmed_focus` 字段作为候选
- 界面默认高亮推荐 1 个 `narrative_weight: high` 的 fact（用户可忽略）
- 最多选 2 个；超过 2 个 UI 层禁止勾选
- 选中后写入 `state.yaml` 的 `chapter_focus` 数组，注入 P1 prompt
- 选"自由发挥"则清空为 `[]`，模型不被指定推进任何伏笔
- 章节确认后 chapter_focus 自动清空，下一章重新选择

**Context 可视化面板（折叠）：**

写作界面顶部常驻一个折叠按钮 `[🔍 查看当前 Prompt]`，展开后显示本次实际发送的完整上下文：

```
┌─────────────────────────────────────┐
│  当前 Prompt 构成                    │
│                                     │
│  P0 Pinned    xxx token  [内容▼]    │
│  System Prompt xxx token  [内容▼]   │
│  P1 当前指令  xxx token  [内容▼]    │
│  P2 最近章节  xxx token  [内容▼]    │
│  P3 事实表    xxx token  [内容▼]    │
│  P4 RAG召回   xxx token  [内容▼]    │
│  P5 核心设定  xxx token  [内容▼]    │
│  ─────────────────────────────────  │
│  输入合计  xxx / {context_window} token  │
│  生成预留  xxx token                    │
└─────────────────────────────────────┘
```

用途：生成结果 OOC 或不符合预期时，用户可在此确认"设定是否被截断"、"facts 是否正确注入"，是 debug 和调试的核心工具。

**Token 统计降级标注**：若当前 token 统计触发了 `token_count_fallback`（如分词器离线/加载失败），面板上所有 token 数旁必须显示 `(预估)` 标签，提示"分词器未就绪，此为保守估算值，实际消耗可能更低"——防止 `字符数×1.5` 的放大值引起用户恐慌。

**章节元数据信息栏（可选显示，settings 控制）：**

每章正文底部显示一行折叠式元数据，用户可在全局设置中选择展示哪些字段：

```
第38章  ·  deepseek-chat  ·  T1.0  ·  1623字  ·  输入12.4K/输出2.2K tokens  ·  8.3秒  ·  2025-03-24 14:22
```

- 数据来源：读取该章 frontmatter 的 `generated_with` 字段
- 用户在 settings.yaml 的 `chapter_metadata_display.fields` 中可逐项开关（model/char_count/token_usage/duration/timestamp/temperature/top_p）
- 总开关 `chapter_metadata_display.enabled` 设为 false 可完全隐藏
- 未确认的草稿也显示元数据（读取 `.drafts/` 文件的生成统计，草稿确认后迁移到 frontmatter）
- 手动编辑的章节（非 AI 生成）显示"手动编辑 · 1623字 · 2025-03-24 14:22"，不显示模型和 token 信息

**创作模式：**

```
┌──────┬──────────────────────┬───────┐
│章节列│                      │设定库 │
│      │   （章节编辑器）      │（可   │
│ch001 │                      │折叠） │
│ch002 │  本章推进焦点：       │       │
│...   │  [那句没说完的话 ▼]   │       │
│      ├──────────────────────┤       │
│      │ 输入框  [续写][指令]  │       │
└──────┴──────────────────────┴───────┘
```

### 6.4 参数配置区

写作界面右上角，内联显示（不折叠），类似 Chatbox 消息输入栏上方的模型/参数选择器：

```
[deepseek-chat ▼]  Temperature [1.0 ═══●══]  Top-p [0.95 ═══════●]  [记住 ▼]
                                                                      ├ 记住到全局
                                                                      └ 记住到本AU
```

- **模型选择器**：下拉列表显示所有已配置的模型（来自 settings.yaml），切换仅影响本次会话，不写回 project.yaml（见 2.3.1）
- **Temperature / Top-p 滑条**：切换模型时自动加载该模型的参数（AU 覆盖 > 全局记忆 > 默认值），用户拖动即时生效
- **[记住]**：不点则本次会话后参数丢失；点"记住到全局"写回 `settings.yaml.model_params`，点"记住到本 AU"写回 `project.yaml.model_params_override`
- **预设快捷键**：Temperature 滑条下方可选 [稳定 0.7] [平衡 1.0] [狂野 1.3]
- 若切换模型后 context_window 大幅缩小，显示黄色降级预警（见 2.3.1）

### 6.5 AU 设置页

通过以下入口进入，配置当前 AU 在 **Phase 1 生效**的主要 `project.yaml` 字段：
- 首页：AU 名称右侧的 ⚙️ 图标
- 写作界面：顶部导航栏的"AU 设置"按钮

**注**：`cast_registry`（角色注册表）由设定库界面维护，不在此页直接编辑；`current_branch` 等 Phase 2 预留字段由系统自动管理，不在此页暴露。

```
┌─────────────────────────────────────┐
│  AU 设置：现代咖啡馆AU               │
│                                     │
│  【模型配置】                        │
│  接入方式    ● API  ○ 本地  ○ Ollama │
│                                     │
│  API 模式：                          │
│  模型        [deepseek-chat     ]   │
│  API Base    [________________]     │
│  Context     [自动(128k)      ]     │
│  留空自动推断·本地/新模型请手动填   │
│                                     │
│  本地模式：                          │
│  模型路径    [________________]     │
│                                     │
│  Ollama 模式：                       │
│  服务地址    [localhost:11434  ]     │
│  模型名      [________________]     │
│                                     │
│  每章字数    [1500            ]     │
│                                     │
│  【模型参数（跟着模型走）】            │
│  Temperature / Top-p 不在此页设置    │
│  → 在写作界面（6.4）按模型分别调整   │
│  → 点"记住到本AU"可为本AU覆盖特定模型参数 │
│                                     │
│  【文风配置】                        │
│  叙事视角    ● 第三人称  ○ 第一人称  │
│  （第一人称时显示↓）                 │
│  "我"代表   [林深          ▼]       │
│  情感风格    ● 行为暗示  ○ 直接描写  │
│  自定义说明  [________________]     │
│              （留空则不添加）        │
│                                     │
│  【世界观】                          │
│  □ 忽略 Fandom 核心世界观           │
│    （现代AU等差异极大时勾选）        │
│                                     │
│  【流水线】                          │
│  □ 启用 Agent 流水线               │
│                                     │
│  【核心人物（必带全文设定）】          │
│  ☑ 林深  ☑ 陈明  □ 陈律师  [+]     │
│  （勾选后每次生成必带此角色完整设定）  │
│                                     │
│  【全局叙事铁律 (P0·Pinned)】        │
│  [林深和陈明目前还没有在一起      ]  │
│  [林深绝不会主动道歉...           ]  │
│  [+ 添加一条]                       │
│  （每行一条，绝对不可违背的底线）    │
│                                     │
│  【高级防崩坏配置】                  │
│  主角低保预算  [400        ] token   │
│  （Phase 2 启用，Phase 1 留空即可）  │
│  RAG 衰减系数  [0.05       ]         │
│  （Phase 2 启用，Phase 1 留空即可）  │
│  向量模型锁    ● 继承全局配置          │
│              ○ 手动指定               │
│  手动指定时展开：                      │
│  模式  [api ▼]  api/local/ollama      │
│  模型  [text-embedding-v3      ]      │
│  Base  [________________       ]      │
│  Key   [________________       ]      │
│  （若与全局不同则填写）                 │
│  （修改后自动触发索引重建）             │
│                                     │
│  [保存]                             │
└─────────────────────────────────────┘
```

**Embedding 模型变更时的重建触发逻辑：**

当用户在设置页修改了 `embedding_lock`（或全局 embedding 配置）并点击保存时，后端自动触发全量重建。

**⚠️ 全局 embedding 变更的隐性风险**：若 AU 的 `embedding_lock` 为空（继承全局配置），修改全局 embedding 模型后该 AU 无感知——下次 RAG 查询时新维度向量会导致 ChromaDB Dimension Mismatch 崩溃。

**解决方案——加载时一致性校验（基于 state.yaml 字段）**：每次进入写作界面（加载 AU）时，后端执行：
1. 构造当前生效的 embedding fingerprint（`embedding_lock` 优先，否则读全局配置，取 mode + model + api_base）
2. 与 `state.yaml` 的 `index_built_with` 完整对象比对（三个字段全部一致才认为可复用）
3. 若不一致或 `index_status == stale | interrupted`，**强制弹窗拦截**，提供 [立即重建] 按钮
4. 重建过程中 `index_status = rebuilding`，完成后更新 `index_status = ready` 和 `index_built_with`（写入完整快照）
5. 重建完成前禁止 RAG 相关的生成操作

### 6.6 设定库界面

- 人物卡片列表（可搜索、可筛选 core/oc/functional）
- 点击人物卡片进入编辑器（自由文本，无格式限制）
- 编辑器顶部显示 YAML frontmatter 的结构化字段（name、aliases、importance 等），正文区域自由编辑；aliases 字段以标签形式展示，支持直接添加/删除别名
- 显示"最近被召回于第X章"
- 支持手动调整 importance 等级
- 档案员提案以角标或侧边栏非打扰形式展示（Phase 2 启用后可见）

**角色改名/删除的级联风险（必须明确告知用户）：**

角色名是系统多处逻辑的锚点（`characters_last_seen` 字典键、`facts.jsonl` 的 `characters` 数组、ChromaDB 的 `where` 过滤条件）。

- **Phase 1 限制**：**禁止直接修改已有角色的 `name` 字段**。若用户尝试改名，弹出警告："角色名被历史 facts 和向量库引用，直接修改会导致该角色在历史记录中永久隐身。如需改名，请新建角色后手动迁移。"
- **Phase 1 删除**：删除角色时弹出确认，提示"该角色在 facts 中被引用 X 次，向量库中存在 Y 条相关 chunks，删除后这些引用将失效"
- **Phase 2**：实现真正的角色改名级联更新（更新 facts.jsonl 中所有引用、重建 ChromaDB 中该角色的 where 过滤元数据）

### 6.7 事实表界面

**绝对不能让用户直接编辑 JSONL 文件**——手动写 ID、保持格式正确对非技术用户是不可能完成的任务。所有 facts 操作通过 UI 表单完成，后端自动序列化。

**列表视图：**
- 按 status 分组：unresolved（置顶）/ active / resolved
- 每条 fact 显示：content_clean、涉及角色、narrative_weight 标签
- 支持按角色、时间线筛选
- 显示档案员待确认提案（高亮，Phase 2 启用后可见）

**添加/编辑表单（点击"+ 添加事实"或任意 fact 条目进入）：**

```
┌─────────────────────────────────────┐
│  添加事实                            │
│                                     │
│  描述（管理用）                       │
│  [第31章陈明说了句没说完的话...    ]  │
│                                     │
│  注入内容（第三人称，供 AI 读取）      │
│  [有一句没说完的话，两人没有再提起 ]  │
│  （若留空则与描述相同）               │
│                                     │
│  涉及角色  [林深 ✕] [陈明 ✕] [+]    │
│  类型      [伏笔 ▼]                 │
│  状态      [unresolved ▼]           │
│  叙事权重  ○低  ●中  ○高            │
│  时间线    [现在线 ▼]               │
│  产生章节  [38  ]（自动预填当前章节，可修改）│
│  故事时间  [D+089]（仅供前端 UI 展示；Phase 1 不参与任何排序或业务逻辑，排序严格依赖 chapter 字段）│
│  解决伏笔  [选择已有 unresolved fact ▼]（可选，类型为"事件"时显示）│

**状态联动副作用**：用户提交表单时，若"解决伏笔"字段非空，后端自动将所选旧 fact 的 `status` 更新为 `resolved`，防止被解决的伏笔继续参与 prompt 注入和 chapter_focus 推荐。**反向级联**：若编辑时移除了原有的 `resolves` 关联或更改了关联目标，后端必须检查是否还有**其他** fact 仍然 `resolves` 指向同一目标——若无，则将原目标 fact 的 `status` 恢复为 `unresolved`；若有，保持 `resolved` 不变。防止旧伏笔因关联断开而被永久遗弃，同时避免多重解决场景下的误恢复。
│                                     │
│  [保存]  [取消]                     │
└─────────────────────────────────────┘
```

后端自动生成自增 ID（如 `f_1711230000_a3xq`），追加写入 `facts.jsonl`，用户无需关心文件格式。

**Fact ID 生成规则**：禁用简单自增序列（`f001` 等），必须使用全局唯一格式 `f_{unix时间戳}_{4位随机字母数字}`（如 `f_1711230000_a3xq`），确保 Phase 2D 离线双写同步时不产生主键碰撞，且自带时间排序特性。

**表单保存时的别名归一化**：后端保存 fact 时，必须遍历 `characters` 数组，将用户手动输入的别名映射回主名（与自动提取的归一化逻辑一致，见 6.7 提取结果处理）。同时自动设置 `source = "manual"`（用户通过表单手动创建或编辑的 fact）。

**关于"产生章节"字段的手动修改**：用户可将 fact 的 `chapter` 字段修改为非当前章（如将第38章生成的 fact 归属到第20章）。撤销第38章时，系统**依据 ops.jsonl 中 `add_fact` 记录的 `target_id` 进行精准删除**，而非按 `chapter == 38` 匹配——因此用户手动改过归属的条目仍会被正确识别并删除（ops 记录了原始创建章节），不会因 chapter 字段变更而遗漏或误伤。

**轻量事实提取按钮（Phase 1 MVP）：**

章节确认后，事实表界面顶部出现提示：

```
✨ 第38章已确认，是否自动提取本章新事实？
   [提取建议]  [跳过]
```

点击后向后端发送一次 LLM 请求：

**Phase 1 提取策略（简化版，避免长期 lost-in-the-middle）：**
- 当已有 facts ≤ 30 条：传入已有事实库做比对，提取增量 Delta
- 当已有 facts > 30 条：跳过比对，直接提取"本章发生了哪些客观改变"
- **UI 模式提示**：提取按钮旁显示当前模式（"对比模式·增量提取" / "独立模式·需人工去重"），让用户知晓当前结果是否已做去重

**≤30 条时使用的完整 prompt：**

```
对比以下【已有事实库】，从【本章正文】中提取出"全新"的客观事实或已有伏笔的"状态改变"。
已有事实不要重复提取，输出必须是增量 Delta（仅新增或变化的内容）。

【代词还原规则（极其重要）】：
必须将正文中的所有代词（如"我"、"你"、"他"、"她"）还原为具体的角色全名。
提取结果中绝不能出现代词，必须使用完全的第三人称上帝视角陈述。
{若当前为第一人称写作，前端补充传入："我"代表的角色名是：{pov_character}}

【已有事实库】
{当前所有 status=active 或 unresolved 的 content_clean，每条一行}

【本章正文】
{chapter_content}

输出格式：JSON 数组，每条包含 content_clean、characters、type、status、narrative_weight、chapter（当前章节号的整数，用于排序）
```

**>30 条时使用的精简 prompt：**

```
从以下【本章正文】中提取本章新增的客观事实或关系变化。
使用第三人称上帝视角，将所有代词还原为角色全名。

【本章正文】
{chapter_content}

输出格式：JSON 数组，每条包含 content_clean、characters、type、status、narrative_weight、chapter
若本章无任何实质性的客观事实或关系变化，请严格返回空数组 []，不要强行编造。
```

**Phase 1 提取为 Append-Only（只追加，不覆盖）：**
- Phase 1 提取结果只用于填充新建表单（追加新条目）
- 若模型提取到了某个已有伏笔的状态改变，也作为一条新 fact 追加，旧的 fact 由用户在列表中手动标记为 `deprecated` 或 `resolved`
- **绝不在 Phase 1 引入 ID 匹配与自动覆盖逻辑**——那是 Phase 2 档案员的任务，Phase 1 前端越薄越好

**提取结果 JSON 防御解析：**
- `response_format: {"type": "json_object"}` 仅在明确支持的模型时传入
- 后端解析时必须使用 `json_repair` 库，防止残缺 JSON 引发 500 错误
- **后端强制注入 chapter 字段**：解析 LLM 返回的 JSON 数组后，无论 LLM 是否输出了 `chapter`，后端必须遍历每条结果显式设置 `chapter = current_processing_chapter_num`，再写入 facts.jsonl——防止缺少 chapter 字段导致排序/截断/撤销逻辑全部崩溃
- **后端别名归一化**：遍历每条结果的 `characters` 数组，将别名映射回主名（如 LLM 输出"公子"→ 归一化为"达达利亚"），确保 facts 中的角色引用始终使用主名，与 `cast_registry` / `characters_last_seen` 保持一致
- **后端自动设置 source 字段**：提取结果统一标记 `source = "extract_auto"`（章节确认后提取）或 `source = "import_auto"`（Import 批量提取），LLM 不负责输出此字段
- **注**：Phase 1 的自动化提取故意忽略了 `story_time` 的推断以降低 LLM 解析难度，该字段在表单预填时默认为空，用户若有需要可自行在表单中补充。Phase 1 排序严格依赖 `chapter` 字段，不依赖 `story_time`

提取结果以表单预填充形式呈现，用户扫一眼确认或修改后保存。不强制，用户可跳过手动维护。

**事实提取 token 防溢出：**
- 主流模型（64k+上下文）处理单章3000字 + 事实库几乎不会溢出，无需截断
- 若确实超出模型上限，将正文按段落等分为两块（保留2句话 overlap），分别调用 API 提取
- **两次提取的 JSON 数组直接合并，在前端表单中全量展示**，由用户在点击保存前肉眼判断并剔除重复/相近项；不依赖代码自动去重——LLM 对同一事件可能生成措辞不同的两条 fact，代码无法可靠判断语义等价

**facts.jsonl 并发写入控制：**
- 所有写入操作（表单保存、自动提取确认）必须串行执行，使用文件锁
- **FastAPI 异步环境注意**：标准 `filelock` 是同步阻塞的，直接在 `async def` 路由中调用会阻塞整个事件循环导致服务卡死；必须二选一：
  - 方案 A（推荐）：将 `filelock` 操作包在 `await run_in_threadpool(write_fact, ...)` 中（`starlette.concurrency.run_in_threadpool`），在线程池执行同步阻塞 I/O
  - 方案 B：使用 `asyncio.Lock()` 替代文件锁（仅保证单进程内串行，多进程场景需配合方案 A）
- 严禁在主事件循环中直接执行阻塞性 I/O 锁
- 防止用户手动保存与自动提取同时触发导致文件损坏

### 6.8 导出功能

写作界面或章节管理页提供导出入口：

```
导出范围：
  □ 全部章节
  □ 选定章节范围（第X章 - 第Y章）

导出格式：
  □ .txt（纯文本，章节间空行分隔）
  □ .md（保留 Markdown 格式）
  □ .docx（Word 文档）

导出选项：
  □ 包含章节标题
  □ 包含章节编号
```

导出为单一文件，章节按顺序合并。

**⚠️ 导出时必须剥离章节 YAML frontmatter**：章节文件包含系统元数据（chapter_id、revision、confirmed_focus、confirmed_at、generated_with），导出给用户阅读时必须自动移除，只保留纯正文内容。使用与 5.2 向量化相同的 `frontmatter.loads()` 剥离逻辑。

---

## 7. 开发分期

### Phase 1（MVP）
核心写作体验可用

- [ ] 首页 + Fandom/AU 管理
- [ ] 人物设定 + 世界观录入（支持手动/文件导入，含 `aliases` 别名字段，scan 时别名映射回主名）
- [ ] **架构分层**：业务逻辑封装为 Service 层（ConfirmChapterService 等），FastAPI 只做路由转发，不含业务规则（见 2.6）
- [ ] **Repository 接口**：文件读写和 ChromaDB 操作通过接口访问，Phase 1 实现 LocalFile* 适配器（见 2.6.2）
- [ ] **稳定 ID + 时间戳**：project_id / au_id / chapter_id / updated_at 字段（见 2.6.4）
- [ ] **Operation Log**：ops.jsonl 本地 append-only，记录所有核心动作（见 2.6.5）
- [ ] **后台任务抽象**：向量化/导入/重建索引等异步任务通过 BackgroundTaskQueue 执行，ChromaDB 写操作单线程串行（见 2.6.8）
- [ ] 上下文组装器（P0 在 System Role，P1-P5 在 User Role，layers 收集顺序 P1→P3→P2→P4→P5，token 裁剪顺序 deterministic，budget fail-safe）
- [ ] context_window 自动推断（模型名映射表，见 2.5）
- [ ] max_tokens 显式传参（预留 40% 生成空间，budget 取 60%，防断章）
- [ ] Pinned Context（P0 层，project.yaml 字段 + Show don't tell 保护壳注入，硬约束不参与推进链）
- [ ] 核心设定低保预算（`core_guarantee_budget`，core_always_include 的 `## 核心限制` 段落不可被 P1-P4 挤占，见 3.4）
- [ ] 交互模式写作 + 流式输出
- [ ] 生成任务幂等：同章重复请求返回 409、多标签页防并发（见 4.2）
- [ ] **AU 级互斥锁**：confirm/undo/resolve_dirty 在 Service 层获取 AU 粒度 asyncio.Lock（见 2.6.5）
- [ ] 生成失败处理（API 错误码分类：超时重试/429排队/402余额提示/安全拦截提示，见 4.3）
- [ ] **LLM 运行时切换**：6.4 模型快速切换器（会话态，不写回 project.yaml）、上下文降级预警、文风切换 toast（见 2.3.1）
- [ ] **生成来源与统计快照**：chapter frontmatter 和 ops confirm payload 的 `generated_with` 字段（含 model/tokens/字数/耗时，见 2.6.4）
- [ ] **章节元数据信息栏**：正文底部可选显示模型/字数/token/耗时/时间戳，用户在 settings 逐项开关（见 6.3）
- [ ] 草稿机制（同章多稿，左右翻看，.drafts/ 持久化，未选草稿自动清理，UI 初始化恢复逻辑）
- [ ] 撤销最新一章（仅针对 current_chapter-1，按 6.3 所定义的完整级联回滚流程执行：异步任务取消+正文+≥N草稿清理+facts状态回滚+facts精准删除+ChromaDB排队删除+state各字段）
- [ ] 轻量版本回滚（覆盖已确认章节时自动保存旧版到 chapters/backups/）
- [ ] facts.jsonl 表单录入（自动生成 ID，支持 narrative_weight 字段，文件锁串行写入）
- [ ] 轻量事实提取按钮（传入已有 facts 去重，增量 Delta 输出，用户确认保存）
- [ ] ChromaDB 向量化 + 设定 RAG 召回（top_k=3/collection，活跃角色合集过滤）
- [ ] `embedding_lock` 字段（对象快照，变更时自动触发 ChromaDB 全量重建）
- [ ] chunk 元数据含 branch_id（Phase 1 统一赋值 "main"）
- [ ] state.yaml + timeline.yaml 基础支持（含 chapters_dirty + chapter_focus 数组）
- [ ] chapter_focus 为空且存在 unresolved facts 时注入铺陈指令（0 个 unresolved 时不注入）
- [ ] dirty 状态横幅警告（不阻断生成）
- [ ] txt / md / docx 前文导入
- [ ] 嗑粮/创作模式切换
- [ ] chapter_focus 选择器（最多2个，默认推荐 narrative_weight:high 的条目，支持"延续上章焦点"选项）
- [ ] Import 完成后冷启动引导弹窗（触发最近5章事实提取 + state.yaml 自动初始化）
- [ ] Context 可视化面板（折叠，显示各层 token 占用）
- [ ] 模型参数配置：6.4 内联 Chatbox 风格（模型选择器 + Temperature/Top-p 滑条 + 记住按钮）、按模型名索引的参数表（settings.yaml.model_params）、AU 级可选覆盖（见 2.3.1）
- [ ] 文风配置：视角/情感风格/自定义说明（6.5 AU 设置页）
- [ ] 章节生成目标字数配置（6.5 AU 设置页）
- [ ] 世界观继承规则（含 ignore_core_worldbuilding 选项）
- [ ] 全局 settings.yaml（Embedding 配置 + 默认 LLM + Tokenizer fallback + schema_version）
- [ ] 前端 UI 字符串外置到 `locales/zh.json`（使用 react-i18next），Phase 1 只实现中文，但保留多语言扩展能力
- [ ] 导出功能（txt / md / docx，见 6.8）
- [ ] 故事树数据结构预留（branches/ 目录 + branch.yaml 字段）
- [ ] **桌面打包分发**：Tauri 2 + Python sidecar（PyInstaller）、Sidecar stdout 握手、Windows VCRT 静默安装（见 2.6.7）
- [ ] **数据迁移与升级**：schema_version 检测 + 迁移脚本框架、迁移失败回滚（见 2.6.7）
- [ ] **项目数据校验与修复**：AU 打开时执行 `validate_and_repair_project()`，覆盖 project/state/facts/frontmatter（见 2.6.7）
- [ ] **外部修改检测**：启动时 mtime 对账 + 文件缺失检测 + 外部新增检测，自动推入 chapters_dirty 或禁用生成（见 2.6.7）
- [ ] **Token fallback 预估标签**：分词器降级时 Context 面板标注"(预估)"（见 6.3）
- [ ] **崩溃恢复**：草稿恢复、向量化中断续建、ops.jsonl 未完成操作检测（见 2.6.7）
- [ ] **模板导入导出**：Fandom/AU 模板包本地导入导出（zip），导出脱敏 + 导入字段重建（见 1.7）

### Phase 2A（facts 自动化）
*前提：Phase 1 完成，facts 手动维护已跑通*

- [ ] 档案员自动提取 facts（完整版，含 resolved 检测 + 时间线检测）
- [ ] facts 内部冲突检测（写入新 fact 时 embedding 查重；LLM 判断替代关系，标记旧 fact 为 `deprecated`）
- [ ] Pinned 过期自动提醒（pinned 与最新 facts 冲突时提示）
- [ ] facts 长期维护提醒（某 fact 超 N 章未被引用时提示）
- [ ] 事实压缩/GC（active facts 超阈值时触发合并）
- [ ] story_time 精确时间过滤（引入时间解析引擎）
- [ ] narrative_weight 拆分为 importance + urgency；**必须提供向前兼容迁移**：旧数据的 `narrative_weight: "high"` 自动映射为 `importance: "high", urgency: "medium"`，不能让版本更新导致旧项目校验报错

### Phase 2B（Agent 流水线）
*前提：Phase 2A 完成，facts 质量可信*

- [ ] 批量模式
- [ ] Agent 流水线（导演/撰稿/审阅/编辑，含导演选择理由说明层 + 用户 override）
- [ ] 时间线自动检测（倒叙/插叙识别）
- [ ] 角色设定 AI 生成（从章节反向提取 + 描述生成）
- [ ] 冲突检测 warning（生成后自动扫描是否违反 facts）
- [ ] Context Trace 溯源日志（记录每次生成时哪些 facts/RAG chunks 被实际使用）

### Phase 2C（高级功能）
*前提：Phase 2A/2B 完成*

- [ ] 故事树（分支叙事）
- [ ] 章节删除级联（"删除至此"，`current_chapter = target_chapter + 1`，批量删除目标章节之后所有章节的正文 + 对应 facts（含 resolved 联动回滚）+ ChromaDB chunks；并像 Import 流程一样重新拉取 `target_chapter` 末尾50字更新 `last_scene_ending`，重新扫描 target_chapter 之前3章覆盖重置 `characters_last_seen`）
- [ ] 历史版本查看 UI（编辑器右上角"历史版本"入口，列出 backups/ 并支持一键恢复）
- [ ] Wiki 批量导入
- [ ] 对话文件半自动审阅导入
- [ ] Multi-Query RAG 召回优化
- [ ] RAG 角色加权召回（core 角色权重更高）
- [ ] 章节 RAG + 时间衰减重排序（rag_decay_coefficient 可配置）
- [ ] content_clean 别名归一化（Phase 2）：在提取 Prompt 中要求 LLM 在最终陈述句中使用角色主名而非别名，减少 P3 注入时的理解偏差
- [ ] ~~低保机制~~（已前移至 Phase 1，见 3.4 `core_guarantee_budget`）

### Phase 2D（多端访问与同步）
*提前至 Phase 2 而非 Phase 3，原因：用户真实场景是"桌面建库、手机续粮"，同步断裂会让产品体验残缺*

**第一步：局域网 Remote Session（快速交付）**
- [ ] FastAPI 支持 `0.0.0.0` 绑定模式（局域网访问开关）
- [ ] 桌面应用生成局域网访问地址 + 二维码，手机扫码直连
- [ ] 移动端 Web UI 适配（响应式布局，隐藏 facts/dirty 等维护性面板，暴露续写核心流程）
- [ ] Remote Session 访问认证（6位数字 PIN，每次开启随机生成，与当前会话绑定，桌面关闭即失效；见 2.6.7 细则）

**第二步：平台中继（外网可用）**
- [ ] 桌面应用主动连接平台中继服务，生成临时访问链接
- [ ] 手机通过配对码/链接访问，无需用户处理域名/证书/端口转发
- [ ] 中继服务只转发流量，不存储数据

**第三步：真正多端同步（Sync Mode）**
*注：2.6.3 定义了完整权威数据范围（含 backups/、公开 settings、可选 .drafts/），以下为 Phase 2D 首版实现的核心子集，其余项随后续版本逐步纳入*
- [ ] 权威数据同步（project.yaml、state.yaml、facts.jsonl、ops.jsonl、chapters/main/、设定文件）
- [ ] 各端独立重建派生数据（ChromaDB 等）
- [ ] ops.jsonl 操作回放与冲突解决（见 2.6.5）
- [ ] 移动端独立运行能力（需配合 managed API 或自填 API Key）

### Phase 3（纯移动端独立使用 + 进阶功能）
*前提：Phase 2D 多端同步完成*

- [ ] 纯移动端独立项目创建与导入（managed mode 或自填 API Key）
- [ ] 移动端 30秒首次体验流程（见 1.15）
- [ ] 冷启动分析（导入前文后自动建库）
- [ ] Token 用量可视化
- [ ] Facts 向量化（量大时）
- [ ] RAG Rerank

---

## 8. 待决策 / 遗留问题

- [ ] 章节向量化 overlap：采用"最后一整句"策略（见 5.2），overlap_sentences 默认 1，可视效果调整为 2
- [ ] 对话文件：Claude/ChatGPT 导出格式的具体解析规则需调研实际文件结构
- [ ] 故事树：Phase 2 实现时需专项设计，当前仅预留数据结构
- [ ] context_window 自动推断映射表需持续维护（见 2.5）；新模型上线后及时补充
- [ ] 时间衰减系数默认值 0.05 需实测调整（Phase 2 实现时）；回忆类关键词触发列表需进一步完善
- [ ] 多人协作：暂不考虑，本地单用户场景
- [ ] RAG 相邻 chunk 合并策略（Phase 2）：召回的 chunks 若在同一章节且 `chunk_index` 连续/相邻，注入前拼接还原为一个长文本块，避免中间过渡丢失导致 LLM 理解偏差
- [ ] Facts 合并/替代后的历史展示映射（Phase 2）：当旧 fact 被 merge 或 replace 时，章节 frontmatter 中保留的原始 fact id 在 UI 历史展示层可选映射到新 fact，标注"已映射"；若已物理删除且无替代，标注"历史引用已失效"
- [ ] Prompt Caching 优化（Phase 2）：利用 API 层缓存机制（Anthropic cache_control、DeepSeek context caching 等）降低重复 System Prompt / 设定注入的实际成本和延迟，不影响上下文组装逻辑
- [ ] ops.jsonl 日志截断与硬快照（Phase 2）：当章节数超过阈值（如 50 章）时，在 state.yaml 或独立快照文件中写入一次完整状态基线，后续 undo/恢复只需从最近快照回溯而非扫描全量日志，避免百章级别长篇的 I/O 性能衰退
