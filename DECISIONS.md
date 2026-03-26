# 关键决策记录（DECISIONS）

> 只记录会影响架构、状态机、同步边界、平台能力承诺的高价值决策。
> 新决策必须追加，不得静默覆盖旧决策。若新决策替代旧决策，必须明确写“Supersedes”。

---

## 决策模板

### D-XXXX 标题
- Date:
- Status: Proposed / Accepted / Superseded / Deprecated
- Owner:
- Context:
- Decision:
- Consequences:
- Supersedes:

---

## D-0001 `current_chapter` 语义
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: 章节确认、撤销、导入初始化、继续写作都依赖该字段。
- Decision: `current_chapter` 定义为“当前待写章节号（下一章编号）”，不是“最后已确认章节号”。
- Consequences:
  - 导入 1-50 章后，`current_chapter = 51`
  - 撤销最新一章时，撤销对象为 `current_chapter - 1`
  - UI 与文档不得再把该字段描述为“最新已完成章节号”
- Supersedes: none

---

## D-0002 Undo 为级联回滚，不是简单删章
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: 撤销最新一章会影响状态、facts、索引与派生值。
- Decision: undo latest chapter 必须执行完整级联回滚，不得只删除章节文件。
- Consequences:
  - 需要明确回滚 `current_chapter`
  - 需要处理 facts、索引、状态派生值
  - 涉及该流程的改动视为核心区改动
- Supersedes: none

---

## D-0003 Facts 常规 append-only，章节回滚例外
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: facts 生命周期以 status 驱动，但章节回滚需要撤销对应事实。
- Decision: `facts.jsonl` 在常规维护流程中采用 append-only；仅在显式章节回滚/删除时允许物理删除对应章节条目。
- Consequences:
  - 不能在一般编辑流程中随意重写旧 fact 记录
  - undo 逻辑必须视为例外流程
- Supersedes: none

---

## D-0004 权威数据与可重建数据分离
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: 未来需要跨端同步，不能把所有本地产物都视为同步真相。
- Decision: 以下为权威数据，未来可同步：
  - `project.yaml`
  - `state.yaml`
  - `facts.jsonl`
  - `chapters/main/*.md`
  - 角色设定 / 世界观文档
  - frontmatter 中的稳定元信息
- Consequences:
  - ChromaDB、tokenizer cache、临时索引、检索中间结果视为可重建数据
  - 可重建数据不得作为同步冲突裁决依据
- Supersedes: none

---

## D-0005 平台能力矩阵
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: 桌面优先，安卓必须实现，iOS 需要预留但非当前强承诺。
- Decision:
  - 桌面端是 Phase 1 / 近期主平台
  - 安卓未来支持，但不承诺与桌面完全同构底层
  - iOS 只做架构预留，不承诺早期完整能力等价
- Consequences:
  - 文档与实现不得默认 mobile 具备桌面全部本地能力
  - 本地模型路径 / 本机 Ollama / 重索引等能力必须区分平台
- Supersedes: none

---

## D-0006 LLM 热切换 / Embedding 冷切换
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: 用户频繁切换 LLM 是高频场景，但 Embedding 切换需要重建索引。
- Decision:
  - LLM 是运行时可切换资源，不是作品状态的一部分
  - Embedding 是 AU 级锁定资源，切换需重建索引
  - LLM 切换不触发索引失效
- Consequences:
  - chapters/facts/state 等故事状态绝不因 LLM 切换而重置
  - 只有 embedding_lock fingerprint 变化才触发 index_status=stale
- Supersedes: none

---

## D-0007 session_llm 不写回项目长期配置
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: 用户临时试模型不应污染 AU 配置和同步状态。
- Decision:
  - "本次生成模型"（session_llm）存前端 sessionStorage，不持久化
  - 只有用户在 AU 设置页显式修改模型时才写回 project.yaml
  - 后端纯无状态：每次生成请求前端通过请求体传入 session_llm
- Consequences:
  - 刷新/重启/sidecar 崩溃后 session_llm 回退到 AU 默认
  - 前端在 sidecar 重连时重新下发 sessionStorage 中的 session_llm
  - session_llm 是浏览器标签页会话态，不是 AU 共享态
- Supersedes: none

---

## D-0008 模型参数跟模型走，不跟 AU 走
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: 不同模型的 temperature/top_p 合理范围不同（如 Claude 0-1 vs DeepSeek 0-2）。
- Decision:
  - settings.yaml.model_params 按模型名索引存储参数
  - project.yaml.model_params_override 为 AU 级可选覆盖
  - 加载链：AU 覆盖 > 全局记忆 > 硬编码默认
  - "记住"操作才持久化，不拖则不写
- Consequences:
  - 6.5 AU 设置页不再有 Temperature/Top-p 输入框
  - 6.4 写作界面内联 Chatbox 风格参数选择器
- Supersedes: none

---

## D-0009 AU 级互斥锁保护复合状态操作
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: 单文件 filelock 无法防止多文件事务的状态撕裂。
- Decision:
  - confirm_chapter、undo_chapter、resolve_dirty_chapter 在 Service 层入口获取 AU 粒度 asyncio.Lock
  - 低风险操作（edit_fact、update_fact_status、set_chapter_focus）允许并发或统一纳入
- Consequences:
  - 同一 AU 同一时间只有一个状态机变更操作
  - 生成任务的 409 幂等是 UI 层防呆，互斥锁是 Service 层最终防线
- Supersedes: none

---

