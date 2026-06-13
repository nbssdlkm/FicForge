// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const getWritingModeMock = vi.fn();
vi.mock("../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../api/engine-client")>(
    "../../api/engine-client",
  );
  return { ...actual, getWritingMode: () => getWritingModeMock() };
});

import { WritingModeProvider, useWritingMode, readWritingModeMirror } from "../useWritingMode";

function wrapper({ children }: { children: ReactNode }) {
  return <WritingModeProvider>{children}</WritingModeProvider>;
}

beforeEach(() => {
  localStorage.clear();
  getWritingModeMock.mockReset();
  getWritingModeMock.mockResolvedValue("full");
});

describe("useWritingMode", () => {
  it("seeds synchronously from the localStorage mirror (no async-default flash)", async () => {
    localStorage.setItem("ficforge_writing_mode", "simple");
    getWritingModeMock.mockResolvedValue("simple");

    const { result } = renderHook(() => useWritingMode(), { wrapper });
    // First render — before the async reconcile — is already 'simple' from the mirror.
    expect(result.current.mode).toBe("simple");
    expect(result.current.isSimple).toBe(true);

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.mode).toBe("simple");
  });

  it("defaults to 'full' when no mirror is set", async () => {
    const { result } = renderHook(() => useWritingMode(), { wrapper });
    expect(result.current.mode).toBe("full");
    expect(result.current.isSimple).toBe(false);
    await waitFor(() => expect(result.current.loaded).toBe(true));
  });

  it("reconciles toward settings.yaml and updates the mirror", async () => {
    localStorage.setItem("ficforge_writing_mode", "full");
    getWritingModeMock.mockResolvedValue("simple"); // settings.yaml is source of truth

    const { result } = renderHook(() => useWritingMode(), { wrapper });
    expect(result.current.mode).toBe("full"); // synchronous seed

    await waitFor(() => expect(result.current.mode).toBe("simple")); // reconciled
    expect(localStorage.getItem("ficforge_writing_mode")).toBe("simple");
  });

  it("keeps the seed when the engine is not ready (getWritingMode throws)", async () => {
    localStorage.setItem("ficforge_writing_mode", "simple");
    getWritingModeMock.mockRejectedValue(new Error("engine not initialized"));

    const { result } = renderHook(() => useWritingMode(), { wrapper });
    expect(result.current.mode).toBe("simple");
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.mode).toBe("simple"); // seed kept despite the throw
  });

  it("ignores an invalid mirror value", () => {
    localStorage.setItem("ficforge_writing_mode", "weird");
    expect(readWritingModeMirror()).toBe("full");
  });

  it("returns a safe 'full' default outside the provider", () => {
    const { result } = renderHook(() => useWritingMode()); // no wrapper
    expect(result.current.mode).toBe("full");
    expect(result.current.isSimple).toBe(false);
    expect(result.current.loaded).toBe(true);
  });
});
