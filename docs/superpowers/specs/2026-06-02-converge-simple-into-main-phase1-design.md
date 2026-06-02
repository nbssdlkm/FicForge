# Phase 1 Design Spec — Converge `fanfic-system-simple` fork into MAIN (engine layer)

**Date:** 2026-06-02
**Status:** Design **Rev 2** — post 3-way independent review (Claude subagent + DeepSeek-v4-pro + CC code-verification); ready for implementation workflow
**Scope owner:** CC
**Source fork:** `D:\fanfic-system-simple` (branch `feat/agent-harness-v1`)
**Target:** `D:\fanfic-system` (new branch, name TBD by human; do NOT create/switch in implementation without instruction)

**Rev 2 changelog (what the review caught + changed):**
- **+E12 `llm/provider.ts`** (A1, CC-verified): MAIN lacked `ToolChoice`/`ToolCallChunkDelta`/`reasoning_*`/`tool_call_deltas` the harness imports — **build-critical**, was wrongly listed "present."
- **+E13 `llm/openai_compatible.ts`** (A2, CC-verified): additive stream-delta emission (simple tools dead without it) **+ the ONE deliberate full-path change** (narrowed 400 tool-error classifier — a bug fix; §7).
- **+E14/E15 barrels** `domain/index.ts` & `services/index.ts` (A4).
- **A3:** `AssembleContextResult.systemMessage?/userMessage?` made optional, populated only in simple; full path adds **neither** key (avoids deep-equal/snapshot breakage — DS).
- **Ambient → optional param:** replaced module-level `setAmbientWritingMode` with an optional `writingMode='full'` param on `assemble_context` (DS race/cleanup concern eliminated; AsyncLocalStorage rejected — WebView runtime).
- **Red-line refined:** zero-churn = *behavior* unchanged, not *test-count* unchanged; `prompts.test.ts` 55→58 + the openai test addition are expected, not violations.
- **`zod@^4.4.3`** pinned (v4 semantics; verified absent in MAIN). + DS pre-flight scans (S0.3).

---

## 1. Overview & Scope

### 1.1 Goal

Bring the simple-fork's **agent-harness** (generic agent loop, telemetry, tool-arg repair, tool stream buffer) and **simple-mode engine layer** (simple context assembler, simple chat dispatch, simple tools, simple-chat persistence) into the MAIN repo so that **both writing modes coexist behind a single runtime mode setting**. The fork currently hardcodes "simple everywhere" via a compile-time flag const (`SIMPLE_FEATURES`); MAIN must instead make those four flags **derived from a per-config `writingMode` field** so MAIN ships as `full` by default with zero behavior change, and `simple` is reachable at runtime.

### 1.2 Convergence strategy (approved)

- **Scope:** full convergence via **flag coexistence** (not a parallel build, not a runtime fork of the whole engine).
- **Mechanism:** **file-level port** of the fork's additive files to the same paths in MAIN, plus a small set of surgical edits to existing MAIN files.
- **Mode switch:** **Mode B — global runtime setting.** A single `writingMode: 'full' | 'simple'` lives in `AppConfig` (persisted via the existing settings YAML). All four simple flags become a pure function of that field.

### 1.3 In scope (Phase 1)

- New `writingMode` field in `AppConfig` (single source of truth for the mode), default `'full'`.
- A pure resolver `getSimpleFeatures(mode)` deriving the 4 booleans, replacing the const `SIMPLE_FEATURES`.
- Port of all additive engine/domain/repo/service/test files (manifest §4).
- Surgical edits to existing MAIN files: `context_assembler.ts`, `generation.ts`, `settings.ts`, `file_settings.ts`, `settings_tools.ts`, `prompts/keys.ts`, `prompts/zh.ts`, `prompts/en.ts`, `index.ts`, both repo `index.ts` barrels.
- Tests: port the fork's harness/dispatch/telemetry tests (with adapted flag-injection), keep MAIN's full-mode golden/budget tests **green and byte-identical under `full`**, add new simple-mode + round-trip assertions.

### 1.4 Out of scope (explicit)

- **All `src-ui/` UI is OUT OF SCOPE for Phase 1.** No React components, no `src-ui/src/api/*`, no settings toggle UI, no chat panel. The mode is switchable only programmatically / by editing the persisted settings in Phase 1. The user-facing toggle is **Phase 2**.
  - Note: `src-ui/src/api/engine-simple-dispatch.ts` and `src-ui/src/api/engine-generate.ts` exist in the fork and are the eventual Phase 2 callers of the ported engine. They are **not** ported in Phase 1.
- No removal/retirement of MAIN's full-mode code paths. `full` remains the default and primary path.
- No data migration. Existing settings YAML without `writing_mode` loads as `'full'`.
- No changes to `disableChapterSummary`-gated behavior beyond carrying the (currently inert) flag — there is **no live consumer** of it in either repo (placeholder for M8; see §3.4).

### 1.5 Code principles honored (binding for implementation)

- **Single source of truth:** the mode default (`'full'`) is defined in exactly one place (`createAppConfig`); the 4 derived booleans are computed in exactly one place (`getSimpleFeatures`). No duplicated literal `true`/`false` flag tables in product code.
- **Low coupling / engine purity:** prefer **read-from-config** over global mutable state wherever an `AppConfig`/`Settings` is already in scope. A module-level resolver fallback is used **only** where no config is threaded (one site), and it is set explicitly (no implicit global mutation from arbitrary call sites).
- **Functional completeness:** error paths (invalid mode value, agent max-iter, partial rescue, corrupted simple-chat YAML) are part of the deliverable, not follow-ups.
- **Extensibility:** adding a future mode/flag touches **data** (`writingMode` union + `getSimpleFeatures` mapping), not control flow at ~6 consumption sites.

---

## 2. Decisive architecture finding (drives the wiring)

Recon established the actual control flow in the fork — this is the single most important fact for the spec:

- **Simple mode does NOT go through `generate_chapter`.** The fork's simple path is `simple_chat_dispatch.ts` → `assemble_context_simple(...)` **called directly** (`simple_chat_dispatch.ts:418`) and tools via `get_tools_for_mode("simple")` (`:425`). It never calls `generate_chapter`, and `assemble_context_simple` never consults the flag.
- The `SIMPLE_FEATURES` flag is read in only **two** product sites, both inside `generate_chapter`'s collaborators:
  1. `context_assembler.ts:470` — `if (SIMPLE_FEATURES.simpleAssembler) return assemble_context_simple(...)`. This is the **full-mode** entry `assemble_context`, reached from `generate_chapter` (`generation.ts:246`). In the fork it routes the full path into the simple assembler; in MAIN it must route only when mode resolves to `simple`.
  2. `generation.ts:220` — `if (!SIMPLE_FEATURES.disableRAG && ...)` gates the RAG retrieval block.

