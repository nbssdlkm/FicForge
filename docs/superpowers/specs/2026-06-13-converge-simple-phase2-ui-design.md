# Phase 2 Design Spec — Wire the simple-mode UI into MAIN (UI layer)

**Date:** 2026-06-13
**Status:** Design **Rev 3** — post two code-grounded review rounds (4-reviewer audit → Rev 2 → re-verify → Rev 3). Ready for implementation.
**Scope owner:** CC
**Source fork:** `D:\fanfic-system-simple` (branch `feat/agent-harness-v1`) — UI layer
**Target:** `D:\fanfic-system` (branch `feat/converge-simple-phase2`)
**Predecessor:** Phase 1 (engine convergence) — merged to `main` (commits `942913c` + `b3281af`). Spec: `2026-06-02-converge-simple-into-main-phase1-design.md`.

**Rev 2 changelog (what the review caught + changed):**
- **Loading-race fixed (BLOCKING):** the async provider defaulting to `'full'` while loading + the mount snapshot converted a "one-frame flash" into a **session-sticky wrong mode**, and in the worst interleaving a **blank workspace** (`activeTab='chat'` with a `'full'` snapshot that has no chat tab/branch). Fixed by a **synchronous localStorage mirror** (`ficforge_writing_mode`), exactly how the project already seeds `language` (`i18n.ts:17-27`) before paint, plus a chat-route safety branch. §2.1, §3.1, §6, §10.
- **Mobile port re-scoped (BLOCKING):** the fork's `BottomNavBar` depends on a `SegmentedTabs.tsx` that **does not exist in MAIN** (compile break), and the fork's `MobileSettingsView` **deletes the full-mode AU AI-settings FAB** (a §9 zero-churn violation). Mobile is now a **surgical additive** change, not a verbatim port. §1.4, §3.2, E8/E9.
- **Correct landing call-site (MAJOR):** primary open-AU click is `LibraryFandomSections.tsx:245`, not the onboarding `Library.tsx:71`. §3.4, E10.
- **Mobile snapshot threading (MAJOR):** mobile chrome must consume the workspace **snapshot via prop**, never a live `useWritingMode()`, or desktop/mobile switch semantics diverge. §3.2, E8/E9.
- **i18n is a real task (MAJOR):** ~90 `simple.*` keys exist only as Chinese inline `defaultValue`s; **English users would see Chinese**, tests green. E12 is now full bilingual authoring + a key-coverage lint. §5.4, §7.
- **Snapshot invariant gets a required test (MAJOR).** §7.
- **Verified CLEAN (do NOT re-litigate):** the `saveAppPreferences`↔`dictToAppConfig` round-trip closes (serialization is structural via `obj_to_plain`, no second whitelist); and every `@ficforge/engine` symbol the fork imports is exported through the `services`/`domain` sub-barrels. Both confirmed by 3 reviewers.
- Minor: hook-in-handler reword (§4.1), test count 7→8, E2 exact barrel diff, memoize provider value, `key={auPath}` defense-in-depth.

