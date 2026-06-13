# Phase 2 Design Spec — Wire the simple-mode UI into MAIN (UI layer)

**Date:** 2026-06-13
**Status:** Design — ready for plan/implementation
**Scope owner:** CC
**Source fork:** `D:\fanfic-system-simple` (branch `feat/agent-harness-v1`) — UI layer
**Target:** `D:\fanfic-system` (branch `feat/converge-simple-phase2`)
**Predecessor:** Phase 1 (engine convergence) — merged to `main` (commit `942913c` + `b3281af`). Spec: `2026-06-02-converge-simple-into-main-phase1-design.md`.

---

## 1. Overview & Scope

### 1.1 Goal

Phase 1 brought the simple-mode **engine** into MAIN behind `AppConfig.writing_mode` (`'full' | 'simple'`, default `'full'`), but the mode is only switchable programmatically. Phase 2 brings the **UI** so an end user can pick simple mode in settings and actually use the chat-driven writing experience — while full mode stays the default and byte-identical to today.

### 1.2 Product decisions (settled with PM, 2026-06-13)

- **Positioning: peer preference.** Simple and full are equal, user-toggled modes. **Both fully preserved — no feature hiding.** Full stays the default. → Port the fork's already-validated UX **as-is**; do not redesign, do not strip facts/lore from simple mode.
- **Switch semantics: takes effect on next AU entry.** Changing `writing_mode` while an AU is open must **not** disrupt the open AU. The new mode applies the next time the user enters an AU. → Read the mode **fresh** at landing/navigation time, but **snapshot it at AU-workspace mount** so the open workspace never flips mid-session.

### 1.3 In scope (Phase 2)

- A runtime mode accessor: `WritingModeProvider` (App-level) + `useWritingMode()` hook (single source for "is the app currently in simple mode").
- Port the fork's `src-ui/src/ui/simple/` tree + 3 API wrappers (`engine-simple-dispatch`, `engine-simple-chat`, `engine-tokens`) + `engine-client` barrel exports.
- Register `FileSimpleChatRepository` in `engine-instance.ts` (the Phase-1 wiring gap; currently `repos.simpleChat` does not exist → the ported API throws).
- Convert the fork's **compile-time** `SIMPLE_FEATURES.simpleAssembler` gating to **runtime** `writing_mode` reads in `AuWorkspaceLayout`, `MobileLayout`, `BottomNavBar`, `landing.ts`, and `App.tsx`.
- A `writing_mode` toggle in `GlobalSettingsModal` + the `saveAppPreferences` round-trip fix.
- `simple.*` i18n namespace into `zh.json` + `en.json`.
- Tests: port the fork's `ui/simple` tests; add `useWritingMode` + `saveAppPreferences` round-trip tests; keep full-mode tests green and unmodified.

### 1.4 Out of scope (explicit)

- No engine changes (Phase 1 is done; engine API is additive-complete). If a missing engine export surfaces during the port, that is a Phase-1 follow-up, not a Phase-2 redesign.
- No data migration between modes — **TD-015** (simple↔full import/export) stays a separate, event-driven debt.
- No new visual design — this is a faithful port of the fork's UX, not a redesign.
- No making simple the default, no per-AU mode (the field is app-global by Phase-1 design), no onboarding mode-picker.

### 1.5 Code principles honored

- **Single source of truth:** "is simple mode on" is computed in exactly one place (`useWritingMode`/`getSimpleFeatures`), never re-derived ad hoc. The fork's module-scope `SIMPLE_FEATURES.simpleAssembler` reads collapse to one hook.
- **Zero-churn under full:** every full-mode code path and test stays byte-identical (§9).
- **Round-trip closure:** the new `writing_mode` settings field must prove write↔read symmetry (save → yaml.dump → yaml.load → `dictToAppConfig` → UI) with a test — per the project's data-chain bug methodology.
- **Low coupling:** landing/tab decisions read a single hook, not threaded props through ~8 components.

---

## 2. Runtime gating architecture