**Consequence for MAIN:**
- With default `writingMode='full'`, both flag reads must derive `false` → `assemble_context` keeps the P0–P5 path, RAG stays on. **Byte-identical to today's MAIN.**
- Simple mode is exercised in Phase 1 through the ported `simple_chat_dispatch` (which is mode-agnostic-by-construction: it always uses the simple assembler + simple tools). The `generate_chapter` flag reads are a **safety belt** (a future direct `generate_chapter` call under `simple` would still skip RAG), not the primary simple path.

This is why the two engine sites get **different** wiring decisions (§3.3).

---

## 3. Mode-switch architecture

### 3.1 Single source of truth — `writingMode` in `AppConfig`

`writing_mode: 'full' | 'simple'` is added to `AppConfig` (`src-engine/domain/settings.ts`). It is persisted through the existing settings YAML round-trip (`file_settings.ts`). Default `'full'` lives **only** in `createAppConfig`. Full edit spec in §5.

Rationale for field name `writing_mode` (snake_case): every sibling field in `AppConfig` / the YAML dict is snake_case (`data_dir`, `token_count_fallback`, `chapter_metadata_display`, `token_warning_threshold`). The approved design's `writingMode:` label refers to the concept; the on-disk + interface field is `writing_mode` to match the file's established convention and the `dictToAppConfig` mapping style (single source of truth = one spelling, snake_case).

### 3.2 Flag resolver — `getSimpleFeatures(mode)` replaces the const

**New behavior of `src-engine/config/simple_features.ts`** (this file is ported from the fork, then modified — see §4.2):

- Keep `export interface SimpleFeatures { simpleAssembler; disableRAG; disableFactsExtraction; disableChapterSummary }` (all `readonly boolean`) — unchanged from fork.
- Keep `export const SIMPLE_AGENT_MAX_ITER = 5;` — unchanged from fork.
- **Replace** the const `SIMPLE_FEATURES` with a **pure resolver**:

  ```ts
  export type WritingMode = "full" | "simple";

  /** Pure derivation: mode -> the 4 simple flags. Single source of truth for the mapping.
   *  full  => every flag false (MAIN behavior, byte-identical to pre-convergence).
   *  simple => every flag true. */
  export function getSimpleFeatures(mode: WritingMode): SimpleFeatures {
    const on = mode === "simple";
    return {
      simpleAssembler: on,
      disableRAG: on,
      disableFactsExtraction: on,
      disableChapterSummary: on,
    };
  }
  ```

- **The one config-less site gets an optional param — NO module state (Rev 2).** `assemble_context` does not receive `Settings`/`AppConfig` (recon: 10 positional params). Rather than a module-level ambient setter (DS correctly flagged async race + exception-stale-state), give `assemble_context` an **optional trailing param**:

  ```ts
  // context_assembler.ts — optional + default 'full' ⇒ every existing caller and golden
  // test calls it exactly as before and gets identical behavior; only generate_chapter
  // passes a real mode. No module mutable state, no race, no cleanup.
  export async function assemble_context(
    /* …existing 10 params… */
    writingMode: WritingMode = "full",
  ): Promise<AssembleContextResult> {
    if (getSimpleFeatures(writingMode).simpleAssembler) {
      return assemble_context_simple(/* … */);
    }
    /* …unchanged P0–P5 path… */
  }
  ```

  - `WritingMode` is defined **once** in `simple_features.ts` and imported into `settings.ts` for the field type (DS confirmed **no import cycle**: `simple_features.ts` is import-free; `settings.ts` imports only `enums`/`project`). The union literal MUST NOT be spelled in two files.

**Why optional-param, not a module ambient or `AsyncLocalStorage`:** DS proposed `AsyncLocalStorage`, but the engine runs in the **WebView/browser** (Tauri/Capacitor/PWA) where `node:async_hooks` does not exist — so that is out. An **optional param defaulting to `'full'`** is strictly better than an ambient setter: it is a pure function (pass mode → assert flags), has **zero module mutable state** (DS's race + stale-on-throw concerns vanish), and — being *optional with a default* — does **not** break existing callers or golden tests (they don't pass it). This is the "clean fix" the first draft deferred; it turns out to be non-disruptive, so we do it now instead of carrying interim ambient state.

### 3.3 Per-site wiring decision

| Site | File:line (MAIN) | Flag read | Config in scope? | Decision | Implementation |
|---|---|---|---|---|---|
| Context assembler entry | `src-engine/services/context_assembler.ts` ~L398 (fork L470) | `simpleAssembler` | **No** — `assemble_context(...)` takes 10 positional params, none `Settings` | **Optional param** (Rev 2) | Add trailing `writingMode: WritingMode = "full"`; gate `if (getSimpleFeatures(writingMode).simpleAssembler)`. The simple path (`simple_chat_dispatch`) calls `assemble_context_simple` **directly**, so this branch is only a **safety belt** for a future `generate_chapter`-under-`simple` call. |
| Generation RAG block | `src-engine/services/generation.ts` ~L217 (fork L220) | `disableRAG` | **Yes** — `params.settings` in scope (`GenerateChapterParams.settings`, MAIN L141) | **Read-from-config** | Gate `!getSimpleFeatures(params.settings.app.writing_mode).disableRAG` (INSERT into the existing `if`). No new param. |

**Coupling rule:** `generate_chapter` passes its mode straight into the `assemble_context` call — the two reads stay consistent within one generation with **no shared module state**:

```ts
// generation.ts, the existing assemble_context(...) call (~L243) gains one trailing arg:
const ctx = await assemble_context(
  project, state, user_input, facts, chapter_repo, au_id, rag_text,
  character_files, worldbuilding_files, language,
  params.settings.app.writing_mode,   // ← Rev 2: the new optional arg
);
```

Because the param is **optional with a `'full'` default**, every other caller and all three `context_assembler*` golden/budget tests compile and pass **unchanged** — the first draft's worry that "widening the signature ripples to the golden tests" does **not** apply to an *optional* param. This removes the module-ambient design and the race/cleanup risk DS raised; **nothing is deferred**.

### 3.4 `disableChapterSummary` + `disableFactsExtraction` — inert placeholders (carry, don't wire)