**Rev 3 changelog (post re-verify of Rev 2):**
- **Dropped the `App.tsx` `chat→writer` redirect (Rev-2 BLOCKING mistake):** App.tsx can't read the workspace's internal mount snapshot, and gating it on the *live* mode would re-introduce the mid-session flip §2.2 prevents. The snapshot-independent content switch (`SimpleChatPanel` on `activeTab==='chat'`) already covers the blank-workspace case. §3.1, §3.3, E6.
- **Fixed the §3.4/E10 verification search (MAJOR):** single-line `grep` can't match the multi-line primary site `LibraryFandomSections.tsx:245`; use `rg -U` + a negative control that the search surfaces :245 *before* editing.
- **Broadened the i18n coverage lint (MAJOR):** scan the whole `src-ui/src` tree (incl. `ui/settings/`, where the toggle's `simple.settings.*` labels live); fail if a key is missing from **either** locale.
- Minor: UI files import `WritingMode`/`isWritingMode`/`WRITING_MODES`/`getSimpleFeatures` from `@ficforge/engine` directly (E2); enumerated the mobile type/map edits (E9); noted the `key={auPath}` tradeoff (§9).

---

## 1. Overview & Scope

### 1.1 Goal

Phase 1 brought the simple-mode **engine** into MAIN behind `AppConfig.writing_mode` (`'full' | 'simple'`, default `'full'`), switchable only programmatically. Phase 2 brings the **UI** so an end user can pick simple mode in settings and use the chat-driven writing experience — while full mode stays the default and byte-identical to today.

### 1.2 Product decisions (settled with PM, 2026-06-13)

- **Positioning: peer preference.** Simple and full are equal, user-toggled modes. **Both fully preserved — no feature hiding.** Full stays default. → Port the fork's validated UX **as-is**; no redesign, no stripping facts/lore from simple.
- **Switch semantics: takes effect on next AU entry.** Changing `writing_mode` while an AU is open must **not** disrupt the open AU. → Landing reads the mode **fresh**; the AU workspace **snapshots** it at mount so the open AU never flips mid-session.

### 1.3 In scope

- Runtime mode accessor: `WritingModeProvider` (App-level) + `useWritingMode()` with a **synchronous localStorage mirror** (§2.1).
- Port the fork's `src-ui/src/ui/simple/` tree + 3 API wrappers + `engine-client` barrel exports.
- Register `FileSimpleChatRepository` in `engine-instance.ts` (Phase-1 wiring gap).
- Convert compile-time `SIMPLE_FEATURES.simpleAssembler` gating to runtime `writing_mode` in `AuWorkspaceLayout`, `App.tsx`, `landing.ts`, and — **surgically** — `MobileLayout`/`BottomNavBar`.
- `writing_mode` toggle in `GlobalSettingsModal` + the `saveAppPreferences` round-trip fix + the localStorage mirror write.
- Full bilingual `simple.*` i18n (zh + en, ~90 keys) + a key-coverage lint.
- Tests: port fork's `ui/simple` tests; new tests for `useWritingMode`, the snapshot invariant, `getAuLandingPage`, the settings round-trip, gating-render per surface, i18n coverage.

### 1.4 Out of scope (explicit)

- **No engine changes** (Phase 1 done; exports verified additive-complete — see §5.5). A missing export would be a Phase-1 follow-up, not a Phase-2 redesign — but the review confirmed none are missing.
- **No data migration** between modes — **TD-015** stays a separate, event-driven debt.
- **No new visual design** — faithful port of the fork's *simple-mode* UX, not a redesign.
- **The fork's mobile-shell refactors are OUT of scope** and must NOT leak in via "faithful port": (a) the fork's `MobileSettingsView` **AU AI-settings FAB removal** (`'AU 级 AI 设定助手不必要'`), (b) the fork's `MobileLayout` **header redesign** (single- → double-row), (c) the fork's **`SegmentedTabs` migration** of `BottomNavBar`. These are fork-local product choices unrelated to simple mode; MAIN keeps its current mobile shell and adds only the chat tab/slot + mode-aware entry nav.
- No making simple the default, no per-AU mode, no onboarding mode-picker.

### 1.5 Code principles honored

- **Single source of truth:** "is simple on now" derives from one hook (`useWritingMode`) over `getSimpleFeatures`; the fork's scattered `SIMPLE_FEATURES.simpleAssembler` reads collapse to it (desktop) or to a single snapshot prop (mobile).
- **Zero-churn under full** (§9): every full-mode path + test stays byte-identical/unmodified.
- **Round-trip closure:** the new `writing_mode` settings field proves write↔read symmetry with a test (the engine round-trip is already covered; this adds the UI→engine wrapper).
- **No silent green:** i18n key coverage is lint-enforced so a missing English translation can't hide behind a Chinese `defaultValue`.

---

## 2. Runtime gating architecture

The fork gates simple UI on a **compile-time** const (`SIMPLE_FEATURES.simpleAssembler`), resolved at build time — always instantly correct. MAIN must read the **runtime** `app.writing_mode`. Replacing a synchronous build-time value with an async runtime read is the source of the race the review caught; §2.1 removes the race by seeding synchronously.

### 2.1 `WritingModeProvider` + `useWritingMode()` (NEW) — with a synchronous localStorage mirror

New file `src-ui/src/hooks/useWritingMode.tsx`:

- **Synchronous seed (the race fix):** the initial value is read **synchronously from `localStorage['ficforge_writing_mode']`** (validated via `isWritingMode`, default `'full'`), exactly as the app already seeds `language` from `ficforge_language` before first paint (`i18n.ts:17-27`). So from frame 1, landing and the workspace snapshot read the **same correct value** — there is no async-default-`'full'` window where a simple user could be mis-routed.
- **Async reconcile:** on mount, `getWritingMode()` (new read in `engine-settings.ts`, E4) reads `settings.yaml` (the source of truth) and, if it differs from the mirror, updates both the context state and the mirror. This corrects drift (e.g., settings edited out-of-band) on the next entry.
- **Shape:** `{ mode: WritingMode; isSimple: boolean; loaded: boolean; refresh: () => Promise<void> }`. `loaded` flips true after the first reconcile. The context value is **memoized** (`useMemo`; `refresh` via `useCallback`) so full-mode consumers don't get spurious re-renders (keeps §9 clean).
- The mirror is **written by the toggle handler** (§4.1) alongside `saveAppPreferences`, so the next launch seeds correctly.

> Why the mirror, not just a `loaded` gate: gating navigation on `loaded` works but adds a visible "settling" delay on every cold AU entry, worst on Capacitor/Android (slow FS). The synchronous mirror is what the codebase already does for `language` and gives a correct first frame with no delay. `loaded` is kept as defense-in-depth for the reconcile path only.

### 2.2 Snapshot-at-mount (the "next AU entry" semantics)

- **Landing sites read the live value** (`useWritingMode().mode`) → a just-changed mode applies on the next AU you open. With the mirror, this value is already correct synchronously.
- **`AuWorkspaceLayout` snapshots the value at mount** (`useState(() => isSimple)`), using it for tabs/content. The snapshot is also threaded to mobile chrome (§3.2).

**Invariant (must hold; tested in §7):** the snapshot is re-read **once per AU entry** *iff* `AuWorkspaceLayout` unmounts on Library return and there is no AU→AU navigation bypassing Library. Verified true today: `App.tsx:215,227` renders `AuWorkspaceLayout` only while `isAuSpace`, the back button does `onNavigate('library')`, and there is no in-workspace control that jumps to a different `auPath`. **Defense-in-depth: add `key={auPath}` to `<AuWorkspaceLayout>` in `App.tsx`** so the snapshot re-initializes per AU even if a future refactor adds direct AU→AU nav. A mid-AU toggle (the in-AU settings tab can open `GlobalSettingsModal`, `AuSettingsLayout.tsx:446`) flips the provider but **not** the frozen snapshot → open AU unchanged, next entry picks up the new mode.

---

## 3. UI coexistence (desktop + mobile)

### 3.1 Desktop — `AuWorkspaceLayout.tsx`

Port the fork's three simple-conditional spots, gating on the **mount snapshot** `isSimple` (not the const). When simple:
1. Prepend a `chat` tab (`simple.tabs.chat`, "对话").
2. Relabel writer 续写 → **阅读** (`simple.tabs.reading`).
3. `activeTab==='writer'` → read-only `SimpleReadingView` instead of `WriterLayout`.

facts/au_lore/settings tabs unchanged. Full mode = exactly today.

**Chat-route safety (race defense):** the content switch renders `SimpleChatPanel` whenever `activeTab==='chat'`, **independent of the snapshot** (ported from the fork's content switch, `AuWorkspaceLayout.tsx:410`) — so there is never a blank workspace even in a degenerate interleaving. **No App.tsx-level redirect is used:** App.tsx (the parent) cannot read the workspace's internal mount snapshot, and gating a redirect on the *live* mode would re-introduce the very mid-session flip §2.2 prevents (a mid-AU toggle to full would bounce the user out of chat). The snapshot-independent content switch is the only safety needed.

### 3.2 Mobile — `MobileLayout.tsx` + `BottomNavBar.tsx` (SURGICAL, additive only)

**Do NOT port the fork's mobile files verbatim** (they carry out-of-scope refactors + a missing dependency — §1.4). Instead:
- Keep MAIN's `MobileSettingsView` (AU AI-settings FAB + `SettingsChatPanel`) and the `currentChapter` plumbing **intact** — full mode unchanged.
- **Surgically insert** the chat tab into MAIN's existing `<nav className="grid grid-cols-4">` (→ conditional 5-tab grid when simple); do **not** introduce the fork's `SegmentedTabs.tsx`.
- Add the read-only reading view + chat slot conditionally.
- Entry nav (`onNavigate("writer", auPath)` at `MobileLayout.tsx:87/122/127`) → `onNavigate(getAuLandingPage(mode), auPath)`.

**Snapshot threading (must):** `BottomNavBar` and `MobileLayout` receive `isSimple: boolean` **as a prop** sourced from the `AuWorkspaceLayout` mount snapshot (the prop path already exists — `AuWorkspaceLayout` renders `MobileLayout` at MAIN line 188). **Forbidden:** calling `useWritingMode()` live inside mobile chrome — that would re-introduce the mid-session flip the snapshot model prevents and diverge mobile from desktop. Tested in §7.

### 3.3 Routing — `App.tsx`

- `isAuSpace` (L215) `["writer","facts","au_lore","settings"]` → **add `"chat"`**.
- Wrap the top-level rendered tree in `WritingModeProvider` (covers Library landing + AU workspace + mobile).
- Add `key={auPath}` to `<AuWorkspaceLayout>` (§2.2). (No App.tsx `chat→writer` redirect — §3.1; the snapshot-independent content switch covers the blank-workspace case.)

### 3.4 Landing — `ui/simple/landing.ts` (PORT + MODIFY)

```ts
export type AuLandingPage = "chat" | "writer";
export function getAuLandingPage(mode: WritingMode): AuLandingPage {
  return getSimpleFeatures(mode).simpleAssembler ? "chat" : "writer";
}
```

Convert these hardcoded `'writer'` nav sites to `getAuLandingPage(mode)` (live mode from `useWritingMode`):
- **`LibraryFandomSections.tsx:245`** — the **primary** AU-card click (the real open path).
- `Library.tsx:71` — onboarding-completion `openAuPath`.
- `useLibraryMutations.ts:92` — create-AU.
- Mobile entry (`MobileLayout.tsx:87/122/127`) — uses the snapshot prop (it's inside the mounted workspace).
- The two in-workspace sites (`AuWorkspaceLayout.tsx:298/322`) use the **snapshot**.

**Verification step (required):** use a **multiline-tolerant** search — `rg -U "onNavigate\(\s*['\"]writer" src-ui/src/ui` — because the **primary** site `LibraryFandomSections.tsx:245` is a *multi-line* call (`onNavigate(` on L245, `'writer'` on L246) that a single-line `grep` silently misses. **Negative control:** before editing, confirm the search **surfaces** `LibraryFandomSections.tsx:245` (if it doesn't, the pattern is wrong — fix the pattern, not the proof). After editing, it must return **only** the intentional in-workspace snapshot sites. Any other hardcoded `'writer'` is a missed landing site.

---

## 4. Settings toggle + round-trip

### 4.1 Toggle UI — `GlobalSettingsModal.tsx`

Add a `writing_mode` `<select>` (options from `WRITING_MODES`) modeled on the **pattern** of the language select (`GlobalSettingsModal.tsx:343-355`) — a **save-on-change** field, not gated behind the modal's Save button. Note: the language select's handler calls `changeLanguage()` (an i18n module fn that wraps `saveAppPreferences`), but `writing_mode` has **no i18n wrapper**, so its handler saves directly.

Wire it correctly (Rules of Hooks — call the hook at component scope, not in the handler):
```ts
const { refresh } = useWritingMode();            // component scope
// in <select onChange>:
const next = e.target.value as WritingMode;
await saveAppPreferences({ writing_mode: next });          // persist to settings.yaml
writeWritingModeMirror(next);                              // sync localStorage mirror (§2.1)
await refresh();                                           // provider re-reads → landing fresh
```
`refresh` must be stable (`useCallback` in the provider). Surface errors via the existing `showError`; add a one-line helper text: the switch applies on the next AU you open. Labels from `simple.settings.*` i18n keys.

### 4.2 Persistence round-trip — `saveAppPreferences` + `AppPreferencesInput`

`saveAppPreferences` (`engine-settings.ts:222-230`) today persists **only `language`** — a new field is silently dropped. Fix:
- `AppPreferencesInput += writing_mode?: WritingMode` (`api/settings.ts:91`).
- Persist with validation (spread `current.app` first → fonts/other fields preserved):
  ```ts
  current.app = {
    ...current.app,
    ...(payload.language ? { language: payload.language as Settings["app"]["language"] } : {}),
    ...(payload.writing_mode && isWritingMode(payload.writing_mode)
        ? { writing_mode: payload.writing_mode } : {}),
  };
  ```

> **Round-trip is VERIFIED CLEAN (do not re-investigate):** `withSettingsWrite` reads `settings.get()` (always returns `app.writing_mode` post-Phase-1), the spread preserves it, and `settings.save()` serializes structurally via `structuredClone` + `obj_to_plain` (recurses all keys, **no field whitelist** — there is no `appConfigToDict`) + `yaml.dump`. Read path `dictToAppConfig` coerces invalid→`'full'`. Engine round-trip already covered by `file_settings.test.ts:225-269`. This fix only adds the UI→engine wrapper field; §4.3 tests the wrapper.

### 4.3 Round-trip test (required)
Save `{writing_mode:'simple'}` → reload → `'simple'`; preserves `language`/`fonts`; absent/invalid → `'full'`.

---

## 5. Exact file manifest

### 5.1 New files — PORT VERBATIM from fork (mode-agnostic; rendered only when simple)

Grep-confirmed: **none of these import the dead `SIMPLE_FEATURES`** (only `landing.ts` does, handled in §5.2). The fork's `SegmentedTabs.tsx` is **NOT** ported (§1.4).

| Area | Files |
|---|---|
| Chat UI | `ui/simple/{SimpleChatPanel,SimpleChatHistory,SimpleChatInput,SimpleReadingView,SimpleSettingsDrawer}.tsx` |
| Message cards | `ui/simple/messages/{AssistantMessage,ChapterPreviewCard,SettingPreviewCard,SystemMessage,ToolCallCard,UserMessage,WritingDraftCard}.tsx` |
| Hooks | `ui/simple/{useSimpleChat,useSimpleDispatch,useSimpleToolExecutor,useContextTokenCount}.ts` |
| Glue | `ui/simple/{chat-to-llm,types}.ts` |
| API wrappers | `api/{engine-simple-dispatch,engine-simple-chat,engine-tokens}.ts` |
| Tests | `ui/simple/__tests__/*` — **8 files**: `SimpleChatPanel.toolCall`, `chat-to-llm`, `messages.memo`, `useContextTokenCount`, `useSimpleChat`, `useSimpleChat.persistence`, `useSimpleDispatch`, `useSimpleToolExecutor` |

### 5.2 New file — PORT + MODIFY
| File | Modification |
|---|---|
| `ui/simple/landing.ts` | Drop `SIMPLE_FEATURES` import; `getAuLandingPage(mode: WritingMode)` pure over `getSimpleFeatures(mode)` (§3.4). |

### 5.3 New files — NET-NEW (MAIN-only)
| File | Purpose |
|---|---|
| `hooks/useWritingMode.tsx` | `WritingModeProvider` + `useWritingMode()` + the localStorage mirror helpers (`readWritingModeMirror`/`writeWritingModeMirror`) (§2.1). |

### 5.4 Existing MAIN files — EDIT (surgical)

| # | File | Edit |
|---|---|---|
| E1 | `api/engine-instance.ts` | Import `FileSimpleChatRepository`; add `simpleChat: FileSimpleChatRepository` to `EngineInstance.repos` (L37-46) + `simpleChat: new FileSimpleChatRepository(adapter)` to `initEngine` (L62-71). **Lands first** — ported API throws without it. (Constructor `(adapter)` confirmed: `file_simple_chat.ts:24`.) |
| E2 | `api/engine-client.ts` | Add exactly these re-exports: `export * from "./engine-simple-dispatch";` `export * from "./engine-simple-chat";` `export * from "./engine-tokens";` and `export { SIMPLE_TOOL_SHOW_CHAPTER, SIMPLE_TOOL_SHOW_SETTING } from "@ficforge/engine";` (SimpleChatPanel imports the two tool consts from `engine-client`). **Note:** new UI files import `WritingMode`/`isWritingMode`/`WRITING_MODES`/`getSimpleFeatures` **directly from `@ficforge/engine`** (project convention, `index.ts:7-8`), not through this barrel. |
| E3 | `api/settings.ts` | `AppPreferencesInput += writing_mode?: WritingMode`. |
| E4 | `api/engine-settings.ts` | `saveAppPreferences` persists `writing_mode` w/ `isWritingMode` guard (§4.2); add `getWritingMode()` read for the provider reconcile (§2.1). |
| E5 | `ui/settings/GlobalSettingsModal.tsx` | `writing_mode` save-on-change `<select>` (§4.1). |
| E6 | `App.tsx` | `isAuSpace += "chat"` (L215); wrap top tree in `WritingModeProvider`; `key={auPath}` on `<AuWorkspaceLayout>`. **No** chat→writer redirect (§3.1). |
| E7 | `ui/workspace/AuWorkspaceLayout.tsx` | Snapshot `isSimple` at mount; port the 3 conditional spots; chat branch renders on `activeTab==='chat'` regardless (§3.1); pass `isSimple` snapshot to `<MobileLayout>`. Full path byte-identical. |
| E8 | `ui/mobile/MobileLayout.tsx` | Accept `isSimple` prop (snapshot, NOT a live hook); conditional reading view + chat slot; entry nav → `getAuLandingPage(mode)`; **keep `currentChapter` + MobileSettingsView FAB**. |
| E9 | `ui/mobile/BottomNavBar.tsx` | Accept `isSimple` prop; **surgically** add the chat tab to the existing `<div className="grid grid-cols-4">` (→ conditional `grid-cols-5` when simple); do **not** import `SegmentedTabs`; do **not** call `useWritingMode()`. **Enumerate the type/map touch points** (a missing case silently routes chat→writer): `MobileLayout` `WorkspacePage` union `+= 'chat'` (L16) + `mapPageToTab` `'chat'` case (L33-37; its `else` defaults to writer); `BottomNavBar` `MobileWorkspaceTab`/`TAB_IDS`/`TAB_ICONS` 4→5; `AuWorkspaceLayout.tsx:189` page-union cast `+= 'chat'`. **Pin the mobile chat-tab position deliberately** (desktop puts chat first) to avoid desktop/mobile drift. |
| E10 | `ui/library/LibraryFandomSections.tsx` (**primary**, L245), `ui/Library.tsx` (L71), `ui/library/useLibraryMutations.ts` (L92) | Open/create-AU nav → `getAuLandingPage(mode)`. Then run the §3.4 grep to prove no hardcoded `'writer'` remains outside the snapshot sites. |
| E11 | `ui/i18n/...` registration | If a new namespace/key file is added, register it; otherwise keys go into existing `locales/zh.json` + `en.json` (E12). |
| E12 | `locales/zh.json` + `locales/en.json` | **Full `simple.*` namespace, both languages.** Extract the complete key list by scanning the **whole `src-ui/src` tree** (`rg "t\(['\"]simple\." src-ui/src`) — **not** a hardcoded dir list — because the new toggle's `simple.settings.*` labels live in `GlobalSettingsModal.tsx` under `ui/settings/` (outside ui/simple). ~90 keys; author real **zh AND en** values for all. Today MAIN has **zero** `simple.*` keys; the rest live as Chinese inline `defaultValue`s → English users would see Chinese. UTF-8 **no-BOM**, no mojibake. |

### 5.5 Pre-flight
- **P0.1 (VERIFIED present — do not chase):** every `@ficforge/engine` symbol the port imports resolves through the `services`/`domain` sub-barrels (`export *`): `dispatch_simple_chat`, `SIMPLE_TOOL_SHOW_CHAPTER`/`SHOW_SETTING`, `estimate_simple_context_tokens`, `SimpleChatEvent`, `SimpleContextTokenEstimate`, `SimpleChatFile`, `SimpleChatMessageEnvelope`, `resolve_llm_config`, `Message`, `WritingMode`/`WRITING_MODES`/`isWritingMode`, `getSimpleFeatures`, `SimpleChatRepository`, `FileSimpleChatRepository`. `SIMPLE_FEATURES` confirmed absent (fork-only). No gap.
- **P0.2 (present):** `useKV`, `useFeedback`, `useSessionParams`, `ui/shared/settings-chat/{types,frontmatter-utils}.ts`, shared `Button`/`Spinner`, and the 8 tool-exec engine-client APIs.
- **P0.3:** confirm the `i18n.ts` localStorage seed pattern for `ficforge_language` (L17-27) to mirror it for `ficforge_writing_mode`.

---

## 6. Edge cases & error handling

1. **`repos.simpleChat` missing** → E1 (lands first); ported API throws otherwise.
2. **Mode switch while an AU is open** → mount snapshot (§2.2): open AU unchanged, new mode on next entry; mobile reads the same snapshot via prop (§3.2).
3. **Corrupted/missing `simple-chat.yaml`** → `FileSimpleChatRepository` degrades to empty (Phase 1, never throws).
4. **Invalid `writing_mode` in settings** → `dictToAppConfig` coerces `'full'`; `saveAppPreferences` validates with `isWritingMode`; the localStorage mirror validates on read.
5. **Loading/first-paint** → the **synchronous localStorage mirror** (§2.1) gives a correct value on frame 1, so a simple user is never mis-routed to writer/reading and there is **no blank-workspace state** (the chat branch renders on `activeTab==='chat'` regardless, §3.1). First-ever launch with no mirror → `'full'` (correct default). Async reconcile corrects out-of-band drift on next entry.
6. **Missing i18n keys** → lint-enforced coverage (E12 + §7) so English can't silently fall back to Chinese.
7. **Mode flip mutates no data** — chapters/drafts/facts and `{au}/.well-known/simple-chat.yaml` are disjoint (verified); a flip touches none.

---

## 7. Test plan

### 7.1 PORT (fork → MAIN) — **8** files
`ui/simple/__tests__/*` (the 8 in §5.1) — copy, fix import paths. They mock `engine-client` and reference no `SIMPLE_FEATURES`, so they port without const-mocking.

### 7.2 NEW (required)
- **`useWritingMode`** — synchronous seed from the mirror (no async-default flash); reconcile updates state+mirror; `refresh()` re-reads; memoized value identity stable.
- **Snapshot invariant (the #1 risk)** — mount `AuWorkspaceLayout` with `isSimple=true`, flip the provider mode to full, **assert the chat tab + `SimpleReadingView` are still rendered** (snapshot held); a fresh remount picks up the new mode; the workspace unmounts when `currentPage` leaves the AU set.
- **Mobile snapshot parity** — a mid-AU toggle does **not** change the mobile tab set (`BottomNavBar` consumes the prop, not a live hook).
- **Gating-render per surface** — desktop `AuWorkspaceLayout`: chat tab present iff simple; mobile `BottomNavBar`: 5 vs 4 tabs by mode.
- **`getAuLandingPage(mode)`** — `'simple'→'chat'`, `'full'→'writer'`.
- **`saveAppPreferences` round-trip** (§4.3).
- **i18n coverage lint/test** — scans the **whole `src-ui/src` tree** for `t('simple.…')` usages (incl. `ui/settings/GlobalSettingsModal.tsx`) and fails if any referenced `simple.*` key is absent from **either** `zh.json` **or** `en.json` (so `defaultValue` can never mask a missing en — or zh — translation).

### 7.3 KEEP-GREEN (zero-churn)
- All full-mode UI tests pass **unmodified** (the 13 Writer-suite files in particular).
- `src-engine` stays 749/749 (no engine edits).

### 7.4 Manual dev-server round-trip (not optional)
Simple: enter AU (via library card) → lands on chat → write a chapter via the agent → accept the draft → reload → `simple-chat.yaml` persisted + chapter in reading view. Toggle to full mid-AU → open AU does NOT change; next entry is byte-normal writer, no chat tab. Switch to English → simple UI is English (not Chinese). Verify on **Android** (mobile surgical insert + snapshot prop + slow-FS first-paint via the mirror).

---

## 8. Ordered implementation steps

**Group 0 — pre-flight:** P0.1–P0.3 (§5.5) — mostly confirmations.

**Group 1 — engine wiring + accessor (keystone):**
- S1.1 E1 register `simpleChat`. *(blocks API wrappers)*
- S1.2 E3 `AppPreferencesInput += writing_mode`; E4 `saveAppPreferences` persist + `getWritingMode`.
- S1.3 NEW `useWritingMode.tsx` (mirror + reconcile + memoized value).
- S1.4 tests: `useWritingMode`, round-trip, `getAuLandingPage`.

**Group 2 — port additive UI (parallel, depends on S1.1):**
- P2.1 3 API wrappers + E2 barrel (exact 4 lines).
- P2.2 `ui/simple/*` (components, messages, hooks, chat-to-llm, types).
- P2.3 `landing.ts` (port+modify).
- P2.4 port the **8** `ui/simple/__tests__/*`.

**Group 3 — runtime gating in existing files (serialize per file):**
- S3.1 E6 `App.tsx` (provider wrap, `isAuSpace += chat`, `key={auPath}`).
- S3.2 E7 `AuWorkspaceLayout.tsx` (mount snapshot, 3 spots, chat-render-regardless, pass `isSimple` to mobile).
- S3.3 E8/E9 mobile (surgical, snapshot prop, keep FAB/currentChapter).
- S3.4 E10 landing call sites + the grep proof.
- S3.5 gating + snapshot-invariant + mobile-parity tests (§7.2).

**Group 4 — toggle + i18n:**
- S4.1 E5 `GlobalSettingsModal` select (hook at scope, mirror write).
- S4.2 E12 full `simple.*` zh+en + coverage lint test.

**Group 5 — verification gate (do not skip):**
- S5.1 `tsc --noEmit` (src-ui) clean.
- S5.2 src-ui suite green; ported + new tests included; full-mode tests **unmodified**; i18n coverage lint green.
- S5.3 Manual dev-server round-trip (§7.4), desktop + Android.
- S5.4 `git diff --stat`; stop and await human ("提交"/"合并").

---

## 9. Zero-churn red-line (full mode unchanged)

With `writing_mode='full'` (default), the UI is **behaviorally identical** to pre-Phase-2 MAIN:
1. No chat tab anywhere; AU lands on `writer`; writer = `WriterLayout`; mobile shell incl. the AU AI-settings FAB unchanged.
2. `useWritingMode` seeds `'full'` (mirror absent or `'full'`) → every gating boolean false; the memoized provider value avoids spurious re-renders (the one settle-render is behavior-neutral; the red-line is behavioral identity + unmodified tests, which holds).
3. `isAuSpace += "chat"` is inert (no full-mode path navigates to `chat`).
4. `saveAppPreferences` language-only callers behave exactly as before (the `writing_mode` branch is additive, guard-skipped when absent).
5. Existing full-mode tests pass **unmodified, no added mocks**; `src-engine` 749/749 unchanged.
6. **Mobile is additive only** — the FAB, header, and tab-bar component are untouched in full mode (the fork's removals are out of scope, §1.4).
7. **`key={auPath}`** is behavior-neutral *only while AU→AU navigation routes through Library* (always true today — the back button does `onNavigate('library')`, and there is no in-workspace AU switch). If a future refactor adds direct AU→AU nav, the key would reset `leftCollapsed`/toast/milestone-dismiss state on switch — a deliberate tradeoff to revisit then, not a free guarantee.

A full-mode test requiring edits = a churn violation → stop and investigate.

---

## 10. Open questions / risks

1. **First-paint correctness depends on the mirror being seeded before paint** — mirror the `ficforge_language` pattern exactly (synchronous `localStorage.getItem` at provider-module/init scope, not in a `useEffect`). If read in an effect, the first frame still defaults `'full'` and the race returns. Tested in §7.2.
2. **Mobile must consume the snapshot prop, never a live hook** (§3.2) — the path of least resistance (`useWritingMode()` in `BottomNavBar`) re-introduces the mid-session flip. Enforced by the §7.2 mobile-parity test + code review.
3. **i18n is a ~90-key bilingual task**, not a small block — the coverage lint (§7.2) is the guard against the silent-Chinese regression.
4. **Snapshot invariant** relies on `App.tsx` unmounting the workspace on Library return + no AU→AU bypass; `key={auPath}` is defense-in-depth. Tested.
5. **VERIFIED CLEAN — do not re-litigate:** (a) the `saveAppPreferences`↔`dictToAppConfig` round-trip closes (structural serialization, no second whitelist); (b) engine export coverage (P0.1) is satisfied via sub-barrels. Both confirmed by 3 reviewers; included here so a future reviewer doesn't re-open them.