The fork gates simple UI on a **compile-time** const (`SIMPLE_FEATURES.simpleAssembler`, imported from `@ficforge/engine`). That const no longer exists in MAIN (Phase 1 replaced it with the pure `getSimpleFeatures(mode)` + `WritingMode`/`WRITING_MODES`/`isWritingMode`). MAIN must read the **runtime** `app.writing_mode`.

### 2.1 `WritingModeProvider` + `useWritingMode()` (NEW)

A small App-level context (new file, e.g. `src-ui/src/hooks/useWritingMode.tsx`):

- On mount, loads `app.writing_mode` once via a dedicated `getWritingMode()` read added to `engine-settings.ts` (E4) — single-purpose, avoids coupling the provider to the broader settings summary; do **not** invent a second settings-load path.
- Exposes `{ mode: WritingMode; isSimple: boolean; refresh: () => Promise<void> }`.
- `refresh()` is called after the settings toggle saves, so subsequent **landing** decisions use the fresh value without an app reload.
- Default while loading: `'full'` (zero-churn — never briefly show simple chrome to a full user).

> **Why a context, not prop-threading:** landing decisions happen at ≥3 sites *outside* the workspace (open AU, create AU, mobile entry) plus the workspace tabs — a single context read keeps it DRY and avoids async reads inside navigation handlers. Prop-threading the mode through Library → workspace → mobile was considered and rejected (more wiring, no benefit).

### 2.2 Snapshot-at-mount (the "next AU entry" semantics)

- **Landing sites read the live value** (`useWritingMode().mode`) → a just-changed mode applies on the next AU you open.
- **`AuWorkspaceLayout` snapshots the value at mount** into local state and uses the snapshot for tabs/content. Because the AU workspace unmounts when you return to the Library and remounts on re-entry, the snapshot is naturally re-read **once per AU entry** — and a mid-session toggle (the in-AU settings tab can open `GlobalSettingsModal`, [AuSettingsLayout.tsx:446](../../src-ui/src/ui/settings/AuSettingsLayout.tsx)) never flips the open work.

This is the entire mechanism — no engine state, no global mutable flag, no reactive re-render of an open AU.

---

## 3. UI coexistence (desktop + mobile)

The fork's `AuWorkspaceLayout.tsx` is **already coexistence-shaped** — it is MAIN's layout plus three `SIMPLE_FEATURES`-gated spots. Porting = take the fork's structure and replace the const reads with the snapshot boolean (`isSimple`).

### 3.1 Desktop — `AuWorkspaceLayout.tsx`

When `isSimple`:
1. **Prepend a `chat` tab** (label `simple.tabs.chat`, "对话") before the writer tab.
2. **Relabel** the writer tab 续写 → **阅读** (`simple.tabs.reading`).
3. **Swap content**: `activeTab === 'writer'` renders the read-only `SimpleReadingView` instead of `WriterLayout`; `activeTab === 'chat'` renders `SimpleChatPanel`.
4. **facts / au_lore / settings tabs unchanged.**

When `!isSimple` (full, default): exactly today — no chat tab, writer = `WriterLayout`, byte-identical.

### 3.2 Mobile — `MobileLayout.tsx` + `BottomNavBar.tsx`

Same conditional: when `isSimple`, add the chat slot/tab and route the reading view; otherwise unchanged. The mobile entry navigation (`onNavigate("writer", auPath)` at [MobileLayout.tsx:87/122/127](../../src-ui/src/ui/mobile/MobileLayout.tsx)) becomes `onNavigate(getAuLandingPage(mode), auPath)`.

### 3.3 Routing — `App.tsx`

- `isAuSpace` array ([App.tsx:215](../../src-ui/src/App.tsx)) currently `["writer","facts","au_lore","settings"]` → **add `"chat"`** so the chat page is recognized as AU space.
- Wrap the top-level rendered tree in `App.tsx` in `WritingModeProvider` (covers Library landing + AU workspace + mobile) so `useWritingMode` is available at all landing/tab sites.