Recon + both reviews: **both** `disableChapterSummary` **and** `disableFactsExtraction` have **no live consumer** in fork *product* code — they appear only in test mocks. They remain in `SimpleFeatures` and are set by `getSimpleFeatures` (M8 / facts-pipeline placeholders) but gate nothing in Phase 1: facts extraction lives in the separate `confirm_chapter` path that simple mode bypasses at the dispatch/UI layer, not via this flag. Do **not** invent a consumer for either, and do **not** hunt for a "missing" one (DS B4).

---

## 4. EXACT file manifest

Paths are MAIN paths. "Copy" = byte-copy the fork file to the same relative path, then apply the noted modification (if any). All transitive dependencies already exist in MAIN unless flagged.

### 4.1 New files to COPY verbatim (no modification)

| # | MAIN path | Notes / fork-specific assumptions |
|---|---|---|
| 1 | `src-engine/services/agent_loop.ts` | Generic harness `AgentLoopConfig<E>` (E = business event type). Uses `tool_stream_buffer` for accumulation; **does not execute mutating tools** (caller responsibility). Callbacks: `onTextPathTerminal`, `onForceToolPath`, `onGuardRetry`. |
| 2 | `src-engine/services/agent_telemetry.ts` | Structured sink; `consoleSink` emits to `console.info`. Multi-sink fan-out, error-isolated (fire-and-forget). 9 event kinds. |
| 3 | `src-engine/services/tool_args_repair.ts` | Order-dependent repairs (`parse_json_string_array` BEFORE `wrap_bare_to_array`). Retry hint prefix is `注意：` (not `Error:`) so the LLM keeps reasoning. Markdown-link strip is a pre-pass via `pathFields` option, not schema-aware. |
| 4 | `src-engine/services/tool_stream_buffer.ts` | Tool-call accumulation, partial JSON parsing, delta application, `extractPartialJsonStringField`. Per-iter buffer reset is the caller's job. |
| 5 | `src-engine/domain/simple_chat.ts` | `SimpleChatFile`, `SimpleChatMessageEnvelope`, `createSimpleChatFile()`, `SIMPLE_CHAT_VERSION`. |
| 6 | `src-engine/domain/simple_tools_zod.ts` | Zod schemas for the simple agent tools (`SIMPLE_TOOL_SCHEMAS`, `SIMPLE_TOOL_PATH_FIELDS`). Uses `requiredString()` helper (fork `d87162d` fix — 9 required-string fields). |
| 7 | `src-engine/repositories/interfaces/simple_chat.ts` | `SimpleChatRepository` interface (`get`, `save`, `clear`). |
| 8 | `src-engine/repositories/implementations/file_simple_chat.ts` | `FileSimpleChatRepository`; YAML at `{au_path}/.well-known/simple-chat.yaml`. `lineWidth: -1` (no wrapping). Lossy deserialize (`[key: string]: unknown`) — intentional MVP flexibility. **Errors downgrade to empty file, never throw** (chat is UX data, not critical). Depends on `file_utils` (`withWriteLock`/`joinPath`/`now_utc`/`obj_to_plain`/`validateBasePath` — all already exported in MAIN). |
| 9 | `src-engine/services/simple_chat_dispatch.ts` | Multi-turn dispatcher. **Does NOT execute mutating tools** — emits `tool_call` event → breaks → waits for caller confirm (Phase 2 UI). Auto-executes read-only `show_chapter`/`show_setting` and injects results into next iter. `suppressTokens` buffers tokens when input isn't writing-intent. Args validated via `tool_args_repair` before execution. Partial draft rescue in catch (`onPartialRescue`). Imports `assemble_context_simple`, `get_tools_for_mode`, `SIMPLE_AGENT_MAX_ITER`. |
| 10 | `src-engine/services/estimate_simple_tokens.ts` | Lightweight context-token estimation for the (Phase-2) C5 UI badge. Pure; engine-only. |

### 4.2 New files to COPY then MODIFY

| # | MAIN path | Modification |
|---|---|---|
| 11 | `src-engine/config/simple_features.ts` | Copy from fork, then **replace** the `SIMPLE_FEATURES` const with a **pure** `getSimpleFeatures(mode)` + `WritingMode` type (full code in §3.2). **Rev 2: NO module-level ambient state** — the `assemble_context` mode arrives via an optional param (§3.3), not a setter/getter. Keep `SimpleFeatures` interface and `SIMPLE_AGENT_MAX_ITER` as-is. |

### 4.3 Test files to PORT

(Strategy per file in §6.) All under MAIN paths mirroring the fork.

