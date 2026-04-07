# FicForge · 粮坊

本地优先的 AI 同人写作系统。写到第 100 章，AI 还记得第 5 章埋的伏笔。

> 写冷 CP 找不到粮？自己动手，用 AI 产。

[写作界面截图 — 占位，人工后续添加]

## 功能亮点

- **结构化剧情追踪** — AI 不会忘记你 50 章前埋的伏笔
- **角色人设不崩** — 核心性格特征始终注入每次生成
- **AI 设定助手** — 用自然语言描述需求，AI 通过 tool calling 建议修改，你逐条确认
- **多稿写作** — 同一章生成多个版本，翻页对比，选满意的定稿
- **兼容任意模型** — DeepSeek、GPT、Ollama、本地模型，支持所有 OpenAI 兼容 API
- **中英双语界面** — 随时切换
- **本地优先** — 所有数据留在你的电脑上，不上传，不用于训练
- **内置语义搜索** — 自带中文向量模型（bge-small-zh），开箱即用。英文写作用户建议在全局设置中配置 API Embedding（如 OpenAI `text-embedding-3-small`）以获得更好的检索效果

## 快速开始

### 安装（Windows）

1. 从 [Releases](../../releases) 下载最新版本
2. 运行安装包
3. 打开 FicForge → 配置 API 密钥（推荐 DeepSeek）→ 开始写作

### 从源码构建

```bash
# 后端
cd src-python
pip install -r requirements.txt
PYTHONPATH=. python main.py

# 前端
cd src-ui
npm install
npm run dev
```

需要 Python 3.12+ 和 Node.js 18+。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React + TypeScript + Vite + TailwindCSS |
| 后端 | Python 3.12 + FastAPI |
| 向量库 | ChromaDB + bge-small-zh 向量模型 |
| 桌面壳 | Tauri 2 |

## 负责任使用

FicForge 在本地运行。你的数据不会被上传，不会被用于训练 AI 模型。

请只导入你自己的作品。发布 AI 辅助创作的内容时，建议标注 AI 的参与，并遵守你所在社区的规则。

详见 [负责任使用声明](ETHICS_zh.md)。

## 参与贡献

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[AGPLv3](LICENSE) — FicForge 是自由开源软件。任何衍生作品必须以相同协议开源，包括网络部署。

选择 AGPLv3，是为了确保 FicForge 始终公开透明，不可被闭源商用。
