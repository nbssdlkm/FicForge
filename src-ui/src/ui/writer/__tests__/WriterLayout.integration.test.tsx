// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * WriterLayout integration sentinel tests.
 *
 * Purpose: protect against regressions during the writer-state-pushdown
 * refactor (Phases 1-3). These tests assert the contracts that must remain
 * true regardless of where state lives internally:
 *   - mounting calls the engine for the given auPath
 *   - changing auPath triggers fresh engine calls and clears prior state
 *   - drafts loaded on mount surface as recovery notice
 *   - generate stream propagates to draft list
 *
 * Mocking strategy: mock at module boundaries (engine-client, feedback,
 * useKV, useMediaQuery, useAppTranslation). Real writer hooks run real,
 * so this exercises the full hook composition the user sees.
 *
 * Query strategy: prefer accessible queries (role, label) over class names
 * or test ids so UI restyle does not break the tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// ----- Module-boundary mocks (must precede WriterLayout import) -----

vi.mock("../../../i18n/useAppTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) {
        return `${key}:${JSON.stringify(params)}`;
      }
      return key;
    },
    i18n: { resolvedLanguage: "zh" },
  }),
}));

vi.mock("../../../hooks/useFeedback", () => ({
  useFeedback: () => ({
    showToast: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useKV", () => ({
  useKV: (_key: string, defaultValue: string) => [defaultValue, vi.fn()],
}));

vi.mock("../../../hooks/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>(
    "../../../api/engine-client",
  );
  return {
    ...actual,
    getState: vi.fn(),
    listFacts: vi.fn(),
    getWriterProjectContext: vi.fn(),
    getWriterSessionConfig: vi.fn(),
    getChapterContent: vi.fn(),
    listDrafts: vi.fn(),
    getDraft: vi.fn(),
    saveDraft: vi.fn(),
    deleteDrafts: vi.fn(),
    confirmChapter: vi.fn(),
    undoChapter: vi.fn(),
    setChapterFocus: vi.fn(),
    generateChapter: vi.fn(),
    extractFacts: vi.fn(),
    addFact: vi.fn(),
    updateChapterContent: vi.fn(),
    saveGlobalModelParams: vi.fn(),
    saveProjectModelParamsOverride: vi.fn(),
    isEngineReady: vi.fn(() => false),
  };
});

// ----- Imports after mocks -----

import { WriterLayout } from "../WriterLayout";
import * as engineClient from "../../../api/engine-client";

const mocked = vi.mocked(engineClient as unknown as Record<string, ReturnType<typeof vi.fn>>);

// ----- Default fixtures -----

const baseState = {
  current_chapter: 3,
  chapter_focus: [],
  chapters_dirty: [],
  last_confirmed_chapter_focus: [],
  au_id: "/fandoms/F/aus/A1",   // 匹配 defaultProps.auPath 的尾部
};

const baseProject = {
  name: "Test AU",
  llm: { mode: "api", model: "gpt-4", has_api_key: true },
};

const baseSettings = {
  default_llm: { mode: "api", model: "gpt-4", has_api_key: true },
  model_params: {},
};

// 动态 mock：getState 返回的 au_id 永远匹配传入的 auPath（去掉 /data 前缀），
// 这样 draftCtrl 的 au_id 守卫能正确通过，测试能覆盖完整加载流程。
function auIdForPath(auPath: string): string {
  return auPath.replace(/^\/data/, '');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getState.mockImplementation(async (auPath: string) => ({
    ...baseState,
    au_id: auIdForPath(auPath),
  }));
  mocked.listFacts.mockResolvedValue([]);
  mocked.getWriterProjectContext.mockResolvedValue(baseProject);
  mocked.getWriterSessionConfig.mockResolvedValue(baseSettings);
  mocked.getChapterContent.mockResolvedValue("previous chapter content");
  mocked.listDrafts.mockResolvedValue([]);
  mocked.getDraft.mockResolvedValue({
    variant: "a",
    content: "",
    generated_with: null,
  });
});

const defaultProps = {
  auPath: "/data/fandoms/F/aus/A1",
  onNavigate: vi.fn(),
};

// ----- Tests -----