| # | MAIN path | Port action |
|---|---|---|
| 12 | `src-engine/services/__tests__/agent_loop.test.ts` | Copy verbatim. Helpers (`makeProvider`, `chunk`, `td`, `collect`, `collectOrError`, `buildConfig`) + `ToolBuffer` import from `tool_stream_buffer.js` come with it. No flag mock needed (harness is generic). |
| 13 | `src-engine/services/__tests__/agent_telemetry.test.ts` | Copy verbatim. No fixtures. |
| 14 | `src-engine/services/__tests__/tool_args_repair.test.ts` | Copy verbatim. |
| 15 | `src-engine/services/__tests__/tool_stream_buffer.test.ts` | Copy verbatim. |
| 16 | `src-engine/services/__tests__/simple_chat_dispatch.test.ts` | Copy, then **change flag injection**: fork does `vi.mock("../../config/simple_features.js", ... all flags false)` to neutralize, but the dispatch test actually wants **simple** behavior. Re-point the test to drive simple via the dispatcher's own params (it already injects `_provider_override`/`_tools_override`; the dispatcher uses `assemble_context_simple` directly, so no flag mock is required). Remove the `SIMPLE_FEATURES` const mock. Helpers (`makeStreamProvider`, `makeMultiIterProvider`, `makeBaseParams`, `collect`), `MockAdapter`, `FileChapterRepository`, `FileDraftRepository` come with it. |
| 17 | `src-engine/repositories/__tests__/file_simple_chat.test.ts` | Copy verbatim. Depends on `mock_adapter.ts` (already in MAIN's `repositories/__tests__/`). |
| 18 | `src-engine/services/__tests__/context_assembler_simple.test.ts` | Copy, then adapt: fork relied on the const default (`simpleAssembler=true`). In MAIN call `assemble_context(..., "simple")` (pass the new optional arg) or `assemble_context_simple(...)` directly — **no ambient setter** (Rev 2). |
| 19 | `src-engine/services/__tests__/estimate_simple_tokens.test.ts` | Copy verbatim. |
| 20 | `src-engine/domain/__tests__/settings_tools_simple.test.ts` | Copy verbatim. Asserts `get_tools_for_mode("simple")` filtering (9 effective tools; 3 disabled). |

### 4.4 Existing MAIN files to EDIT (surgical) — **SHARED FILES, serialize edits**

| # | MAIN path | Edit | Recon anchor |
|---|---|---|---|
| E1 | `src-engine/domain/settings.ts` | Add `writing_mode: 'full' \| 'simple'` to `AppConfig` interface (after `fonts`, before `schema_version`); add `writing_mode: 'full'` default in `createAppConfig`. | §5 (a)(b); MAIN L106–127 verified |
| E2 | `src-engine/repositories/implementations/file_settings.ts` | Add `writing_mode` mapping with validate/coerce-to-`'full'` in `dictToAppConfig`. | §5 (c); MAIN L246–257 verified |
| E3 | `src-engine/services/context_assembler.ts` | (a) Replace `import { SIMPLE_FEATURES }` with `import { getSimpleFeatures, type WritingMode } from "../config/simple_features.js"`. (b) **Rev 2 (ambient → optional param):** add an **optional trailing param** `writingMode: WritingMode = "full"` to `assemble_context(...)`; change the gate at ~L398 to `if (getSimpleFeatures(writingMode).simpleAssembler)`. Optional+default ⇒ existing callers and golden tests pass **unchanged**, and there is **no module-level mutable state** (kills the race/cleanup risk DS flagged). (c) **A3:** make `systemMessage?`/`userMessage?` **optional** on `AssembleContextResult`; populate them **only** inside `assemble_context_simple`; the full-mode return must **NOT add the keys at all** (not even `= undefined`) so existing deep-equal/snapshot tests stay byte-green (DS catch). (d) **Port the fork-only functions** `build_system_prompt_simple()` (fork ~L48–87) and `assemble_context_simple()` (fork ~L668–807) into this file. | flag-wiring + Claude/DS review; fork L443/L470; CC-verified |
| E4 | `src-engine/services/generation.ts` | (a) Replace `import { SIMPLE_FEATURES }` with `import { getSimpleFeatures } from "../config/simple_features.js"`. (b) **Rev 2:** pass the mode as the new optional arg of assemble_context: `assemble_context(..., params.settings.app.writing_mode)` (~L243). No setter call. (c) RAG gate (~L217, **INSERT** — MAIN has no token to "replace"): change `if (rag_text === null && vector_repo && embedding_provider)` to `if (!getSimpleFeatures(params.settings.app.writing_mode).disableRAG && rag_text === null && vector_repo && embedding_provider)`. | flag-wiring recon; fork L220/L243; CC-verified |
| E5 | `src-engine/domain/settings_tools.ts` | Insert simple tool definitions + `"simple"` branch. Add: `SIMPLE_DISABLED_TOOLS` set (fork L167–171), `_SIMPLE_AU_MODIFY_TOOLS` (fork L173–…), `_SIMPLE_VIEW_TOOLS` (fork L254–…), `_SIMPLE_REPLY_TOOL` (fork L300–…). In `get_tools_for_mode` (MAIN L232–240), insert `else if (mode === "simple") return [..._SIMPLE_AU_MODIFY_TOOLS, ..._SIMPLE_VIEW_TOOLS, _SIMPLE_REPLY_TOOL];` **before** the `else { throw }` (so `au`/`fandom`/unknown stay identical). | manifest recon "MODIFIED #2"; both bodies verified identical except the simple branch |
| E6 | `src-engine/prompts/keys.ts` | After `"CHAPTER_TITLE_PROMPT",` (MAIN L80) insert the 3 keys block (fork L82–85): `SIMPLE_SECTION_CONFIRMED_CHAPTERS`, `SIMPLE_CHAPTER_HEADER`, `SIMPLE_CHAT_SYSTEM`. | repo-and-prompts recon; both verified |
| E7 | `src-engine/prompts/zh.ts` | After `CHAPTER_TITLE_PROMPT: ...` insert the 3 prompt entries from fork `zh.ts` (`SIMPLE_SECTION_CONFIRMED_CHAPTERS`, `SIMPLE_CHAPTER_HEADER`, `SIMPLE_CHAT_SYSTEM` — fork L267–327). | repo-and-prompts recon |
| E8 | `src-engine/prompts/en.ts` | After `CHAPTER_TITLE_PROMPT: ...` insert the same 3 keys from fork `en.ts` (L277–337). **Must land in the same commit as E6/E7** or `keys.ts` validation fails on startup. | repo-and-prompts recon |
| E9 | `src-engine/repositories/interfaces/index.ts` | Add `export type { SimpleChatRepository } from "./simple_chat.js";` (after the `settings.js` export line). | repo-and-prompts recon; MAIN barrel verified |
| E10 | `src-engine/repositories/implementations/index.ts` | Add `export { FileSimpleChatRepository } from "./file_simple_chat.js";` (after `FileSettingsRepository`). | repo-and-prompts recon; MAIN barrel verified |
| E11 | `src-engine/index.ts` | Add: `export type { SimpleFeatures, WritingMode } from "./config/simple_features.js";` + `export { getSimpleFeatures } from "./config/simple_features.js";` (Rev 2: **no** ambient setter/getter to export). Add `SimpleChatRepository` to the interface re-export block and `FileSimpleChatRepository` to the implementation re-export block (mirrors fork L36 / L51). **Do NOT export a `SIMPLE_FEATURES` const** (it no longer exists). | fork `index.ts` L6–8, L36, L51 vs MAIN verified |
| E12 | `src-engine/llm/provider.ts` | **(A1 — build-critical, was wrongly listed "present")** Add the harness-required types/fields, all **optional/additive** so the full path is untouched: `Message.reasoning_content?: string`; `interface ToolCallChunkDelta {…}`; `LLMChunk.tool_call_deltas?`/`reasoning_delta?`; `export type ToolChoice = …`. **One non-additive line:** `tool_choice?: string` → `tool_choice?: ToolChoice` (verify the union is a superset of existing string callers — it is; confirm at edit). Source = exact fork↔MAIN diff. | fork provider.ts L24/L60/L75/L82/L114/L126; **CC-verified** |
| E13 | `src-engine/llm/openai_compatible.ts` | **(A2)** From the verified 69-line diff. **(a) additive:** `generateStream` extracts `tool_call_deltas`/`reasoning_delta` from `delta.tool_calls`/`delta.reasoning_content` and yields them; request body sanitizes `reasoning_content`. Without it the real provider never feeds the harness ⇒ simple-mode tool calling is **dead in production** (tests mask it via `_provider_override`). **(b) DELIBERATE full-path behavior change — the ONE documented exception to §7:** the 400 tool-incompat classifier is narrowed (over-broad `["tool","function_call","functions","not support"]` → specific phrase lists) and split into `tools_unsupported` vs `forced_tool_choice_unsupported`. Justified as a **bug fix** (old matcher misclassified `tool_call_id mismatch`-type protocol errors). Update `openai_compatible.test.ts` (fork adds a `forced_tool_choice_unsupported` case). | fork↔MAIN diff L203–243/L275/L429–475; **CC-verified** |
| E14 | `src-engine/domain/index.ts` | **(A4 — barrel)** Add SimpleChat domain re-exports: `SimpleChatFile`, `SimpleChatMessageEnvelope`, `createSimpleChatFile`, `SIMPLE_CHAT_VERSION`. Needed for `@ficforge/engine` public API (Phase 2). | Claude review A4; fork domain/index L92–93 |
| E15 | `src-engine/services/index.ts` | **(A4 — barrel)** Add simple-service re-exports: `assemble_context_simple`, the `estimate_simple_tokens` exports, the `simple_chat_dispatch` exports. (`agent_loop`/`tool_args_repair`/`tool_stream_buffer`/`agent_telemetry`/`simple_tools_zod` stay **internal** — not barrel-exported in the fork either.) | Claude review A4; services barrel diff |

> Files E3, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15 are **shared edit surfaces** — see §9 serialization rules. **E12 (`provider.ts`) is a prerequisite for every harness file and must land FIRST** (§9 Group 1), or nothing typechecks.

### 4.5 Transitive dependencies

**Confirmed present in MAIN (no action):** `repositories/interfaces/{chapter,draft}.ts`; `repositories/implementations/{file_utils,file_chapter,file_draft}.ts` (with `withWriteLock`, `joinPath`, `now_utc`, `obj_to_plain`, `validateBasePath` exported); domain `{project,state,settings,enums,chapter,draft,generated_with,budget_report,context_summary,fact,model_context_map}.ts`; `llm/config_resolver.ts` (`create_provider`, `resolve_llm_config`, `resolve_llm_params`); `tokenizer/index.ts` (`count_tokens`, `ensureTokenizer`); `prompts/index.ts` (`getPrompts`). Node `DOMException`, `js-yaml` present.

> **⚠ CORRECTION (Rev 2, was a spec error):** `llm/provider.ts` is **NOT** a no-action dep — it is **missing** `ToolChoice`/`ToolCallChunkDelta`/`reasoning_content`/`reasoning_delta`/`tool_call_deltas` and MUST be edited (**E12**). `llm/openai_compatible.ts` likewise MUST be edited (**E13**). Both CC-verified by fork↔MAIN diff.

> **Pre-flight (blocking, S0.1):** **`zod` is ABSENT from MAIN `src-engine/package.json`** (verified — only `gray-matter`, `js-yaml`). Add **`zod@^4.4.3`** — **v4 specifically**, not "any zod": `tool_args_repair.ts` reads zod-v4 issue semantics (`issue.received`/`expected`); zod 3 silently breaks the repair pipeline.

### 4.6 No deletions / renames

Phase 1 deletes nothing and renames nothing. The only "removal" is the `SIMPLE_FEATURES` **const** being replaced by `getSimpleFeatures` **within** `simple_features.ts` (and its export removed from `index.ts`).

---

## 5. Settings edit spec (verbatim from recon, MAIN-adjusted)

All three edits are in two files, line numbers verified against MAIN this session.

### (a) `AppConfig` interface — `src-engine/domain/settings.ts` (L106–114)

Insert `writing_mode` between `fonts` and `schema_version`:

```ts
export interface AppConfig {
  language: string;
  data_dir: string;
  token_count_fallback: string;
  token_warning_threshold: number;
  chapter_metadata_display: ChapterMetadataDisplay;
  fonts: FontsConfig;
  writing_mode: WritingMode;   // 'full' | 'simple'; imported from config/simple_features
  schema_version: string;
}
```

> Use the shared `WritingMode` type (import from `../config/simple_features.js`) rather than re-spelling the union literal, to keep the mode domain single-sourced. If an import cycle is a concern (`settings.ts` ↔ `simple_features.ts`), inline `'full' | 'simple'` here **and** add a `// keep in sync with WritingMode` comment — but prefer the import; there is no cycle today (`simple_features.ts` does not import `settings.ts`).

### (b) `createAppConfig` default — `src-engine/domain/settings.ts` (L116–127)

```ts
export function createAppConfig(partial?: Partial<AppConfig>): AppConfig {
  return {
    language: "zh",
    data_dir: "./fandoms",
    token_count_fallback: "char_mul1.5",
    token_warning_threshold: 32000,
    chapter_metadata_display: createChapterMetadataDisplay(),
    fonts: createFontsConfig(),
    writing_mode: "full",
    schema_version: "1.0.0",
    ...partial,
  };
}
```

> This is the **only** place the default `'full'` literal appears in product code.

### (c) `dictToAppConfig` mapping — `src-engine/repositories/implementations/file_settings.ts` (L246–257)

```ts
function dictToAppConfig(d: Record<string, unknown> | null): AppConfig {
  if (!d) return createAppConfig();
  const writingModeRaw = d.writing_mode as string | undefined;
  const writingMode = (writingModeRaw === "full" || writingModeRaw === "simple")
    ? writingModeRaw
    : "full";
  return createAppConfig({
    language: (d.language as string) ?? "zh",
    data_dir: (d.data_dir as string) ?? "./fandoms",
    token_count_fallback: (d.token_count_fallback as string) ?? "char_mul1.5",
    token_warning_threshold: (d.token_warning_threshold as number) ?? 32000,
    chapter_metadata_display: dictToChapterMetadataDisplay(d.chapter_metadata_display as Record<string, unknown> | null),
    fonts: dictToFontsConfig(d.fonts as Record<string, unknown> | null),
    writing_mode: writingMode,
    schema_version: (d.schema_version as string) ?? "1.0.0",
  });
}
```

> Mirrors the `dictToFontsConfig` legacy-migration style (separate variable, ternary coercion). Invalid/missing → `'full'`, never throws. **Backward compatible:** old YAML without `writing_mode` loads as `'full'`.

### (d) Round-trip + degradation tests — `src-engine/repositories/__tests__/file_settings.test.ts` (add after the fonts test block, ~after L223)

Three new `it(...)` cases (recon-supplied; reproduce verbatim):

1. **round-trip `'full'` → `'simple'` → reload** asserts default `'full'`, then `save({writing_mode:'simple'})`, reload, expect `'simple'`.
2. **missing field → `'full'`** (legacy YAML with no `writing_mode`).
3. **invalid value (`"invalid"`) → `'full'`** (no throw).

> These are the **round-trip closure proof** the project's bug methodology requires (write path ↔ read path symmetry for the new field).

---

## 6. Test plan

### 6.1 PORT (fork → MAIN) — harness + dispatch + simple-domain tests

Files #12–#20 in §4.3. Key adaptations:

- **agent_loop / agent_telemetry / tool_args_repair / tool_stream_buffer / file_simple_chat / estimate_simple_tokens / settings_tools_simple:** copy verbatim. No flag-injection concerns (generic harness or simple-tool-list filtering, which is mode-independent at the schema layer).
- **simple_chat_dispatch.test.ts:** remove the `vi.mock("../../config/simple_features.js")` const mock. The dispatcher reaches the simple assembler **directly** and takes `_provider_override`/`_tools_override`, so simple behavior needs no flag forcing. Covers: text path, tool streaming, multi-tool assembly, mid-stream throw → partial rescue, double-emit text+tools, protocol exceptions (`EMPTY_RESPONSE`, `DECLARED_TOOLS_BUT_EMPTY`), agent-loop cases 1–10 (show_chapter, create_character_file, max_iter, batch retry, `reasoning_content` passthrough, mutating-tool single-round).
- **context_assembler_simple.test.ts:** the fork relied on the const default; in MAIN call `assemble_context(..., "simple")` (pass the new optional param explicitly) or call `assemble_context_simple(...)` directly. **No ambient setter** (Rev 2). Asserts the full-text simple path (system message carries all worldbuilding + characters + chapters; minimal user instruction).

### 6.2 KEEP-GREEN (MAIN full-mode tests, must stay byte-identical under `full`)

These already exist in MAIN and must **not** change their assertions. Today they pass with no flag mock (MAIN has no `SIMPLE_FEATURES`). After convergence, the new default `writing_mode='full'` makes `getSimpleFeatures('full')` return all-false → `assemble_context` keeps P0–P5, RAG stays on → **assertions unchanged**.

- `src-engine/services/__tests__/context_assembler.test.ts` — layered-prompt assertions.
- `src-engine/services/__tests__/context_assembler.budget.test.ts` — 128k budget gain, 8k non-regression, `OUTPUT_RESERVE_CEIL=15000`, 32k gain.
- `src-engine/services/__tests__/context_assembler_golden.test.ts` — 5 golden scenarios within ±2 tokens; `fixtures/context_golden.json` stays byte-identical (no regeneration).
- `src-ui/src/api/__tests__/engine-chapters.test.ts` — RAG index status READY/STALE (flag-adjacent but independent; no change).

**Mechanism note (important divergence from one recon report):** Recon "tests" proposed mocking a `config_resolver.resolve_writing_mode()`. **This spec does NOT introduce that.** The mode resolver is the pure `getSimpleFeatures` in `simple_features.ts`. MAIN keep-green tests need **no mock at all** — the new field defaults to `'full'` and they don't set it. Where a test must *force* a path it **passes the `writingMode` arg** to `assemble_context` (assembler) or constructs `Settings` with `app.writing_mode` (generation) — **never a module setter** (Rev 2 removed ambient). **Do not add a mock to a test that currently passes without one** — that is itself churn and can mask a regression.

### 6.3 NEW — prove `writingMode='simple'` and `'full'`-default behavior

1. **`context_assembler_simple.test.ts`** (ported, §6.1) doubles as the "simple routes to simple assembler" proof — via the explicit `writingMode="simple"` arg.
2. **`generation` simple-mode RAG-skip** — new test (e.g. extend or add `generation_simple_mode.test.ts`): build `Settings` with `app.writing_mode='simple'`, `state.index_status=STALE`, spy on `vector_repo.search`; assert it is **never called** (`disableRAG` derived true), draft written from LLM text only.
3. **`generation` full-default still RAGs** — `app.writing_mode='full'` (or default), `index_status=READY`; assert `vector_repo.search` **is** called and budget breakdown (`p1..p5`) present.
4. **`getSimpleFeatures` unit test** — new tiny test `src-engine/config/__tests__/simple_features.test.ts`: `getSimpleFeatures('full')` → all four false; `getSimpleFeatures('simple')` → all four true. (Pure fn; no ambient to test.) Replaces the fork's `feature_flags.test.ts` (which asserted the const's locked-true values — premise gone); **port its intent, not its body**.
5. **`dictToAppConfig` round-trip** — the 3 cases in §5(d).

