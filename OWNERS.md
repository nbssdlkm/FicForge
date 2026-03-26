# 模块所有权（OWNERS）

> 本文件定义仓库目录与逻辑所有权。所有任务分派、代码审查、越界判断，以本文件为准。

---

## 1. Owner 角色说明

- **Primary Owner**：主负责人。该模块的规则与主改动权归其所有。
- **Secondary Owner**：可参与，但不得绕过 Primary Owner 推翻规则。
- **Read-Only by Default**：默认只读；除非任务单明确授权，否则不得修改。

---

## 2. 所有权矩阵

> ⚠️ 以下目录路径为**预定义结构**，实际路径在第一个任务（项目骨架搭建，由 Claude Code 执行）完成后以实际代码结构为准。在骨架搭建前，以逻辑层级（§3）为所有权判定依据。

| 模块 / 目录 | Primary Owner | Secondary Owner | 默认权限 | 备注 |
|---|---|---|---|---|
| `core/domain/*` | Claude Code | Human Maintainer | 其他代理只读 | 领域对象与规则 |
| `core/services/*` | Claude Code | Human Maintainer | 其他代理只读 | 核心用例与流程 |
| `core/state/*` | Claude Code | Human Maintainer | 其他代理只读 | 状态字段与状态迁移 |
| `core/import/*` | Claude Code | Human Maintainer | 其他代理只读 | 导入与初始化流程 |
| `core/sync_contracts/*` | Claude Code | Human Maintainer | 其他代理只读 | 同步边界与契约 |
| `repositories/interfaces/*` | Claude Code | Human Maintainer | 其他代理只读 | 抽象接口，不得随意变更 |
| `infra/storage_local/*` | Claude Code | Codex | 授权后可改 | 需严格任务化 |
| `infra/vector_index/*` | Claude Code | Codex | 授权后可改 | 不得顺手改领域规则 |
| `infra/llm/*` | Claude Code | Codex | 授权后可改 | Provider 封装 |
| `infra/embeddings/*` | Claude Code | Codex | 授权后可改 | Embedding 适配 |
| `infra/platform_desktop/*` | Codex | Claude Code | 可改 | 桌面壳与平台集成 |
| `infra/platform_mobile/*` | Claude Code | Codex | 授权后可改 | 未来安卓 / iOS 预留 |
| `api/routes/*` | Codex | Claude Code | 可改 | 仅路由/DTO，不得偷改领域规则 |
| `ui/writer/*` | Codex | Antigravity | 可改 | 主写作页 |
| `ui/facts/*` | Codex | Antigravity | 可改 | facts 面板与管理页 |
| `ui/settings/*` | Codex | Antigravity | 可改 | 设置界面 |
| `ui/debug/*` | Codex | Antigravity | 可改 | 调试面板 |
| `ui/shared/*` | Codex | Antigravity | 可改 | 公共组件 |
| `tests/unit/*` | Codex | Claude Code | 可改 | 单元测试 |
| `tests/integration/*` | Claude Code | Codex | 可改 | 状态流与接口集成 |
| `tests/e2e/*` | Antigravity | Codex | 可改 | 端到端验收 |
| `docs/*` | Codex | Claude Code | 可改 | 文档同步 |
| `PRD/*` | Claude Code | Human Maintainer | 其他代理只读 | 产品规则源 |

---

## 3. 逻辑层级所有权（比目录更重要）

即使目录不在核心区，只要逻辑属于以下内容，仍视为 Claude Code 主责范围：

- confirm chapter
- undo latest chapter
- import init
- dirty reconcile
- `current_chapter` 推进逻辑
- `last_scene_ending` 更新/回滚
- facts lifecycle
- `chapter_focus` 生命周期
- 同步契约与权威数据边界
- 上下文组装器（budget 计算、P 层注入顺序、truncation、低保预算）
- LLM 运行时切换（三层模型配置、session_llm 传递、参数加载链）
- ops.jsonl 读写（append 控制、截断修复、sync_unsafe）
- generated_with / provenance / content_hash 写入逻辑
- 模板导出/导入（脱敏规则、字段重建、唯一总表）
- AU 级互斥锁
- 后台任务队列（去重规则、串行约束、ChromaDB WAL）

**解释：**
某个页面、路由或适配器如果动到了上述逻辑，默认按核心逻辑处理，而不是按表面目录处理。

---

## 4. Ownership 裁决规则

出现以下情况时，按下述方式裁决：

### 4.1 任务想改的文件横跨多个 owner

必须拆任务；若不能拆，则由涉及的最高风险模块 owner 主导。

### 4.2 目录归属和逻辑归属冲突

以逻辑归属为准。

### 4.3 Secondary Owner 发现 Primary Owner 模块有问题

可以：

- 提 issue
- 提 patch 建议
- 提只读分析

不可以：

- 未授权直接主改
- 通过其他入口绕过 owner 机制

---

## 5. 人工维护者保留权

人工维护者（你）保留以下权力：

- 临时授权越区改动
- 暂停某个代理的任务
- 要求拆分任务
- 拒绝任何不符合所有权规则的 PR
- 在紧急回滚时绕过通常 owner 顺序

