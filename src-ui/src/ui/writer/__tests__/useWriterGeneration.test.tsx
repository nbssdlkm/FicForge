// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>(
    "../../../api/engine-client",
  );
  return {
    ...actual,
    generateChapter: vi.fn(),
  };
});

import * as engineClient from "../../../api/engine-client";
import { useActiveRequestGuard } from "../../../hooks/useActiveRequestGuard";
import { useWriterGeneration } from "../useWriterGeneration";

type StreamCall = {
  signal?: AbortSignal;
};

const mockedGenerateChapter = vi.mocked(engineClient.generateChapter);

function createPendingGenerateMock(calls: StreamCall[]) {
  return vi.fn((_params: unknown, options?: { signal?: AbortSignal }) => (async function* () {
    calls.push({ signal: options?.signal });

    await new Promise<never>((_resolve, reject) => {
      if (!options?.signal) {
        return;
      }

      const onAbort = () => {
        options.signal?.removeEventListener("abort", onAbort);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (options.signal.aborted) {
        onAbort();
        return;
      }

      options.signal.addEventListener("abort", onAbort, { once: true });
    });
  })());
}

function renderGenerationHook(initialAuPath = "/data/fandoms/F/aus/A1") {
  const options = {
    state: { current_chapter: 3 } as any,
    drafts: [],
    instructionText: "",
    projectInfo: { llm: { mode: "api", has_api_key: true } } as any,
    settingsInfo: { default_llm: { mode: "api", has_api_key: true } } as any,
    sessionLlmPayload: null,
    sessionTemp: 0.7,
    sessionTopP: 1,
    loadDraftByLabel: vi.fn(),
    mergeDraftIntoState: vi.fn(),
    attachDraftSummary: vi.fn(),
    appendStream: vi.fn(),
    resetStream: vi.fn(),
    markGeneratedWith: vi.fn(),
    markBudgetReport: vi.fn(),
    markRecoveryNotice: vi.fn(),
    attachPendingContextSummary: vi.fn(),
    getPendingContextSummary: vi.fn(() => null),
    showError: vi.fn(),
    showToast: vi.fn(),
    t: (key: string) => key,
  };

  const hook = renderHook(({ auPath }) => {
    const generateGuard = useActiveRequestGuard(auPath);
    return useWriterGeneration({
      ...options,
      auPath,
      generateGuard,
    });
  }, {
    initialProps: { auPath: initialAuPath },
  });

  return {
    ...hook,
    options,
  };
}

describe("useWriterGeneration abort handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("aborts the in-flight request when auPath changes without surfacing an error", async () => {
    const calls: StreamCall[] = [];
    mockedGenerateChapter.mockImplementation(createPendingGenerateMock(calls));

    const { result, rerender, options } = renderGenerationHook();

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleGenerateFromInput("continue");
    });

    await waitFor(() => {
      expect(mockedGenerateChapter).toHaveBeenCalledTimes(1);
    });
    expect(calls[0]?.signal).toBeDefined();
    expect(calls[0]?.signal?.aborted).toBe(false);

    act(() => {
      rerender({ auPath: "/data/fandoms/F/aus/A2" });
    });

    await waitFor(() => {
      expect(calls[0]?.signal?.aborted).toBe(true);
    });
    await expect(pending).resolves.toBeUndefined();
    expect(options.showError).not.toHaveBeenCalled();
    expect(options.showToast).not.toHaveBeenCalled();
  });

  it("aborts the previous request when generation is triggered again before rerender settles", async () => {
    const calls: StreamCall[] = [];
    mockedGenerateChapter.mockImplementation(createPendingGenerateMock(calls));

    const { result, rerender, options } = renderGenerationHook();

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.handleGenerateFromInput("continue");
      second = result.current.handleGenerateFromInput("continue");
    });

    await waitFor(() => {
      expect(mockedGenerateChapter).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(calls[0]?.signal?.aborted).toBe(true);
    });
    expect(calls[1]?.signal).toBeDefined();
    expect(calls[1]?.signal?.aborted).toBe(false);

    act(() => {
      rerender({ auPath: "/data/fandoms/F/aus/A2" });
    });

    await waitFor(() => {
      expect(calls[1]?.signal?.aborted).toBe(true);
    });
    await expect(Promise.allSettled([first, second])).resolves.toEqual([
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
    ]);
    expect(options.showError).not.toHaveBeenCalled();
    expect(options.showToast).not.toHaveBeenCalled();
  });
});