> The fork's `feature_flags.test.ts` (asserts `SIMPLE_FEATURES.* === true`) is **intentionally not ported as-is** — its subject no longer exists. Its replacement is item 4.

---

## 7. Zero-churn regression red-line

**Invariant:** With `writing_mode='full'` (the default, applied whenever the field is absent), MAIN engine behavior is **byte-identical** to pre-convergence MAIN.

Concrete red-lines the implementation MUST satisfy:

1. `getSimpleFeatures('full')` returns `{ simpleAssembler:false, disableRAG:false, disableFactsExtraction:false, disableChapterSummary:false }`. Any other value is a bug.
2. `assemble_context`'s new `writingMode` param **defaults to `'full'`**; only `generate_chapter` ever passes it (the persisted mode). **No module-level state exists** to leak between calls (Rev 2 removed ambient).
3. `context_assembler.ts` full path (`assemble_context` with `writingMode='full'`) is **unchanged** — same P0–P5 logic, same return-object **shape** (full path adds **neither** `systemMessage` nor `userMessage` key — A3), same `budget_report`/`context_summary`. The only diffs: gate source (const → `getSimpleFeatures(writingMode)`) and one new **optional** trailing param. Golden fixture untouched.
4. `generation.ts` RAG block runs identically under `full` — same query build, same `retrieve_rag` call, same decay coefficient.
5. `get_tools_for_mode("au")` and `("fandom")` return **identical arrays** to today (the simple branch is inserted **before** the throw, never altering existing branches). `("unknown")` still throws the same message.
6. `dictToAppConfig` on any pre-existing YAML produces an `AppConfig` identical to today **plus** `writing_mode:'full'` — no other field changes.
7. **Zero-churn is defined as: existing behavior/output unchanged — NOT "no test file ever changes" (DS A5).** The four `context_assembler*`/`generation` golden/budget tests pass **unmodified, no added mock**. **Two legitimately-changing tests are NOT violations** — they assert *counts of newly-added artifacts*, not behavior: (i) `prompts/__tests__/prompts.test.ts:60` `REQUIRED_KEYS.length` **55 → 58** (3 new keys = expected evolution; per-new-key placeholder parity must hold across zh/en); (ii) `llm/__tests__/openai_compatible.test.ts` gains a `forced_tool_choice_unsupported` case for the deliberate **E13(b)** classifier change. Both are in the manifest (S3.4 group / E13).

