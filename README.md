# FicForge · 粮坊

**English** | [中文](README_zh.md)

> You ship a rare pair. Nobody writes them. You try AI, but it forgets your character's personality by chapter 10, drops every plot thread you set up, and ignores the worldbuilding you spent hours writing.
>
> FicForge fixes that.

A local-first AI writing tool built for **fanfiction writers who use AI to create content for pairings nobody else writes.**

Not a generic AI writing assistant. Not a novel generator. A system that keeps AI consistent across 100+ chapters — because your characters deserve better than being forgotten.

---

## The Problem

If you've used AI for long-form fanfiction, you've hit these:

- **Character collapse**: You wrote 3000 words of character analysis. AI ignores it by chapter 3
- **Lost foreshadowing**: You carefully planted a plot thread. AI pretends it never happened
- **Relationship regression**: Characters have grown closer over 20 chapters. AI resets them to strangers
- **Worldbuilding amnesia**: You built an entire world. AI makes up its own

The root cause is context window limits — AI can't remember everything you've written. Most AI writing tools try to solve this with "auto-summarization," but summaries lose information, especially the details you care about most.

FicForge takes a different approach: **you decide what matters, AI injects it precisely when writing.**

---

## How It Works

- **Plot Points**: Mark something as foreshadowing — it stays in AI's memory until you say it's resolved
- **Character Profiles**: Core personality traits get a protected "minimum budget" — even when context is full, your protagonist's personality won't be cut
- **Chapter Focus**: Tell AI "this chapter must advance this plot thread" — no more random tangents
- **AI Settings Assistant**: Describe what you want in plain language. AI suggests changes, you confirm each one — AI proposes, never acts alone
- **Semantic Search**: AI automatically retrieves the most relevant snippets from your settings and past chapters. No manual copy-paste
- **Multi-draft**: Generate multiple versions of the same chapter, compare side by side, finalize the one you like

---

## Privacy

- **All data stays on your device.** FicForge does not upload your data to any server we control — we don't have servers
- When you use AI writing features, your content is sent to the API provider you configure (e.g. DeepSeek) — this is necessary for generation and is under your control
- Built-in semantic search runs entirely on your machine

---

## Install

### Windows (Desktop)

1. Download `FicForge_0.2.0_x64-setup.exe` from [Releases](../../releases)
2. Run the installer
3. Open FicForge → configure your API key ([DeepSeek](https://platform.deepseek.com) recommended) → start writing

### Android

1. Download `app-debug.apk` from [Releases](../../releases)
2. Install on your device (you may need to enable "Install from unknown sources")
3. Open FicForge → configure your API key → start writing

### iOS / Web (PWA)

Open the hosted version in Safari → "Add to Home Screen". (Self-hosting required — see Build from Source.)

### Build from Source

```bash
# Frontend + Engine
cd src-ui
npm install
npm run build        # PWA output in dist/

# Desktop (Tauri)
npm run tauri build  # Windows installer

# Android (Capacitor)
npx cap sync android
cd android && ./gradlew.bat assembleDebug
```

Requires Node.js 18+. Android build requires JDK 17+ and Android SDK.

---

## Compatibility

- **Models**: Any OpenAI-compatible API — DeepSeek, GPT, Ollama, local models
- **Language**: Bilingual UI (中文 / English), switch anytime
- **Import**: txt / md / html / json with automatic chapter splitting and AI chat log parsing
- **Built-in search**: Ships with Chinese embedding model (bge-small-zh), works out of the box. English users should configure an API embedding (e.g. OpenAI `text-embedding-3-small`) in Global Settings for best results

---

## Responsible Use

FicForge is for writing your own stories, not for taking others'.

- Only import content you own
- When publishing AI-assisted work, consider disclosing AI involvement
- Export includes an AI attribution notice by default
- Follow the rules of your creative community

See [ETHICS.md](ETHICS.md) for our full statement.

---

## Multi-device Sync

Sync your writing across desktop and mobile. [Guide](docs/SYNC-GUIDE.md) | [中文指南](docs/SYNC-GUIDE_zh.md)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Core Engine | TypeScript (src-engine/) |
| Frontend | React + TypeScript + Vite + TailwindCSS |
| Desktop | Tauri 2 + Python sidecar (local embedding) |
| Mobile | Capacitor (Android) / PWA (iOS/Web) |
| Vector Search | JSON shards + in-memory cosine similarity |
| LLM | openai-node SDK (OpenAI-compatible API) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPLv3](LICENSE) — FicForge is free and open-source. Any derivative work must be open-sourced under the same license, including network deployments.
```
