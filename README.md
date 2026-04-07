# FicForge · 粮坊

**English** | [中文](README_zh.md)

A local-first AI writing tool for fanfiction creators. Keep your characters consistent across 100+ chapters.

> Can't find the fic you want to read? Write it yourself — with AI that actually remembers your story.

[Screenshot or GIF of the writing interface — placeholder, human will add later]

## Features

- **Structured plot tracking** — AI won't forget the foreshadowing you planted 50 chapters ago
- **Character consistency** — core personality traits are always injected into every generation
- **AI settings assistant** — describe what you want in natural language, AI suggests changes via tool calling, you confirm each one
- **Multi-draft writing** — generate multiple versions, browse and compare, finalize the one you like
- **Works with any OpenAI-compatible API** — DeepSeek, GPT, Ollama, local models
- **Bilingual UI** — 中文 / English, switch anytime
- **Local-first** — all data stays on your machine, nothing uploaded, nothing used for training
- **Built-in semantic search** — ships with Chinese embedding model (bge-small-zh), no setup needed. English users can configure an API embedding (e.g. OpenAI `text-embedding-3-small`) in Global Settings for better retrieval quality

## Quick Start

### Install (Windows)

1. Download the latest release from [Releases](../../releases)
2. Run the `.exe` installer
3. Open FicForge → configure your API key (DeepSeek recommended) → start writing

### Build from Source

```bash
# Backend
cd src-python
pip install -r requirements.txt
PYTHONPATH=. python main.py

# Frontend
cd src-ui
npm install
npm run dev
```

Requires Python 3.12+ and Node.js 18+.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite + TailwindCSS |
| Backend | Python 3.12 + FastAPI |
| Vector DB | ChromaDB + bge-small-zh embedding |
| Desktop | Tauri 2 |

## Responsible Use

FicForge runs locally. Your data is never uploaded or used to train AI models.

Only import content you own. If you publish AI-assisted work, please disclose AI involvement and follow your community's guidelines.

See [ETHICS.md](ETHICS.md) for our full responsible use statement.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPLv3](LICENSE) — FicForge is free and open-source software. Any derivative work must also be open-source under the same license, including network deployments.