**Verification gate (run before declaring Phase 1 done):**
- `npm test` (or project test runner) in `src-engine` — full suite green, **0 regressions**, new + ported tests included.
- `tsc --noEmit` (engine) — clean (catches any missed `SIMPLE_FEATURES` const import).
- Grep proof: **zero** references to the const `SIMPLE_FEATURES` **and zero** to `setAmbientWritingMode`/`getAmbientWritingMode` anywhere (Rev 2 removed ambient). Allowed: `getSimpleFeatures`, the `SimpleFeatures` type, `WritingMode`.

---

## 8. Edge cases & error handling (part of the deliverable)

1. **Invalid persisted mode** (`writing_mode: "weird"` in YAML): coerced to `'full'` in `dictToAppConfig`, never throws (§5c, tested §5d-3).
2. **Agent max iterations:** `simple_chat_dispatch` emits an `AGENT_MAX_ITERATIONS` error event when iterations exceed `SIMPLE_AGENT_MAX_ITER` (=5) without reaching a terminal (chat_reply / chapter text / mutating-tool confirm pending). User-facing instruction: split the request. (Ported behavior; covered by dispatch test "max_iter".)
3. **Partial rescue:** if the LLM throws mid-stream after emitting draft tokens, the catch handler fires `onPartialRescue` so the partial draft is preserved rather than lost. (Ported; dispatch test "partial rescue on mid-stream throw".)
4. **Runtime mode switch semantics:** changing `writing_mode` (by writing settings) applies to the **next** operation only. **Never retroactive** (in-flight generations keep their mode — `generate_chapter` snapshots `params.settings` and passes that mode into `assemble_context` as an arg; no shared state to flip mid-call) and **never mutates already-persisted data** (chapters/drafts/facts untouched by a mode flip).
5. **Corrupted/missing simple-chat YAML:** `FileSimpleChatRepository` downgrades to an empty `SimpleChatFile`, never throws (chat is UX data). (Ported; `file_simple_chat.test.ts`.)
6. **Mutating tools are never auto-executed** in Phase 1: `simple_chat_dispatch` emits the `tool_call` and breaks, awaiting a confirm callback that **only Phase 2 UI provides**. In Phase 1, with no UI, a mutating tool simply surfaces as a pending event in tests/headless callers — it does not write data. This is correct and intended.
7. **Read-only tools auto-execute** (`show_chapter`, `show_setting`) and inject results into the next iteration — bounded by `SIMPLE_AGENT_MAX_ITER`.
8. **Prompt key validation:** `keys.ts` validates that `zh.ts` and `en.ts` both define every `REQUIRED_KEYS` entry at startup. E6/E7/E8 MUST land atomically — adding a key to `keys.ts` without both language entries crashes startup. (Serialization rule, §9.)
9. **`zod` missing in MAIN:** pre-flight (§4.5) — add to `package.json` if absent before porting `simple_tools_zod.ts`.

