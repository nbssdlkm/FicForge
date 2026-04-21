# FicForge · 粮坊 — Claude Code 项目指南

## 项目概况

FicForge 是面向同人写手的 AI 辅助续写工具。当前正在进行 **架构迁移**：从 Python 后端 + Tauri 桌面端迁移到 TypeScript 统一核心引擎，以同时支持桌面端（Tauri）和移动端（Capacitor/PWA）。

## 架构（PRD v4, D-0034）

```
TypeScript 核心引擎 (src-engine/)
  ├── domain/          数据类型、枚举、工具定义（来自 core/domain/*.py）
  ├── prompts/         55 个中英文模板（来自 core/prompts/*.py）
  ├── services/        全部业务逻辑（来自 core/services/*.py）
  ├── repositories/    抽象接口（9 个 TypeScript interface）
  ├── llm/             LLM 调用（openai-node SDK）
  ├── tokenizer/       Token 计数（js-tiktoken）
  ├── vector/          内存向量检索（JSON 分片 + cosine similarity）
  └── sync/            多设备同步引擎（ops 合并 + state/facts 重建）

Platform Adapter
  ├── TauriAdapter     桌面端文件 I/O
  ├── CapacitorAdapter 移动端文件 I/O
  └── WebAdapter       PWA（OPFS/WebDAV）

壳层
  ├── Tauri 壳 + 可选 Python sidecar（仅本地 embedding）
  └── Capacitor 壳 (Android) / PWA (iOS/Web)
```

## 迁移阶段（当前进度）

| Phase | 内容 | 状态 |
|-------|------|------|
| M0 | Domain 模型、Prompt 模板、Token 计数、PlatformAdapter 接口 | **已完成** |
| M1 | Repository 接口+实现、向量存储（JSON 分片）、ChromaDB 迁移脚本 | **已完成** |
| M2 | Facts Lifecycle、Context Assembler、RAG、LLM Provider、Generation | **已完成** |
| M3 | Confirm/Undo Chapter、Dirty Resolve、Import/Export | **已完成** |
| M4 | Settings Chat、Trash、Recalc、前端 API 切换、SSE 消除、Sidecar 精简 | **已完成**（E.6 Sidecar 精简待人工执行） |
| M5 | 移动端 Capacitor/PWA、响应式 UI、ops 合并引擎、数据同步 | **已完成** |
| M6 | Agent 架构（开关矩阵、Checker、导演细纲、任务模式、报警暂停） | 待开始 |

## 活跃工作（当前分支）

**`main`** —— 全部已 push origin/main。

### 2026-04-20/21 完成的工作

**Writer 状态下沉重构（5 phase + 6 cleanup）**：
- WriterLayout useState 22 → 1，行数 619 → 293，setter 外泄 ~61 → 0
- 删除 `useWriterResetOnAuChange.ts`；引入 `loadDataRef` shim 破死循环；5 个 bridge ref → 0（反转控制流）
- UI 测试 0 → 13 文件 / 93 用例（`@testing-library/react` + jsdom 首次接入）
- Codex 简报 + 4 铁律 + 第 5 条规则（hook 不暴露 raw setter）已写入本文件

**Phase 7 tech debt**（详见 `docs/internal/plans/phase-7-tech-debt-plan.md`）：
- ✅ T7-1 PartialCommitError（structured 错误码替代误导文案，commit `ab34816`）
- ✅ T7-2 路径白名单（`? # % :` 替换 `_`，分新建 sanitize / 已有 validate 双路径，commit `2c46c4b`）
- ✅ T7-3 端到端 AbortSignal（4 层贯通；切 AU 中途取消生成，commit `2355eb9`）
- ✅ T7-6 confirm 后增量索引 + RAG STALE 降级（commit `e6686f8`）
- ✅ T7-8 rebuildForAu 中途失败 unload 恢复（commit `be7c1fc`）

### 待开新分支继续

- **真机回归**（仅 1 项未跑）：T7-8 真机验证（生成 → 断网 → 定稿 → 手动重建 → 恢复网络 → 生成 → 看 RAG 是否非空）。理论上修对了，但没真测。开新会话先做这个。
- **T7-7** P2：RAG 召回 top_k=3 太少 → 改 5-8（用户实测体感不够；方案 A 30 分钟）
- **T7-4** P2：Import pipeline rollback 覆盖不全
- **T7-5** P3：429 retry 不可中断

