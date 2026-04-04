## D-0033 i18n Known Limitations

- Date: 2026-04-04
- Status: Accepted
- Owner: Human Maintainer
- Context: During i18n implementation (feat/i18n-frontend), the following limitations were identified and deliberately deferred.

### 1. Embedding model language mismatch

The default embedding model `bge-small-zh` is optimized for Chinese text. When an English user writes English chapters and extracts English plot points, the vector quality for English text will be lower than for Chinese.

Additionally, if a user switches language mid-project, `facts.jsonl` may contain a mix of Chinese and English entries. RAG retrieval quality degrades when the embedding model doesn't match the query language.

**Mitigation (not implemented):**
- Allow configuring a multilingual or English-optimized embedding model (e.g. `bge-small-en`, `multilingual-e5-small`)
- Warn users when switching languages that existing embeddings may need rebuilding

**Decision:** Accept as known limitation for Phase 1. The majority of users are expected to use Chinese. English embedding support can be added when there is actual demand.

### 2. Prompt language follows UI language (Task B dependency)

Frontend i18n (Task A) only translates the UI. All prompts sent to the LLM remain in Chinese regardless of the user's language setting. This means English users will see English UI but receive Chinese-generated chapters.

**Resolution:** Task B (feat/i18n-prompts) will create bilingual prompt templates that follow `app.language`. This is a separate task with its own testing requirements.

### 3. `## Core Constraints` heading bilingual matching

Character profile files may contain either `## 核心限制` (Chinese) or `## Core Constraints` (English) depending on which language was active when the file was created. All matching logic (frontend + backend) has been updated to recognize both headings.

If additional heading conventions are introduced (e.g. `## 核心本质`, `## Core Essence`), the regex patterns in `settings_chat.py` and the frontend check in `AuLoreLayout.tsx` must be updated accordingly.

### 4. Language preference not synced to backend

Currently `app.language` is persisted in `localStorage` only, not written back to `settings.yaml`. For desktop (Tauri WebView) this is fine — localStorage is persistent. However, Task B (prompt bilingualization) requires the backend to know the user's language when assembling prompts.

**Before starting Task B, resolve the sync approach — either:**
- `changeLanguage()` calls `updateSettings()` to write `app.language` back to `settings.yaml`, or
- The generation request includes a `language` parameter so the backend doesn't depend on `settings.yaml` for this value.
