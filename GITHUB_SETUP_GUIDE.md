# GitHub 仓库设置指南

> 按顺序操作，15 分钟内完成。

---

## 1. 添加 AGPL-3.0 许可证

### 方法 A：通过 GitHub 网页（最简单）

1. 打开你的仓库页面
2. 点击 **Add file → Create new file**
3. 文件名输入 `LICENSE`
4. 右边会出现 **Choose a license template** 按钮，点击
5. 在列表中选择 **GNU Affero General Public License v3.0**
6. 填入年份和你的名字/组织名
7. 点击 **Review and submit → Commit changes**

### 方法 B：通过命令行

```bash
# 在项目根目录
curl -o LICENSE https://www.gnu.org/licenses/agpl-3.0.txt
git add LICENSE
git commit -m "add AGPL-3.0 license"
git push
```

---

## 2. 把这些文件放入仓库根目录

```
你的仓库/
├── LICENSE                    ← AGPL-3.0（上一步已添加）
├── LICENSING.md               ← 双许可说明（已为你生成）
├── README.md                  ← 项目介绍（下方有模板）
├── .gitignore                 ← 忽略文件列表（下方有模板）
│
├── GOVERNANCE.md              ← 仓库治理规则
├── OWNERS.md                  ← 模块所有权
├── DECISIONS.md               ← 关键决策记录
├── TASK_TEMPLATE.md           ← 任务单模板
├── AGENT_PROMPTS.md           ← 代理 Prompt 规范
├── INTEGRATION_CHECKLIST.md   ← 集成前检查清单
├── README-ADOPTION.md         ← 治理文档落地指南
├── TASK_BREAKDOWN.md          ← 任务切分方案
├── GIT_SURVIVAL_GUIDE.md      ← Git 生存指南
│
└── docs/
    └── fanfic-system-PRD-v2.md  ← PRD 主文档
```

---

## 3. 推荐的 .gitignore

```gitignore
# Python
__pycache__/
*.py[cod]
*.egg-info/
dist/
build/
*.egg
.venv/
venv/

# Node / Frontend
node_modules/
.next/
dist/

# Tauri
src-tauri/target/

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# 环境与密钥（绝不能提交）
.env
.env.local
*.key
settings.local.yaml

# 运行时产物
*.db
*.db-wal
*.db-shm
chromadb_data/
tiktoken_cache/

# PyInstaller
*.spec
build/
dist/

# 测试覆盖率
.coverage
htmlcov/
```

---

## 4. README.md 模板

```markdown
# [项目名称]

> 本地优先的同人写作 AI 辅助系统。解决长篇连载中 AI 设定遗忘、前后矛盾的问题。

## 特性

- 📚 结构化上下文工程——不靠大 context window，靠精准注入
- 🧠 事实表（Facts）追踪伏笔生命周期
- 🔍 RAG 检索历史细节
- 🎯 章节焦点系统，引导 AI 推进指定伏笔
- 💾 本地优先，数据完全在你手里
- 🔄 多模型支持——API / 本地 / Ollama，随时切换

## 快速开始

*（开发中，Coming Soon）*

## 许可证

本项目采用 [AGPL-3.0](./LICENSE) 许可证开源。

商业许可请联系：[your-email@example.com]

详见 [LICENSING.md](./LICENSING.md)
```

---

## 5. GitHub 仓库设置（网页操作）

进入仓库 → **Settings** 标签页：

### 5.1 General
- **Default branch**: `main`（通常已经是）

### 5.2 Branches → Branch protection rules
点击 **Add rule**：
- Branch name pattern: `main`
- ☑️ **Require a pull request before merging**（防止直接推主干）
  - Required approving reviews: `1`（就是你自己审）
- ☑️ **Do not allow bypassing the above settings**

> ⚠️ 如果你是唯一维护者且三个 AI 都在本地跑，这条保护规则可以**暂时不开**——等你熟悉 Git 后再启用。初期用 Git 生存指南里的手动分支流程就够了。

### 5.3 可选：CLA Assistant
1. 去 https://cla-assistant.io/
2. 用 GitHub 账号登录
3. 关联你的仓库
4. 上传 CLA 文本（用 LICENSING.md 中的 CLA 段落即可）
5. 以后任何人提 PR 时会自动要求签署

> 初期只有你和 AI 在开发，CLA 可以等到第一个外部贡献者出现时再配。

---

## 6. 首次提交的操作步骤

```bash
# 进入你的仓库目录
cd 你的仓库名

# 把所有准备好的文件复制进来
# （LICENSING.md, GOVERNANCE.md, OWNERS.md, DECISIONS.md, 
#   TASK_TEMPLATE.md, AGENT_PROMPTS.md, INTEGRATION_CHECKLIST.md,
#   README-ADOPTION.md, TASK_BREAKDOWN.md, GIT_SURVIVAL_GUIDE.md,
#   .gitignore, README.md）
# 把 PRD 放到 docs/ 目录下

# 添加所有文件
git add .

# 提交
git commit -m "初始化：添加 AGPL-3.0 许可证、治理文档、PRD、任务切分方案"

# 推到 GitHub
git push

# 验证：打开 GitHub 仓库页面，应该能看到许可证标识
```

---

## 检查清单

- [ ] LICENSE 文件已添加（AGPL-3.0）
- [ ] LICENSING.md 已添加（双许可说明）
- [ ] README.md 已添加
- [ ] .gitignore 已添加
- [ ] 所有治理文档已放入根目录
- [ ] PRD 已放入 docs/ 目录
- [ ] GitHub 仓库设置已确认
- [ ] 首次 commit 已推送