### Codex 累计教训（写入新会话提示）

- 写入含中文字符串的文件时多次引入 UTF-8 双重编码乱码（5 处已修），简报必须强约束"file 命令验证 UTF-8 no-BOM + grep 验证无乱码"
- 诊断报告必须附 logcat / grep 实证（曾在 T7-3 之前错认为 secure-storage hang，实际是 React useEffect 死循环）
- 拆分代码默认走 setter 注入式 reshape；必须明确"hook 不收 setter / state 与 reset 同文件 / 跨 hook 只传 value"

## 关键决策

- **D-0034** 架构迁移为 TypeScript 统一核心引擎
- **D-0035** 向量存储从 ChromaDB 迁移为 JSON 分片 + 内存检索
- **D-0036** 数据同步基于 ops 日志合并（ops 是唯一 truth，state/facts 是 ops 的投影）
  - `rebuildFromOps` 只承诺重建 `state.yaml` / `facts.jsonl` 这类 ops-backed projection，不承诺恢复 `chapters/main/*.md` 正文文件。
  - 如果出现 "ops 已提交但 chapter 正文写失败" 的 partial commit，必须视为人工介入事故；前端提示应引导用户检查章节文件并从幸存草稿重新定稿，而不是宣称系统可自动自愈。
- **D-0037** 移动端 Capacitor (Android) + PWA (iOS/Web)
- **D-0038** 桌面端和移动端各自独立管理 Embedding 模型
- 新创建的 fandom / AU / lore 路径段统一收紧到白名单：字母、数字、Unicode 字母、空格、`-`、`_`、`.`；诸如 `? # % : * " < > / \` 的保留字符一律替换为 `_`。

## 技术栈

| 层 | 技术 |
|----|------|
| 核心引擎 | TypeScript（src-engine/，独立于 UI） |
| 前端 | React + Vite（src-ui/） |
| 桌面壳 | Tauri 2 |
| 移动壳 | Capacitor (Android) / PWA (iOS) |
| LLM 调用 | openai-node SDK（OpenAI 兼容接口） |
| Token 计数 | js-tiktoken |
| 向量检索 | JSON 分片 + 内存 cosine similarity |
| YAML 读写 | js-yaml |
| Frontmatter | gray-matter |
| Docx 导入 | mammoth.js |
| 本地 Embedding | Python sidecar（可选，bge-small-zh） |

## Python 后端（src-python/，迁移中）

迁移完成前仍然保留运行。迁移后精简为 ~150 行仅做本地 embedding：
- `POST /embed` 接受文本返回向量
- `GET /health` 心跳检测

## 内部参考文档

`docs/internal/` 目录（.gitignore 排除，不进公开仓库）：
- `prd/` — PRD v2 + 补充 PRD v2/v3/v4
- `audit/` — CC 审计报告
- `decisions/` — 决策记录
- `devlog/` — 开发日志
- `milestone/` — 里程碑总结
- `governance/` — 治理文档

## 高风险模块（迁移时重点关注）

1. **undo_chapter**（10 步级联回滚，无 unit 测试）→ 迁移前先补 Python 端测试建立 golden test
2. **context_assembler**（P0-P5 六层预算竞争）→ 固定输入/输出 golden test
3. **ops.jsonl 多设备同步** → lamport clock + op_id 去重 + state/facts 从 ops 重建

---

## Claude Code 行为约束

### 禁止自行操作
- **禁止** 自行执行 git push
- **禁止** 自行执行 git merge
- **禁止** 自行切换到 main 分支
- **禁止** 自行创建 PR 并合并

### 必须等待人工确认
- 完成任务后，输出结论和 git diff --stat，等待人工确认
- 人工说"提交"或"合并"后才可执行 git 操作
- 如果人工没有明确指示，就停在当前状态等待

### 允许的 git 操作
- git add（暂存改动）
- git commit（在当前分支提交）
- git status / git diff / git log（查看状态）

### 分支规则
- 在人工指定的分支上工作，不自行创建或切换分支

---

## 工作原则

### 质量优先于省力

**不找"最省力方法"**。写代码 / 修 bug 时：

- **功能实现完整**：不为省时间跳过功能边界 —— 迁移、错误处理、边界条件、回滚、并发防护，都算功能的一部分。
- **少代码冗余**：同一字面量 / 同一判据逻辑不允许两处手工维护；**建立单一真相源**，其他地方 import 使用。
- **健壮性**：错误路径要处理（rollback / 降级 / warn）；并发路径要有锁或快照保护；状态变更要考虑"半成功"场景。
- **可维护性**：模块职责单一；命名反映语义；注释写"为什么"不是"怎么做"；新增字段要 trace 到完整数据链的每一环。
- **可拓展性**：接口留扩展点。例子：新增字体只改 manifest.ts 数据，不改 downloader / registry / service 代码。

### 单一真相源（示例）

```
默认值：engine 的 createXxxConfig() 一处定义，UI 层 import 使用
判据函数：UI / engine 共用同一个公共函数（如 scriptSlotOf）
枚举/清单：FONT_MANIFEST 一处声明，全项目 grep 只能找到这一个定义
```

### Hook 设计规则（2026-04 Writer 状态下沉重构确立）

**真实案例**：Codex 2026-04-19 拆 WriterLayout 时把 state 留在顶层、靠传 setter 让 hook 操作（`useWriterResetOnAuChange` 收 28 个 setter、`useWriterBootstrap` 收 26 参数）。结构上是"reshape 不是 refactor"：文件拆了，耦合没降；加新 state 要改 5-6 个文件；Android 上暴露 useEffect 死循环。后续用 4 个 Phase 把 22 个 useState 从 WriterLayout 下沉到各自 hook 内部（详见 `docs/internal/devlog/2026-04-writer-state-pushdown.md`）。

**从此以后，Hook 必须遵守**：

1. **Hook 不接收 setter 作为参数**。如果 hook 需要修改某个 state，那个 state 就必须住在它内部。
   - 例外：textarea / 下拉这种受控组件**的用户事件 setter** 允许暴露（命名必须是动词，如 `selectDraft` 而不是 `setActiveDraftIndex`；`setInstructionText` 因 textarea 双向绑定是硬需求允许保留）
   - 例外：跨 hook bridge 的语义化注入方法允许（如 `setFocusFromState(focus)` 给 bootstrap 加载后同步初始 focus —— 它是"用引擎状态同步"的语义，不是裸 setState）
2. **State 和它的 reset 逻辑住在同一文件**。每个持有 state 的 hook 自己用 `useEffect(() => { reset }, [auPath])`（或对应的 key）处理上下文切换。**禁止**写"reset 集中 hook"那种模式 —— 它的参数列表会无限膨胀。
3. **跨 hook 共享只传 value 不传 setter**。要修改其它 hook 的 state，调用它暴露的语义化 method（命名用动词：`appendStream` / `markGeneratedWith` / `clearDraftState`）。
4. **依赖数组爆炸时用 ref shim**：如果一个 useEffect 的 useCallback dep 数组 > 10 个，大概率其中某个 ref 引用不稳会导致 dep 变化 → 死循环。用 `const fnRef = useRef(fn); fnRef.current = fn;` + `useEffect(() => { void fnRef.current(); }, [keyDep])` 破局。Phase 状态下沉后 dep 自然收敛，可移除 shim。
5. **Hook 不对外暴露 raw setter**。返回值里出现 `setX: (value) => void` 一律视为待清理（除非它服务于下面例外）。允许的例外：
   - **受控组件的双向绑定**（`<textarea value={x} onChange={setX}>`、`<input>` 的 `setChapterTitle` / `setInstructionText`）—— 必须在返回对象里注释"受控绑定"
   - **用户事件 setter 用动词命名**（`selectDraft` 而不是 `setActiveDraftIndex`；`dismissDirtyBanner` 而不是 `setDirtyBannerDismissed`）
   违反示例：`useWriterChromeState` 曾一并导出 11 个 raw setter（`setMobileToolsOpen / setExportOpen / ...`）—— 2026-04-20 Phase 6.3 清理后只保留 2 个有语义理由的。

**验收工具**（CI 可接入）：
```bash
# hook type 里不应有裸 setter 参数（允许 ≤ 5 个已知例外）
grep -E "set[A-Z]\w*:" src/ui/**/useXxx*.ts | wc -l
# 顶层组件应该大部分是 JSX 编排，useState 不应成堆
grep -c "useState" src/ui/SomePage.tsx   # < 5 是健康
```

---

## 查 Bug 的方法论

### 端到端 trace 数据流（强制）

**教训**：单文件 self-review 多轮也发现不了结构性 bug。

真实案例（2026-04 字体系统 Phase 7 才发现）：`dictToAppConfig` 完全漏接 `app.fonts` 字段 → Phase 4 以来**字体偏好从未跨会话持久化**（靠 localStorage 兜底掩盖了）。5+ 轮单文件自检都没发现，直到顺着"UI write → yaml.dump → yaml.load → dict-to-domain → UI read"完整走了一遍才看见。

### 查 bug 的流程

1. **画完整数据链**：用户操作 → state → localStorage → engine settings → yaml.dump → WebDAV sync → yaml.load → dict-to-domain → 回到 UI。**每一环都必须有对应代码**。
2. **每个环节验证有测试** —— 没测试的环节就是风险点。
3. **特别检查写入路径和读取路径的对称性**：有写必有读，有 save 必有 load（round-trip test 证明闭环）。
4. **新增字段 / 新增 config 时**：主动 grep 到 dict-to-domain 映射函数、序列化函数、所有 copy/clone 点，确认新字段都被处理。**不要只依赖 TypeScript 静态类型 —— 它不检查 yaml 字典到 domain 对象的转换**。

### 容易忽视的 bug 模式

- **stale closure**：React setter 依赖其他 state 时，用 ref 缓存最新值 / 函数式 setState，不依赖闭包值。
- **嵌套对象浅合并**：`{ ...current, nested: newNested }` 会整体替换 `nested`，不是深合并。要么传完整对象，要么写递归深合并。
- **Silent fallback**：`??` / `||` / `catch () => {}` 的回退路径会掩盖 bug。写代码时问自己"fallback 实际何时触发？触发时表现正确吗？"
- **死代码里的 typo**：fallback 永不触发的话，里面的 typo 会潜伏 —— 谁知道哪天条件变了就炸。
- **双处手工同步的字面量**：同一常量出现在两个文件里 = 冗余 + 随时间漂移的 bug 源。
- **新字段被沉默丢弃**：加 `interface FooConfig` 新字段 → `createFooConfig` 有了默认 → 但 `dictToFooConfig`（YAML / JSON 的映射函数）没处理 → 持久化断链。

### 审查节奏

- **只看自己新写的代码 → 容易漏结构性 bug**
- 要主动 trace 到**原有代码**里看是否有新字段 / 新类型未被处理
- "它能 build + 测试绿" ≠ "它 works"。**跑 dev server / preview 亲眼看一遍**，尤其是跨会话 / 跨设备的持久化路径。
- **测试的真正价值是 round-trip 闭环证明**，不是单元逻辑覆盖。

---

## 架构迁移

> 迁移总览、架构图、关键决策（D-0034 ~ D-0038）见上文对应章节，此处不重复。

### 参考文档位置（必读 / 参考）

```
docs/internal/prd/FicForge-补充PRD-v4-架构迁移与移动端-final.md  — 迁移方案（必读）
docs/internal/audit/CC-AUDIT-migration.md                       — 源码审计报告（必读）
docs/internal/prd/fanfic-system-PRD-v2.md                        — 原始功能设计（参考）
docs/internal/decisions/DECISIONS-updated.md                     — 所有架构决策（参考）
```

### 迁移原则

1. **Python 源码是最权威的规格说明书**。PRD 定义"应该怎样"，Python 代码定义"实际怎样"。两者冲突时以代码为准
2. Repository 接口签名直接复制到 TypeScript interface
3. 不要改动现有 Python 代码（除非是补测试）
4. 每个 Phase 完成后写 devlog 到 `docs/internal/devlog/`

### src-engine/ 目录补充

上文架构图列出了核心子目录。以下是架构图未体现的补充细节：

- `repositories/interfaces/` — TypeScript interface（从 Python ABC 翻译）
- `repositories/implementations/` — 文件 I/O 实现
- `platform/` — PlatformAdapter 接口 + 平台适配（Tauri / Capacitor / Web）
- `index.ts` — 统一导出入口

前端导入方式：`import { ... } from "@ficforge/engine"`（Vite alias 已配置）。

### 文件所有权

| 范围 | 负责人 |
|------|--------|
| `src-engine/` 全部 | CC |
| 前端 API 层切换（client.ts 等） | CC |
| 移动端 UI 适配 | Codex（后续任务） |
| 现有 Python 代码 | 冻结，不改动 |