---

## 9. Ordered implementation steps (for the execution workflow)

Legend: **[P]** = can run in parallel with other [P] steps in the same group (independent files); **[S]** = serialized (touches a shared/critical file or has an ordering dependency). Shared-file edits are explicitly serialized to avoid merge clobbering.

### Group 0 — Pre-flight (sequential, blocking)

- **S0.1** Confirm `zod` is a MAIN dependency (`package.json`); add if missing.
- **S0.2** Confirm target branch is checked out (human-specified; do not create/switch without instruction). Verify clean tree.
- **S0.3** (DS-flagged scans) (a) grep MAIN for any **separate settings-schema validator** (e.g. a zod schema over `AppConfig`) that would reject an unknown/missing `writing_mode`; `dictToAppConfig` coerces missing→`'full'`, but a second validation layer (if any) must accept the field. (b) Confirm no ported file adds a **side-effect import** (`import "./x"` with no bindings) that runs on MAIN's full path. (c) Confirm no fork `*.d.ts` ambient type augmentation is required by the ported files.

### Group 1 — Mode foundation (mostly sequential; this is the keystone)

- **S1.0** (NEW — FIRST) Edit `src-engine/llm/provider.ts` (**E12**): add `ToolChoice` / `ToolCallChunkDelta` / `reasoning_content?` / `reasoning_delta?` / `tool_call_deltas?` + `tool_choice: ToolChoice`. **Every harness file imports these — must land before Group 2 or nothing typechecks.** Then `src-engine/llm/openai_compatible.ts` (**E13**: additive stream-delta emission + the documented 400-classifier change + its test).
- **S1.1** Port + modify `src-engine/config/simple_features.ts` → **pure** `getSimpleFeatures` + `WritingMode` type; remove const; **NO ambient setter/getter** (Rev 2). *(Everything downstream imports this.)*
- **S1.2** Edit `src-engine/domain/settings.ts` (E1): add `writing_mode` to interface + `createAppConfig`. *(Depends on S1.1 for the `WritingMode` type import.)*
- **S1.3** Edit `src-engine/repositories/implementations/file_settings.ts` (E2): `dictToAppConfig` mapping. *(Depends on S1.2.)*
- **P1.4** Add round-trip tests to `file_settings.test.ts` (§5d). *(Can be written in parallel with S1.5+ once S1.3 lands.)*
- **P1.5** Add `src-engine/config/__tests__/simple_features.test.ts` (§6.3-4). *(Parallel; depends only on S1.1.)*

### Group 2 — Additive new files, no shared-file contention (parallel)

All of these are **new files** at new paths → fully parallel. They depend on S1.1 (for `getSimpleFeatures`/`SIMPLE_AGENT_MAX_ITER` imports) and on transitive deps already in MAIN.

- **P2.1** `agent_telemetry.ts` (+ `__tests__/agent_telemetry.test.ts`)
- **P2.2** `tool_stream_buffer.ts` (+ test)
- **P2.3** `tool_args_repair.ts` (+ test)
- **P2.4** `agent_loop.ts` (+ test) — depends on P2.2 (`tool_stream_buffer`)
- **P2.5** `domain/simple_chat.ts`
- **P2.6** `domain/simple_tools_zod.ts` (needs `zod`, S0.1)
- **P2.7** `repositories/interfaces/simple_chat.ts`
- **P2.8** `repositories/implementations/file_simple_chat.ts` (+ test) — depends on P2.5, P2.7
- **P2.9** `services/estimate_simple_tokens.ts` (+ test)