## D-0010 ops.jsonl 是业务关键依赖
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: ops.jsonl 不只是调试日志，undo/dirty/同步都依赖它。
- Decision:
  - ops.jsonl 是 undo 快照恢复、dirty 基线、fact 状态回放的业务关键依赖
  - 截断后必须标 sync_unsafe + UI 警告
  - edit_fact 不绑定 chapter_num（不参与 undo 级联）
- Consequences:
  - ops 格式损坏会导致 undo/dirty/同步全部降级
  - 并发写入必须使用 filelock
- Supersedes: none

---

## D-0011 content_hash 替代 mtime 检测外部修改
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: mtime 在 Git checkout/云盘同步/zip 解压场景下大面积误报。
- Decision:
  - 确认章节时计算正文 SHA-256 hash 存入 frontmatter
  - 启动时重算 hash 与存储值比较，不一致则推入 chapters_dirty
  - mtime 仅作弱提示辅助
- Consequences:
  - confirm/import/dirty resolve 三个写入路径都必须计算并写入 content_hash
- Supersedes: none

---

## D-0012 PyInstaller 严禁 --onefile，必须 --onedir
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: --onefile 每次启动解压到临时目录，含 ChromaDB/ONNX 时冷启动 20-40 秒。
- Decision: 必须使用 --onedir，由 Tauri 安装包将目录解压到 Program Files。
- Consequences:
  - 冷启动 1-3 秒
  - tiktoken BPE 词表必须预打包到 --onedir 目录
- Supersedes: none

---

## D-0013 ChromaDB 必须开启 WAL 模式
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: 默认 journal 模式下耗时写事务会阻塞并发读操作。
- Decision: 初始化 ChromaDB 客户端时显式开启 SQLite WAL 模式。
- Consequences:
  - 后台重建索引时用户仍可正常执行 RAG 检索
- Supersedes: none

---

## D-0014 章节文件 4 位补零 + Repository 层封装
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: 超 999 章时 3 位补零导致字典序错乱。
- Decision:
  - 所有章节/草稿文件名强制 ch%04d（如 ch0038.md、ch0038_draft_A.md）
  - 整型↔文件名转换绝对封装在 LocalFileChapterRepository 内部
  - 上层业务逻辑只传整型 chapter_num，严禁拼装文件名
  - 启动归一化：非标准命名自动重命名
- Consequences:
  - 任何 Service/Domain 代码中出现文件名拼装视为违规
- Supersedes: none

---

## D-0015 核心设定低保预算 Phase 1 即启用
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: "不崩人物"是核心价值，但 P5 核心设定是最低优先级最先被裁剪。
- Decision: Phase 1 即为 core_always_include 的 `## 核心限制` 段落预留 400 token 不可挤占预算。
- Consequences:
  - 本地小 context 模型下主角人设不会被完全挤出
- Supersedes: none

---

## D-0016 撤销时清理 ≥N 的所有草稿
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: 撤销第 N 章时，第 N+1 章草稿基于已抹除的时间线生成。
- Decision: undo 步骤 2 清理 .drafts/ 下所有章节号 ≥ N 的草稿文件。
- Consequences:
  - 防止用户看到来自"被抹除时间线"的幽灵草稿
  - undo 弹窗若检测到 current_chapter 草稿存在需红字警告
- Supersedes: none

---

## D-0017 后台任务队列去重规则
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: 重复入队导致冗余向量化和陈旧任务堆积。
- Decision:
  - 同 AU/同章/同 task_type 等待中的任务去重（后入丢弃）
  - rebuild_index 入队时淘汰同 AU 所有细粒度任务
- Consequences:
  - 已开始执行的任务不中断
- Supersedes: none

---

## D-0018 流式传输使用 SSE
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: 生成是单向推送，不需要 WebSocket 的双向通信。
- Decision: FastAPI 端点返回 StreamingResponse（SSE），前端用 EventSource 或 fetch+ReadableStream 消费。
- Consequences:
  - 前后端协议统一，三家 AI 不会各自实现不同协议
- Supersedes: none

---

## D-0019 错误响应统一 JSON 格式
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: 三家 AI 开发者需要统一的前后端错误通信协议。
- Decision: 后端错误响应格式固定为 `{error_code, message, actions}`。
- Consequences:
  - 前端根据 error_code 匹配 UI 行为，actions 决定弹窗按钮
  - 6 种错误类型精准映射（超时/429/402/context超限/安全拦截/Key无效）
- Supersedes: none

---

## D-0020 .drafts/ Phase 2D 默认不同步
- Date: YYYY-MM-DD
- Status: Accepted
- Owner: Claude Code / Human Maintainer
- Context: 草稿同步涉及冲突解决、稳定 ID、是否可续写等复杂决策。
- Decision: Phase 2D 草稿仅限本机，远端看不到未确认草稿。Phase 3 视需求再开放。
- Consequences:
  - Remote Session 下手机只能看已确认章节
- Supersedes: none

---

## D-0021 Repository 层使用同步方法
- Date: 2026-03-26
- Status: Accepted
- Owner: Claude Code
- Context: filelock 是同步阻塞的，async Repository 方法无法被 run_in_threadpool 正确包装。
- Decision: 所有 Repository 方法为同步（def，非 async def）。FastAPI async 路由调用时须通过 run_in_threadpool() 包装。
- Consequences:
  - Service 层调用 Repository 时直接调用同步方法
  - API 路由层负责 run_in_threadpool 包装
  - 后续所有新 Repository 实现必须遵循此模式
- Supersedes: none