### 3.4 Landing — `ui/simple/landing.ts` (PORT + MODIFY)

The fork's `getAuLandingPage()` reads the const. Port it as a **pure function taking the mode**:

```ts
export type AuLandingPage = "chat" | "writer";
export function getAuLandingPage(mode: WritingMode): AuLandingPage {
  return getSimpleFeatures(mode).simpleAssembler ? "chat" : "writer";
}
```

Call sites that hardcode `'writer'` and must pass the live mode:
- Open AU — [Library.tsx:71](../../src-ui/src/ui/Library.tsx)
- Create AU — [useLibraryMutations.ts:92](../../src-ui/src/ui/library/useLibraryMutations.ts)
- Mobile entry — [MobileLayout.tsx](../../src-ui/src/ui/mobile/MobileLayout.tsx)
- The two **in-workspace** `onNavigate('writer', …)` sites ([AuWorkspaceLayout.tsx:298/322](../../src-ui/src/ui/workspace/AuWorkspaceLayout.tsx)) use the workspace **snapshot** mode (they fire from inside the already-mounted workspace).

---

## 4. Settings toggle + round-trip

### 4.1 Toggle UI — `GlobalSettingsModal.tsx`

Add a `writing_mode` `<select>` (options full/simple) modeled on the existing **language** select ([GlobalSettingsModal.tsx:343–355](../../src-ui/src/ui/settings/GlobalSettingsModal.tsx)), which is a **save-on-change** field (not gated behind the modal's main Save button). On change:
1. `await saveAppPreferences({ writing_mode: next })`
2. `await useWritingMode().refresh()` (so landing uses the new value immediately)
3. surface errors via the existing `showError` + a short helper text explaining the switch applies on next AU entry.

Options/labels from `WRITING_MODES` (engine-exported) + `simple.settings.*` i18n keys. Placement: in the app-preferences group beside language/fonts (it is app-global, not per-AU → **GlobalSettingsModal, not AuSettingsLayout**).

### 4.2 Persistence round-trip — `saveAppPreferences` + `AppPreferencesInput`

`saveAppPreferences` ([engine-settings.ts:222–230](../../src-ui/src/api/engine-settings.ts)) today **silently persists only `language`** — a `writing_mode` field would be dropped (the project's "new field silently discarded" trap). Fix:

- Extend `AppPreferencesInput` ([api/settings.ts:91](../../src-ui/src/api/settings.ts)) with `writing_mode?: WritingMode`.
- In `saveAppPreferences`, persist it with validation:
  ```ts
  current.app = {
    ...current.app,
    ...(payload.language ? { language: payload.language as Settings["app"]["language"] } : {}),
    ...(payload.writing_mode && isWritingMode(payload.writing_mode)
        ? { writing_mode: payload.writing_mode } : {}),
  };
  ```
  (`current.app` is spread first, so fonts and other app fields are preserved — no shallow-merge field loss.)
- The read path already closes the loop: Phase 1's `dictToAppConfig` maps `writing_mode` (invalid/missing → `'full'`). So write (`saveAppPreferences` → `withSettingsWrite` → `settings.save` → yaml.dump) ↔ read (`settings.get` → yaml.load → `dictToAppConfig`) is symmetric **once this field is set**.

### 4.3 Round-trip test (required)

New test asserting: save `{writing_mode:'simple'}` → reload settings → `app.writing_mode === 'simple'`; default/absent → `'full'`. This is the write↔read closure proof the bug methodology mandates for a new persisted field. (Engine-side `dictToAppConfig` coercion is already covered by Phase 1's `file_settings.test.ts`; this test covers the **UI→engine** wrapper.)

---

## 5. Exact file manifest

### 5.1 New files — PORT VERBATIM from fork (mode-agnostic; rendered only when simple)

All under `src-ui/src/`. Verify during port that **none** import the dead `SIMPLE_FEATURES` const (these render inside simple mode, so they shouldn't gate on it — confirm).

| Area | Files |
|---|---|
| Chat UI | `ui/simple/SimpleChatPanel.tsx`, `SimpleChatHistory.tsx`, `SimpleChatInput.tsx`, `SimpleReadingView.tsx`, `SimpleSettingsDrawer.tsx` |
| Message cards | `ui/simple/messages/{AssistantMessage,ChapterPreviewCard,SettingPreviewCard,SystemMessage,ToolCallCard,UserMessage,WritingDraftCard}.tsx` |
| Hooks | `ui/simple/{useSimpleChat,useSimpleDispatch,useSimpleToolExecutor,useContextTokenCount}.ts` |
| Glue | `ui/simple/chat-to-llm.ts`, `ui/simple/types.ts` |
| API wrappers | `api/engine-simple-dispatch.ts`, `api/engine-simple-chat.ts`, `api/engine-tokens.ts` |
| Tests | `ui/simple/__tests__/*` (7 files) |

### 5.2 New file — PORT + MODIFY

| File | Modification |
|---|---|
| `ui/simple/landing.ts` | Drop `import { SIMPLE_FEATURES }`; make `getAuLandingPage(mode: WritingMode)` a pure fn over `getSimpleFeatures(mode)` (§3.4). |

### 5.3 New file — NET-NEW (MAIN-only)

| File | Purpose |
|---|---|
| `hooks/useWritingMode.tsx` | `WritingModeProvider` + `useWritingMode()` (§2). |

### 5.4 Existing MAIN files — EDIT (surgical)

| # | File | Edit |
|---|---|---|
| E1 | `api/engine-instance.ts` | Add `FileSimpleChatRepository` import; add `simpleChat: FileSimpleChatRepository` to `EngineInstance.repos` (L37–46) + `simpleChat: new FileSimpleChatRepository(adapter)` to `initEngine` (L62–71). **Must land first — the ported API throws without it.** Confirm the constructor signature `(adapter)` against the engine export. |
| E2 | `api/engine-client.ts` | Re-export the 3 wrappers' functions/types (`dispatchSimpleChat`, `getSimpleChat`/`saveSimpleChat`/`clearSimpleChat`, `estimateSimpleContextTokens`) + any simple types the UI imports through the barrel. (Components may import `Message` and simple types straight from `@ficforge/engine`; verify.) |
| E3 | `api/settings.ts` | `AppPreferencesInput += writing_mode?: WritingMode`. |
| E4 | `api/engine-settings.ts` | `saveAppPreferences` persists `writing_mode` with `isWritingMode` guard (§4.2). Add a `getWritingMode()` read helper for the provider (§2.1). |
| E5 | `ui/settings/GlobalSettingsModal.tsx` | Add the `writing_mode` save-on-change `<select>` (§4.1), mirroring the language select. |
| E6 | `App.tsx` | `isAuSpace += "chat"` (L215); wrap the relevant subtree in `WritingModeProvider`. |
| E7 | `ui/workspace/AuWorkspaceLayout.tsx` | Port the fork's 3 simple-conditional spots; gate on the **mount snapshot** of `useWritingMode().isSimple` (not the const). Full path byte-identical. Import `SimpleChatPanel`/`SimpleReadingView`. |
| E8 | `ui/mobile/MobileLayout.tsx` | Mobile chat slot + `getAuLandingPage(mode)` for entry nav (§3.2). |
| E9 | `ui/mobile/BottomNavBar.tsx` | Conditional chat tab when simple. |
| E10 | `ui/Library.tsx` | Open-AU nav (L71) → `getAuLandingPage(mode)`. |
| E11 | `ui/library/useLibraryMutations.ts` | Create-AU nav (L92) → `getAuLandingPage(mode)`. |
| E12 | `locales/zh.json` + `locales/en.json` | Add `simple.*` namespace (tabs/header/reader/draftCard/tool/error/clearChat/settings). UTF-8 **no-BOM**, no mojibake (Codex recurring pitfall). Inline `defaultValue`s in the fork code mean partial coverage degrades gracefully, but tab + toggle labels should be real keys. |

### 5.5 Pre-flight (blocking, before porting)

- **P0.1** Confirm `@ficforge/engine` exports everything `ui/simple/*` + the 3 wrappers import: `dispatch_simple_chat`, `SIMPLE_TOOL_SHOW_CHAPTER`/`SIMPLE_TOOL_SHOW_SETTING`, `estimate_simple_context_tokens`, `Message`, `WritingMode`/`WRITING_MODES`/`isWritingMode`, `getSimpleFeatures`, `SimpleChatRepository`/`FileSimpleChatRepository`. (Phase-1 scope says yes; verify by diffing fork imports vs MAIN `index.ts`.) Any gap = small Phase-1 follow-up export, **not** a Phase-2 redesign.
- **P0.2** Confirm the fork UI's MAIN-side deps exist: `useKV`, `useFeedback`, `useSessionParams`, `shared/settings-chat/types.ts`, `frontmatter-utils.ts`, shared `Button`/`Spinner`, and the engine-client APIs the tool executor calls (`saveLore`, `readLore`, `listLoreFiles`, `getProjectForEditing`, `confirmChapter`, `getChapterContent`, `listChapters`, `updateChapterContent`, …). (Phase-1 scope confirmed present; spot-check.)
- **P0.3** Grep the ported `ui/simple/*` for any residual `SIMPLE_FEATURES` import (should be none outside landing.ts/nav files).

---

## 6. Edge cases & error handling (part of the deliverable)

1. **`repos.simpleChat` missing** → fixed by E1; without it `getSimpleChat`/`dispatchSimpleChat` throw. E1 lands first.
2. **Mode switch while an AU is open** → mount snapshot (§2.2): the open AU keeps its mode; new mode applies on next AU entry. No mid-session tab flip, no draft/chat collision.
3. **Corrupted/missing `simple-chat.yaml`** → `FileSimpleChatRepository` already degrades to an empty file (Phase 1, never throws).
4. **Invalid `writing_mode` from settings** → `dictToAppConfig` coerces to `'full'` (Phase 1); `saveAppPreferences` validates with `isWritingMode` before writing (§4.2).
5. **Loading race** → `useWritingMode` defaults to `'full'` until loaded, so a full user never briefly sees simple chrome; a simple user sees full chrome for one frame then resolves (acceptable; never the reverse).
6. **Missing i18n keys** → inline `defaultValue` fallbacks render Chinese defaults; tab/toggle labels get real keys.
7. **Switching modes does not mutate data** — chapters/drafts/facts/`simple-chat.yaml` are untouched by a mode flip; each mode reads its own surfaces.

---

## 7. Test plan

### 7.1 PORT (fork → MAIN)
- The fork's 7 `ui/simple/__tests__/*` files — copy, fix import paths. Cover: chat panel tool-call rendering, message memoization, `useSimpleChat` (+ persistence), `useSimpleDispatch`, `useSimpleToolExecutor`, `useContextTokenCount`, `chat-to-llm`.

### 7.2 NEW
- `useWritingMode` — provider returns `'full'` while loading, resolves to persisted value; `refresh()` re-reads.
- `saveAppPreferences` round-trip (§4.3) — save `simple` → reload → `simple`; preserves `language`/`fonts`; invalid → ignored.
- `getAuLandingPage(mode)` — `'simple'→'chat'`, `'full'→'writer'`.
- (Optional UI) `AuWorkspaceLayout` renders chat tab + `SimpleReadingView` when `isSimple`, and `WriterLayout` + no chat tab when full.

### 7.3 KEEP-GREEN (zero-churn)
- All existing full-mode UI tests pass **unmodified**. In particular the Writer UI test suite (the 13 files from the 2026-04 state-pushdown work) must not change — full mode is untouched.
- `src-engine` suite stays 749/749 (no engine edits in Phase 2).

### 7.4 Manual dev-server round-trip (not optional — "green ≠ works")
Run the app; with mode = simple: enter an AU → lands on chat → write a chapter via the agent → accept the draft → reload → confirm `simple-chat.yaml` persisted and the chapter is in the reading view. Toggle back to full → enter an AU → confirm the writer is byte-normal and no chat tab. Toggle mid-AU → confirm the open AU does **not** change, next entry does. Verify on Android too (mobile layout) given the project's mobile target.

---

## 8. Ordered implementation steps

**Group 0 — pre-flight (blocking):** P0.1–P0.3 (§5.5).

**Group 1 — engine wiring + accessor (sequential keystone):**
- S1.1 E1 `engine-instance.ts` register `simpleChat`. *(blocks all API wrappers)*
- S1.2 E3 `AppPreferencesInput += writing_mode`; E4 `saveAppPreferences` persist + `getWritingMode` read.
- S1.3 NEW `useWritingMode.tsx` provider/hook.
- S1.4 round-trip + `useWritingMode` tests.

**Group 2 — port additive UI (parallel, depends on S1.1):**
- P2.1 3 API wrappers + E2 barrel.
- P2.2 `ui/simple/*` components + messages + hooks + `chat-to-llm`/`types`.
- P2.3 `landing.ts` (port+modify).
- P2.4 port `ui/simple/__tests__/*`.

**Group 3 — runtime gating in existing files (serialize per file):**
- S3.1 E6 `App.tsx` (`isAuSpace += chat`, wrap provider).
- S3.2 E7 `AuWorkspaceLayout.tsx` (snapshot gating).
- S3.3 E8/E9 mobile.
- S3.4 E10/E11 landing call sites.

**Group 4 — toggle + i18n:**
- S4.1 E5 `GlobalSettingsModal` select.
- S4.2 E12 `simple.*` i18n (zh + en, atomic).

**Group 5 — verification gate (do not skip):**
- S5.1 `tsc --noEmit` (src-ui) clean.
- S5.2 src-ui test suite green; ported + new tests included; full-mode tests unmodified.
- S5.3 Manual dev-server round-trip (§7.4), desktop + Android.
- S5.4 `git diff --stat`; stop and await human ("提交"/"合并"). Do not push/merge autonomously.

---

## 9. Zero-churn red-line (full mode unchanged)

With `writing_mode='full'` (default), the UI is **behaviorally identical** to pre-Phase-2 MAIN:
1. No chat tab anywhere; AU lands on `writer`; writer = `WriterLayout`.
2. `useWritingMode` defaults to `'full'` → every gating boolean is `false`.
3. `App.tsx isAuSpace` gains `"chat"` but `"chat"` is never navigated to in full mode → inert.
4. `saveAppPreferences` for `language`-only callers behaves exactly as before (the `writing_mode` branch is additive and guard-skipped when absent).
5. Existing full-mode tests (Writer suite, etc.) pass **unmodified, no added mocks**.
6. `src-engine` untouched → 749/749 unchanged.

A full-mode test requiring edits = a churn violation → stop and investigate.

---

## 10. Open questions / risks

1. **`useWritingMode` placement of the live-read for landing vs the snapshot for the workspace** — the provider must expose the live value (for landing) while the workspace deliberately snapshots once. Implementation must keep these distinct (live = `useWritingMode().mode`; snapshot = `useState(() => mode)` at workspace mount). Mis-wiring → either landing is stale or the open AU flips. Covered by §2.2; call out in the plan.
2. **Engine export coverage (P0.1)** — the one place a hidden gap could appear. Low risk (Phase-1 scope verified), but verify by import-diff, not assumption.
3. **Mobile parity** — fork mobile (`MobileLayout`/`BottomNavBar`) must be ported with the same runtime conversion; do not let desktop land while mobile still reads a dead const. Verify on a real Android device.
4. **i18n encoding** — `simple.*` block into `zh.json`/`en.json` is the highest-risk spot for UTF-8 double-encoding (Codex history). `file`-verify no-BOM + grep for mojibake after writing.
5. **GlobalSettingsModal reachable in-AU** — confirmed; the snapshot semantics (§2.2) are what make in-AU switching safe. Verify the toggle's `refresh()` updates landing without forcing a reload.
