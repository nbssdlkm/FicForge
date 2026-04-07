# Repository Governance

## Architecture Principles

1. **Architecture consistency** — core domain logic must remain coherent across changes
2. **Stable main branch** — main should always be buildable and pass tests
3. **Development velocity** — parallel work is encouraged within module boundaries

If these conflict, priority order: consistency > stability > speed.

## Module Zones

### Core Zone (high-risk changes)

- `src-python/core/domain/*` — domain models and state schema
- `src-python/core/services/*` — confirm, undo, import, dirty resolve, facts lifecycle
- `src-python/repositories/interfaces/*` — repository contracts

Changes to core zone require careful review and should be accompanied by test coverage.

### Feature Zone (parallel-safe)

- `src-ui/src/ui/*` — UI components
- `src-python/api/routes/*` — API endpoints
- `src-python/tests/*` — test suites
- `docs/*` — documentation

### Infrastructure Zone

- `src-python/infra/*` — LLM providers, embeddings, vector index, storage

Changes must stay within adapter boundaries and not alter domain rules.

## Branch Strategy

- `main` — stable release branch
- Feature branches — one branch per task, named descriptively

All changes go through pull requests. Direct pushes to main are not allowed.

## Commit & PR Requirements

Every PR should include:
- Clear description of what changed and why
- Whether core zone files were modified
- Whether schema or interfaces changed
- Passing tests (`pytest`, `tsc --noEmit`, `i18n:check`)

## Decision Records

Architectural decisions are tracked in [DECISIONS.md](DECISIONS.md). Any change to core domain semantics, state schema, or major flow must be recorded as a decision before implementation.

## Integration Checklist

See [INTEGRATION_CHECKLIST.md](INTEGRATION_CHECKLIST.md) for the pre-merge checklist.