### Group 3 — Shared-file edits (SERIALIZE within each file; files independent of each other can run parallel)

These touch existing MAIN files. **Edits to the *same* file must be applied by one agent in sequence.** Different files in this group are independent and may parallelize.

- **S3.1** `context_assembler.ts` (E3): import swap + **add optional `writingMode='full'` param** + gate via `getSimpleFeatures(writingMode)` + make `AssembleContextResult.systemMessage?/userMessage?` optional (full path adds **neither** key) + **port** `build_system_prompt_simple` & `assemble_context_simple`. *(Single agent owns this whole file. Depends on S1.1.)*
- **S3.2** `generation.ts` (E4): import swap + pass `params.settings.app.writing_mode` as the new trailing arg to `assemble_context` + RAG gate via config. *(Single agent; depends on S1.1, S3.1.)*
- **S3.3** `settings_tools.ts` (E5): insert 4 simple tool consts + `"simple"` branch before the throw. *(Single agent; independent file.)*
- **S3.4** Prompt trio + its count test — **one atomic unit** (E6+E7+E8 **+ `prompts/__tests__/prompts.test.ts` 55→58**): `keys.ts` + `zh.ts` + `en.ts` together, plus bumping the `REQUIRED_KEYS.length` assertion. *(One agent, one commit; `keys.ts`'s `PromptModule = Record<PromptKey,string>` type `tsc`-couples the two languages — a key missing from either is a compile error. Independent of S3.1–S3.3.)*

### Group 4 — Barrel exports (SERIALIZE per file)

- **S4.0** (NEW) `domain/index.ts` (**E14**): add SimpleChat domain re-exports. `services/index.ts` (**E15**): add `assemble_context_simple` / `estimate_simple_tokens` / `simple_chat_dispatch` re-exports. *(Depends on the corresponding new files + S3.1 for `assemble_context_simple`.)*
- **S4.1** `repositories/interfaces/index.ts` (E9): add `SimpleChatRepository`. *(Depends on P2.7.)*
- **S4.2** `repositories/implementations/index.ts` (E10): add `FileSimpleChatRepository`. *(Depends on P2.8.)*
- **S4.3** `src-engine/index.ts` (E11): add `SimpleFeatures`/`WritingMode` types + `getSimpleFeatures` (**no** ambient exports), `SimpleChatRepository`, `FileSimpleChatRepository`; ensure **no** `SIMPLE_FEATURES` const export. *(Depends on S1.1, S4.0, S4.1, S4.2.)*

### Group 5 — Service that ties it together + its test (sequential after 2/3/4)

- **S5.1** `services/simple_chat_dispatch.ts` — depends on S3.1 (`assemble_context_simple` now in `context_assembler.ts`), S3.3 (`get_tools_for_mode("simple")`), P2.x harness files, S1.1 (`SIMPLE_AGENT_MAX_ITER`).
- **S5.2** Port `__tests__/simple_chat_dispatch.test.ts` (§6.1 adaptation: drop const mock).
- **P5.3** Port `__tests__/context_assembler_simple.test.ts` (pass `writingMode="simple"` arg — Rev 2, not ambient) — parallel with S5.2.
- **P5.4** Port `__tests__/settings_tools_simple.test.ts` — parallel.
- **P5.5** Add new generation simple-mode tests (§6.3-2, §6.3-3) — parallel.

### Group 6 — Verification gate (sequential, blocking, do not skip)

- **S6.1** `tsc --noEmit` on `src-engine` — clean. (Catches any missed `SIMPLE_FEATURES` const import.) Then `tsc --noEmit` on `src-ui` as a sanity check: the engine's public-API change is **additive-only** (new `getSimpleFeatures`/`WritingMode`/repo exports; nothing MAIN's untouched `src-ui` already consumes is removed or re-signatured), so `src-ui` MUST still typecheck green with zero `src-ui` edits. A `src-ui` type error = an accidental non-additive change → stop and investigate.
- **S6.2** Full `src-engine` test suite — green, 0 regressions, new + ported tests included.
- **S6.3** Grep red-line: no product-code references to the **const** `SIMPLE_FEATURES` (type `SimpleFeatures` and fn `getSimpleFeatures` OK).
- **S6.4** Confirm keep-green tests (`context_assembler*`, `generation`, `engine-chapters`) pass **unmodified**. If any required editing, that is a zero-churn violation — stop and investigate.
- **S6.5** Output `git diff --stat`; **stop and await human** ("提交"/"合并") per CLAUDE.md. Do not commit/push/merge autonomously.

**Parallelism summary:** Group 2 (9 new-file tasks) is the big parallel win. Groups 1, 5, 6 are sequential keystones. Group 3's four units are mutually parallel but each is internally serialized (one agent per shared file); the prompt trio S3.4 is itself an atomic 3-file unit. Group 4 barrels are quick but ordered after their targets exist.

---

## 10. Open questions / risks surfaced by recon

1. **`zod` dependency in MAIN** — the only transitive dep not guaranteed present (fork added it for `simple_tools_zod.ts`). Pre-flight S0.1 resolves it; low risk (standard dep) but must be checked, not assumed.
2. **Recon "tests" report proposed a `config_resolver.resolve_writing_mode()` mock seam that this spec deliberately rejects** in favor of the pure `getSimpleFeatures` in `simple_features.ts`. Rationale: keeps the mode domain in one module and lets MAIN's keep-green tests pass with **zero** added mocks. Implementation MUST follow this spec, not that recon detail.
3. **(RESOLVED in Rev 2 — was the ambient-state concern.)** DS flagged the original module-level ambient setter for async-race + exception-stale-state. **Resolved** by giving `assemble_context` an **optional `writingMode='full'` param** (§3.2/§3.3): pure, no module state, and — being optional+default — it does **not** break existing callers or golden tests, so nothing is deferred. DS's `AsyncLocalStorage` alternative was rejected (engine runs in WebView; `node:async_hooks` unavailable). The `assemble_context` doc-comment should note the param defaults to `'full'` and that `simple_chat_dispatch` calls `assemble_context_simple` directly.
4. **Prompt trio atomicity** — `keys.ts` startup validation hard-couples E6/E7/E8. If split across commits/agents, startup crashes. Enforced as the atomic unit S3.4.
5. **Fork's `feature_flags.test.ts` premise is obsolete** (it asserts the const is locked-true). Not ported as-is; replaced by the `getSimpleFeatures` unit test (§6.3-4). Anyone diffing fork↔main test counts should expect this one substitution, not a missing test.
