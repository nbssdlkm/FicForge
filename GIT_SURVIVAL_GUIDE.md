# Git 生存指南——给"一人指挥三个 AI"的你

> 你不需要成为 Git 专家。你需要的是：能存档、能回滚、能隔离三个 AI 的工作。

---

## 0. 你只需要记住的 5 个概念

| 概念 | 类比 | 一句话解释 |
|------|------|-----------|
| **仓库 (repo)** | 项目文件夹 | 就是你的项目根目录，Git 在里面记录所有变化 |
| **提交 (commit)** | 游戏存档 | 给当前状态拍一张快照，随时可以回到这个存档 |
| **分支 (branch)** | 平行世界 | 从主线分出一条支线，改坏了不影响主线 |
| **合并 (merge)** | 把支线合回主线 | AI 的工作验收通过后，合并到主干 |
| **main** | 主存档 | 永远保持可用的主分支，三个 AI 不直接碰它 |

---

## 1. 一次性设置（只做一次）

```bash
# 如果还没 clone 你的仓库
git clone https://github.com/你的用户名/你的仓库名.git
cd 你的仓库名

# 设置你的身份（提交时显示的名字）
git config user.name "你的名字"
git config user.email "你的邮箱"
```

---

## 2. 日常工作流（每个任务重复这套）

### 第一步：开新分支（给 AI 一个"平行世界"工作）

```bash
# 确保你在 main 分支上
git checkout main

# 拉取最新代码（如果有远程仓库）
git pull

# 创建新分支并切过去
git checkout -b claude/core-state-machine
#              ↑ 分支名格式：代理名/任务简称
```

### 第二步：让 AI 在这个分支上工作

```bash
# Claude Code CLI 示例：
# 在项目目录下启动 Claude Code，它的所有修改都在当前分支上
claude

# 告诉它任务（贴任务单 prompt）
# 它写完代码后，所有文件变更都只在这个分支上
```

### 第三步：看看 AI 改了什么

```bash
# 查看哪些文件被改了
git status

# 查看具体改了什么内容（按 q 退出）
git diff

# 查看某个具体文件的改动
git diff path/to/file.py
```

### 第四步：你审核通过后，存档（提交）

```bash
# 把所有改动加入暂存区
git add .

# 提交（写一句话说明这次做了什么）
git commit -m "claude: 实现核心状态机 confirm/undo 流程"
```

### 第五步：合并到主线

```bash
# 切回 main
git checkout main

# 把 AI 的分支合进来
git merge claude/core-state-machine

# 如果一切正常，推到远程
git push

# 删掉用完的分支（可选，保持整洁）
git branch -d claude/core-state-machine
```

---

## 3. 救命操作（东西搞坏了怎么办）

### AI 改坏了，我想全部扔掉

```bash
# 放弃当前分支的所有未提交改动
git checkout -- .

# 或者更彻底：删掉整个分支重来
git checkout main
git branch -D claude/坏掉的分支名
```

### 合并后发现有问题，想回滚

```bash
# 查看提交历史（按 q 退出）
git log --oneline

# 回到某个存档（用 git log 看到的那串短码）
git revert HEAD    # 撤销最近一次合并
```

### 两个 AI 改了同一个文件（合并冲突）

```bash
# Git 会告诉你哪些文件冲突了
# 打开文件，会看到类似这样的标记：
# <<<<<<< HEAD
# 你的版本
# =======
# 另一个分支的版本
# >>>>>>> branch-name

# 你手动选择保留哪个版本（或让 Claude Code 帮你解决）
# 改好后：
git add 冲突的文件
git commit -m "resolve merge conflict"
```

---

## 4. 你的实际工作节奏

```
每个任务：
1. git checkout main && git checkout -b 代理名/任务名
2. 启动对应 AI，给任务 prompt
3. AI 干活
4. git status / git diff 看改了什么
5. 对照 INTEGRATION_CHECKLIST 检查
6. 通过 → git add . && git commit && git checkout main && git merge
7. 不通过 → git checkout -- . 或删分支重来
```

---

## 5. 三个 AI 怎么隔离

**关键规则：一个时刻只有一个 AI 在工作。**

你是在本地跑，不是真正的并行。所以实际流程是：

```
1. 给 Claude Code 开分支，让它做完一个任务
2. 审核 → 合并到 main
3. 给 Codex 开分支（基于最新 main），让它做任务
4. 审核 → 合并到 main
5. 如此交替
```

如果你想让两个 AI "同时"工作（比如一个做后端一个做前端），可以：

```bash
# 开两个分支
git checkout main && git checkout -b claude/backend-state
# （Claude Code 做完后先 commit，不合并）

git checkout main && git checkout -b codex/frontend-ui
# （Codex 做完后 commit，不合并）

# 然后你决定合并顺序：
git checkout main
git merge claude/backend-state   # 先合后端
git merge codex/frontend-ui      # 再合前端（如果有冲突这里处理）
```

---

## 6. 有用的命令速查

| 你想做什么 | 命令 |
|-----------|------|
| 看当前在哪个分支 | `git branch` |
| 看所有分支 | `git branch -a` |
| 看最近的提交历史 | `git log --oneline -10` |
| 看某文件的修改历史 | `git log --oneline path/to/file` |
| 暂存当前改动（不提交） | `git stash` |
| 恢复暂存的改动 | `git stash pop` |
| 看远程仓库地址 | `git remote -v` |

---

## 记住一句话

**Git 就是无限存档的游戏。分支就是平行世界。你是唯一能决定"哪个世界合进主线"的人。**
