# 这些文档怎么落地

这套文档已经写成强约束风格，但**光把 markdown 放进仓库，并不会自动强制执行**。

为了让它真正有约束力，至少要配合下面四件事：

1. 每次下任务都真的使用 `TASK_TEMPLATE.md`
2. 每次给代理发 prompt 都带上 `AGENT_PROMPTS.md` 中的通用强制段
3. 任何代码都不直接进 `main`，而是走分支 + 你人工审核
4. 合并前真的过 `INTEGRATION_CHECKLIST.md`

建议仓库根目录放置：

- `GOVERNANCE.md`
- `OWNERS.md`
- `TASK_TEMPLATE.md`
- `DECISIONS.md`
- `AGENT_PROMPTS.md`
- `INTEGRATION_CHECKLIST.md`

最小执行流程：

1. 先写任务单
2. 再发给某个代理
3. 代理在独立分支里做
4. 回来时必须汇报实际改动文件与是否越界
5. 你按检查清单决定是否合并

**推荐的第一个任务（项目骨架搭建）：**

由 Claude Code 执行，目标是：
1. 初始化项目目录结构（对齐 PRD §2.6 分层约束）
2. 搭建 Tauri + FastAPI sidecar 基础框架
3. 创建 Repository 接口定义（抽象层）
4. 配置依赖管理（requirements.txt / package.json）
5. ~~完成后更新 OWNERS.md 中的目录路径为实际路径~~ ✅ 已在 T-001 中完成（2026-03-26）

