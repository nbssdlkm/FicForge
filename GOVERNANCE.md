# 仓库治理与代理协作规则（强约束版）

> 本文件是本仓库的最高协作约束之一。除非 `DECISIONS.md` 中有新决策明确覆盖，否则所有代理（Codex / Claude Code / Antigravity）与人工参与者都必须遵守本文件。
>
> 本文件中的 **必须 / 严禁 / 不得 / 仅可** 视为强约束，不是建议。

---

## 1. 目标

本仓库采用 **单仓库、多代理协作** 模式开发。治理目标只有三个：

1. 防止核心状态机被多代理同时修改而失去一致性。
2. 防止 PRD 规则在实现中漂移。
3. 在允许并行开发的同时，保持主干可运行、可回滚、可审计。

---

## 2. 角色与权威链

### 2.1 最终权威

本仓库的最终权威链如下：

1. `DECISIONS.md` 中已记录的有效决策
2. 当前有效 PRD
3. 本文件 `GOVERNANCE.md`
4. 具体任务单 `TASK_TEMPLATE.md` 实例
5. 代理在任务中的局部实现判断

当低层级内容与高层级内容冲突时，必须以上层级为准。

### 2.2 架构总负责人

**Claude Code 线为核心架构与状态机总负责人。**

含义如下：

- 核心状态机的定义、重构、修复，由 Claude Code 线主导。
- 其他代理可以提出建议，但不得绕过 Claude Code 线直接重写核心规则。
- 如果任务触及核心状态机，必须视为高风险任务。

### 2.3 实现与验收角色

- **Codex**：负责独立功能开发、局部实现、测试补齐、文档同步、低到中风险重构。
- **Antigravity**：负责 UI/交互验收、端到端流程回归、截图与证据留存、体验问题发现。
- **人工维护者（你）**：负责分派任务、审核越界、决定合并、最终拍板。

---

## 3. 模块分区与改动权限

详细归属见 `OWNERS.md`。这里定义总原则。

### 3.1 核心区（默认只允许 Claude Code 线主改）

下列目录和逻辑属于核心区：

- `core/domain/*`
- `core/services/*`
- `core/state/*`
- `core/import/*`
- `core/sync_contracts/*`
- `repositories/interfaces/*`
- 任何直接实现以下逻辑的代码：
  - confirm chapter
  - undo latest chapter
  - import init
  - dirty reconcile
  - facts lifecycle
  - `current_chapter` 推进
  - `last_scene_ending` 更新与回滚
  - `chapter_focus` 生命周期
  - 上下文组装器（`assemble_context`）：budget 计算、P 层注入顺序、truncation 策略、核心设定低保预算
  - LLM 运行时切换：三层模型配置、session_llm 传递与恢复、参数加载链
  - ops.jsonl 读写：append 控制、截断修复、sync_unsafe 标记
  - generated_with / provenance / content_hash 写入：横跨 confirm/import/edit/dirty resolve 多个路径
  - 模板导出/导入：脱敏规则、字段重建、唯一总表
  - AU 级互斥锁逻辑
  - 后台任务队列：去重规则、串行约束、WAL 模式

**规则：**

- Codex 与 Antigravity 默认只读。
- Codex 与 Antigravity 不得在未获明确授权的任务中修改核心区。
- 若某任务需要改动核心区，任务单中必须显式写明允许改动的文件路径。

### 3.2 功能区（允许并行）

下列目录通常属于功能区：

- `ui/*`
- `api/routes/*`
- `tests/ui/*`
- `tests/e2e/*`
- `docs/*`

**规则：**

- 可以并行开发。
- 但同一时间，同一子模块只能有一个代理作为主改动者。
- 同一子模块不得由多个代理在不同分支上同时进行互相覆盖式修改。

### 3.3 适配器区（允许改动，但必须严格按任务边界）

下列目录通常属于适配器区：

- `infra/llm/*`
- `infra/embeddings/*`
- `infra/vector_index/*`
- `infra/storage_local/*`
- `infra/platform_desktop/*`
- `infra/platform_mobile/*`

**规则：**

- 适配器区允许多代理参与，但必须任务化。
- 不得以“修适配器”为名顺手改核心领域规则。

---

## 4. 禁止事项

以下行为一律禁止：

### 4.1 禁止顺手修核心逻辑

任何代理在执行非核心任务时，**不得**以“顺手修一下”为由修改：