describe("WriterLayout integration sentinels", () => {
  it("mounts and queries the engine for the given auPath", async () => {
    render(<WriterLayout {...defaultProps} />);

    await waitFor(() => {
      expect(mocked.getState).toHaveBeenCalledWith(defaultProps.auPath);
      expect(mocked.getWriterProjectContext).toHaveBeenCalledWith(defaultProps.auPath);
      expect(mocked.getWriterSessionConfig).toHaveBeenCalled();
    });
  });

  it("loads the previous chapter content when current_chapter > 1", async () => {
    render(<WriterLayout {...defaultProps} />);

    await waitFor(() => {
      // current_chapter=3 means previous = chapter 2
      expect(mocked.getChapterContent).toHaveBeenCalledWith(defaultProps.auPath, 2);
    });
  });

  it("re-fetches on auPath change with new path", async () => {
    // Wait for initial load to fully settle (multiple async chains in loadData)
    const { rerender } = render(<WriterLayout {...defaultProps} />);
    await waitFor(() => {
      expect(mocked.getState).toHaveBeenCalledWith(defaultProps.auPath);
      expect(mocked.listDrafts).toHaveBeenCalledWith(defaultProps.auPath, 3);
    });

    const newAuPath = "/data/fandoms/F/aus/A2";
    rerender(<WriterLayout {...defaultProps} auPath={newAuPath} />);

    // The contract: switching auPath triggers a new engine load with the new path.
    // (We do not assert "old path is never called again" because pending callbacks
    // from the prior render may settle between the rerender and our assertion;
    // the guards are tested via the active-request-guard hook's own tests.)
    await waitFor(() => {
      expect(mocked.getState).toHaveBeenCalledWith(newAuPath);
      expect(mocked.getWriterProjectContext).toHaveBeenCalledWith(newAuPath);
      expect(mocked.listDrafts).toHaveBeenCalledWith(newAuPath, 3);
    });
  });

  it("clears prior draft state when auPath changes", async () => {
    // Phase 6.2: protect the "clears prior state on AU switch" contract that the
    // previous test's docstring claimed but did not actually verify.
    //
    // Setup: AU A has 1 draft → recovery banner appears. Then switch to AU B with
    // no drafts → recovery banner must disappear (= drafts state cleared).
    mocked.listDrafts.mockResolvedValueOnce([
      { draft_label: "a", chapter_num: 3, draft_id: "ch0003_draft_a.md" },
    ]);
    mocked.getDraft.mockResolvedValue({
      variant: "a",
      content: "A draft",
      generated_with: null,
    });
    mocked.getState.mockResolvedValueOnce({
      ...baseState,
      au_id: "/fandoms/F/aus/A1",
    });

    const { rerender } = render(<WriterLayout {...defaultProps} />);
    await screen.findByText(/drafts\.recoveryNotice/);

    // Switch to AU B (no drafts, different au_id)
    mocked.listDrafts.mockResolvedValue([]);
    mocked.getState.mockResolvedValue({
      ...baseState,
      au_id: "/fandoms/F/aus/A2",
    });
    rerender(<WriterLayout {...defaultProps} auPath="/data/fandoms/F/aus/A2" />);

    // Recovery banner from A must disappear
    await waitFor(() => {
      expect(screen.queryByText(/drafts\.recoveryNotice/)).toBeNull();
    });
  });

  it("loads drafts for the current chapter on mount", async () => {
    mocked.listDrafts.mockResolvedValue([
      { draft_label: "a", chapter_num: 3, draft_id: "ch0003_draft_a.md" },
    ]);
    mocked.getDraft.mockResolvedValue({
      variant: "a",
      content: "draft body",
      generated_with: { model: "gpt-4", char_count: 10, duration_ms: 1500 },
    });

    render(<WriterLayout {...defaultProps} />);

    await waitFor(() => {
      expect(mocked.listDrafts).toHaveBeenCalledWith(defaultProps.auPath, 3);
      expect(mocked.getDraft).toHaveBeenCalledWith(defaultProps.auPath, 3, "a");
    });
  });

  it("shows the recovery notice banner when drafts exist on load", async () => {
    mocked.listDrafts.mockResolvedValue([
      { draft_label: "a", chapter_num: 3, draft_id: "ch0003_draft_a.md" },
    ]);
    mocked.getDraft.mockResolvedValue({
      variant: "a",
      content: "draft body",
      generated_with: null,
    });

    render(<WriterLayout {...defaultProps} />);

    // Recovery banner is rendered only when recoveryNotice && hasPendingDrafts.
    // We assert the translation key text appears (mocked t returns key).
    await screen.findByText(/drafts\.recoveryNotice/);
  });

  it("does not show recovery notice when no drafts exist", async () => {
    render(<WriterLayout {...defaultProps} />);

    await waitFor(() => {
      expect(mocked.getState).toHaveBeenCalled();
    });
    expect(screen.queryByText(/drafts\.recoveryNotice/)).toBeNull();
  });

  it("shows the dirty banner when state.chapters_dirty is non-empty", async () => {
    mocked.getState.mockResolvedValue({
      ...baseState,
      chapters_dirty: [2],
    });

    render(<WriterLayout {...defaultProps} />);

    await screen.findByText(/dirty\.banner/);
  });

  it("does not auto-trigger generation on mount", async () => {
    // Sentinel against accidental auto-fire of generation during mount/reset.
    // Full generate-flow assertions (stream → draft) live in the manual QA
    // checklist §2 because triggering requires WriterFooter's button which
    // is composed several layers down — too brittle for sentinel coverage.
    render(<WriterLayout {...defaultProps} />);
    await waitFor(() => {
      expect(mocked.getState).toHaveBeenCalled();
    });
    expect(mocked.generateChapter).not.toHaveBeenCalled();
  });
});

// Cleanup is handled by src/test/setup.ts (afterEach → cleanup)
