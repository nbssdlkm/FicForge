# Contributing to FicForge

## Development Setup

### Prerequisites
- Python 3.12+
- Node.js 18+
- A valid API key for any OpenAI-compatible LLM (DeepSeek recommended)

### Engine (TypeScript core)
```bash
cd src-engine
npm install
npm test          # vitest
```

### Frontend / App
```
```bash
cd src-ui
npm install
npm run dev
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/your-feature`)
3. Make your changes
4. Run tests:
   - Engine: `cd src-engine && npm test`
   - Frontend: `cd src-ui && npm run build && npm test`
   - i18n sync: `cd src-ui && npm run i18n:check`
5. Submit a Pull Request

## Code Style

- **Python**: follow existing style, add type hints where possible
- **TypeScript**: follow existing style. `tsc --noEmit` should pass
- **UI text**: all user-facing text must go through i18n (`zh.json` + `en.json`). Never hardcode Chinese or English strings in components

## Architecture Decisions

Key architectural decisions are documented in [DECISIONS.md](DECISIONS.md). Please review relevant decisions before making changes to core systems.

## License

By contributing, you agree that your contributions will be licensed under AGPLv3, consistent with the project's [LICENSE](LICENSE).
