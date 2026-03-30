# 任务交付流程规范（TASK_WORKFLOW.md）

> 本文件定义所有代理（Claude Code / Codex / Antigravity）的任务交付标准流程。
> 所有任务单必须引用本文件。代理执行任务时必须严格遵循以下步骤。

---

## 标准流程（4 步）

### Step 1：创建分支

- 任务开始前，从 `main` 创建专用分支
- 命名规范：`{agent}/{task-id}`
  - 示例：`claude/vector-hookup`、`codex/trash-ui`、`codex/ux-front-001`
- **所有改动只在该分支上进行，禁止直接在 main 上提交**
- 如果任务涉及多个子任务，使用同一分支（除非子任务有文件冲突需要拆分）

```bash
git checkout main
git pull origin main
git checkout -b {agent}/{task-id}
```

### Step 2：完成任务 → 输出报告 → 等待确认

- 在分支上完成所有改动后，**先输出任务报告，不要急于提交或推送**
- 报告必须包含（对照任务单的"输出要求"）：
  1. 实际修改文件列表
  2. 测试结果（通过数 / 新增数 / 回归情况）
  3. 是否越界
  4. 是否触及核心区
  5. 是否需要更新 DECISIONS.md
  6. 风险说明
  7. 任务单要求的其他特定输出项
- **等待人工确认后再进入 Step 3**

### Step 3：提交代码 → 推送分支

- 人工确认报告无问题后，提交并推送：

```bash
git add .
git commit -m "{task-id}: {简要描述}"
git push origin {agent}/{task-id}
```

- commit message 格式：
  - `VECTOR-HOOKUP: 设定文件CRUD向量化联动`
  - `TRASH-UI: 垃圾箱前端页面`
  - `UX-FRONT-001: 术语改名+空状态+错误文案`

### Step 4：发起 Pull Request → Codex 审阅 → 人工合并

- 推送后在 GitHub 上发起 Pull Request：
  - base: `main`
  - compare: `{agent}/{task-id}`
  - PR 标题：与 commit message 一致
  - PR 描述：粘贴任务报告（或关键摘要）

- **在 PR 描述或评论中 @codex 请求审阅**：
  ```
  @codex 请审阅此 PR。重点关注：
  - 是否有越界改动
  - 测试覆盖是否充分
  - 是否与 DECISIONS.md / PRD 冲突
  ```

- **人工（Human Maintainer）最终确认后手动合并**
- 合并方式：Squash and merge（保持 main 历史干净）
- 合并后删除分支

---

## 禁止事项

1. **禁止直接向 main 推送**——所有改动必须经过 PR
2. **禁止未经人工确认就推送代码**——报告先行，确认后提交
3. **禁止自行合并 PR**——只有 Human Maintainer 有合并权限
4. **禁止跨分支改动**——每个任务一个分支，不混用

---

## 特殊情况

### 多代理并行时
- 各自分支独立，互不干扰
- 如果后合并的分支与先合并的产生冲突，由后合并方负责 rebase 解决

### 紧急热修复
- 仍然走分支流程，但可以简化报告（列出改动文件 + 测试结果即可）
- 分支命名：`hotfix/{描述}`

### 任务需要拆多个 PR
- 使用同一分支但分多次 commit
- 或拆为子分支：`{agent}/{task-id}-part1`、`{agent}/{task-id}-part2`
- 每个 PR 独立审阅和合并

---

## 在任务单中的引用方式

所有任务单在开头加入以下一行：

```
> **交付流程**：遵循 TASK_WORKFLOW.md 标准流程（创建分支 → 报告确认 → 推送 → PR + @codex 审阅 → 人工合并）。
```