- confirm / undo / import / dirty 主流程
- state schema
- repository interface
- facts lifecycle
- 同步契约
- 上下文组装器（budget 计算、P 层注入顺序、truncation、低保预算）
- LLM 运行时切换（三层模型配置、session_llm 传递、参数加载链）
- ops.jsonl 读写逻辑
- generated_with / provenance / content_hash 写入逻辑
- 模板导出/导入规则
- AU 级互斥锁
- 后台任务队列（去重规则、串行约束、WAL 配置）

发现问题可以记录，但必须新开任务。

### 4.2 禁止多代理同时主改同一模块

同一时间不得出现以下情况：

- Claude 在改 `core/state/*`
- Codex 也在另一个分支改 `core/state/*`
- Antigravity 又为了 UI 联调改 `core/state/*`

如果发生，必须立即停止后到者的任务，重新切分。

### 4.3 禁止未授权的跨区改动

任务单未授权时，代理不得修改任务边界外的文件。

允许的例外只有：

- 修复本任务引入的编译错误
- 修改本任务直接依赖的导出/类型声明

即便如此，也必须在提交说明中写明原因。

### 4.4 禁止隐式规则漂移

代理不得在代码里偷偷引入与 PRD / `DECISIONS.md` 不一致的新规则。

例如：

- 偷改 `current_chapter` 语义
- 偷改 undo 级联步骤
- 偷改 mobile 能力承诺
- 偷改 facts 的 append-only 规则

若发现现有规则无法实现，必须停下并升级为决策问题，而不是自作主张改规则。

---

## 5. 分支与工作副本规则

### 5.1 一任务一分支

每个任务必须使用单独分支。禁止多个任务共用同一开发分支。

命名建议：

- `claude/core-undo-reconcile`
- `codex/ui-facts-panel`
- `ag/e2e-dirty-flow`

### 5.2 一代理一工作副本

每个代理必须在独立 worktree / workspace 中工作。禁止多个代理共享同一工作目录直接改动。

### 5.3 不允许直接推主干

任何代理不得直接向 `main` 推送代码。

推荐分支流：

- `main`：稳定分支
- `integration`：集成分支
- `agent/*`：任务分支

任务分支先合入 `integration`，通过集成检查后，再进入 `main`。

---

## 6. 任务下发规则

每个任务都必须以 `TASK_TEMPLATE.md` 为模板创建任务单。

任务单中至少必须明确：

- 背景
- 目标
- 不做什么
- 允许改动文件
- 禁止改动文件
- 验收标准
- 测试要求
- 风险提示

**没有任务单，不得开始。**

---

## 7. 提交与 PR 规则

### 7.1 提交说明必须包含边界信息

每个 PR 或补丁说明必须包含：

- 本任务目标
- 实际改动文件
- 是否触及核心区
- 是否修改 schema / 状态 / 接口
- 是否需要补 migration / 决策记录 / PRD 同步

### 7.2 越界改动必须单独标注

如果任务中出现了必要的边界外改动，必须在说明中单列：

- 为什么必须改
- 改了哪些文件
- 是否影响其他模块

未标注视为违规。

### 7.3 合并前必须过检查清单

所有任务在合并前必须通过 `INTEGRATION_CHECKLIST.md`。

---

## 8. 决策记录规则

凡涉及以下内容，必须更新 `DECISIONS.md`：

- 核心状态字段含义变更
- confirm / undo / import / dirty 主流程变更
- 同步策略变更
- 存储层与索引层权威数据边界变更
- 平台能力承诺变更

未更新决策记录，不得视为规则已生效。

---

## 9. Prompt 约束规则

所有代理使用的 prompt，必须服从 `AGENT_PROMPTS.md`。

强制要求：

- prompt 必须明确可改文件范围
- prompt 必须明确禁止顺手修改核心区
- prompt 必须要求发现规则冲突时停下并上报
- prompt 必须要求列出实际改动文件

**没有边界约束的 prompt，视为无效 prompt。**

---

## 10. 违规定义与处理

以下情况视为违规：

- 无任务单开工
- 越界修改未说明
- 非核心任务擅改核心区
- 未更新决策记录却引入新规则
- 未通过集成检查就请求合并
- 多代理同时主改同一模块

处理原则：

1. 立即停止该任务继续推进
2. 记录违规点
3. 必要时丢弃该分支改动并重开任务
4. 若已影响主干，优先回滚，后讨论责任

---

## 11. 最终原则

本仓库追求的是：

- 并行提速
- 架构不漂
- 主干稳定

如果这三者冲突，优先级如下：

1. 架构与状态一致性
2. 主干稳定
3. 开发速度

任何人或代理不得以“为了快”为理由破坏前两项。
