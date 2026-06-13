// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Writing-mode runtime accessor (Phase 2 / writing_mode convergence).
 *
 * `writing_mode` ('full' | 'simple') lives on AppConfig (settings.yaml) and is the single
 * runtime switch between the full writer and the simple chat-driven experience.
 *
 * The provider seeds its initial value SYNCHRONOUSLY from a localStorage mirror
 * (`ficforge_writing_mode`) — exactly how language seeds from `ficforge_language` in i18n.ts —
 * so landing decisions and the AU-workspace mount snapshot read the same correct value on the
 * very first frame. Defaulting to an async-loaded value would, combined with the workspace
 * mount snapshot, convert a one-frame flash into a session-sticky wrong mode (see the Phase 2
 * design spec §2.1). On mount it reconciles against settings.yaml (the source of truth).
 *
 * Consumers: landing sites read the LIVE `mode` (a just-changed mode applies on the next AU
 * entry); the AU workspace SNAPSHOTS `isSimple` at mount so a mid-session toggle never flips
 * the open AU. Mobile chrome consumes the workspace snapshot via prop — never this hook live.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isWritingMode, type WritingMode } from "@ficforge/engine";
import { getWritingMode } from "../api/engine-client";

const MIRROR_KEY = "ficforge_writing_mode";

/** Synchronous read of the persisted writing_mode mirror. Seeds before first paint. */
export function readWritingModeMirror(): WritingMode {
  try {
    const stored = localStorage.getItem(MIRROR_KEY);
    if (stored && isWritingMode(stored)) return stored;
  } catch {
    // localStorage unavailable (e.g. SSR) — fall through to default
  }
  return "full";
}

/** Persist the writing_mode mirror so the next launch seeds the correct value synchronously. */
export function writeWritingModeMirror(mode: WritingMode): void {
  try {
    localStorage.setItem(MIRROR_KEY, mode);
  } catch {
    // ignore — the settings.yaml reconcile self-heals on next entry
  }
}

interface WritingModeContextValue {
  /** The current runtime writing mode. Landing sites read this LIVE value. */
  mode: WritingMode;
  /** `mode === 'simple'`. */
  isSimple: boolean;
  /** True once the settings.yaml reconcile has completed at least once. */
  loaded: boolean;
  /** Re-read settings.yaml and update both the context + the mirror. Call after the toggle saves. */
  refresh: () => Promise<void>;
}

const WritingModeContext = createContext<WritingModeContextValue | null>(null);

export function WritingModeProvider({ children }: { children: ReactNode }) {
  // Synchronous seed from the mirror → correct on frame 1, no async-default-'full' race.
  const [mode, setMode] = useState<WritingMode>(() => readWritingModeMirror());
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getWritingMode(); // settings.yaml is the source of truth
      setMode(next);
      writeWritingModeMirror(next); // reconcile the mirror toward truth
    } catch {
      // engine not initialized yet (e.g. onboarding) — keep the mirror seed
    } finally {
      setLoaded(true);
    }
  }, []);

  // Reconcile against settings.yaml once on mount (corrects out-of-band drift).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<WritingModeContextValue>(
    () => ({ mode, isSimple: mode === "simple", loaded, refresh }),
    [mode, loaded, refresh],
  );

  return <WritingModeContext.Provider value={value}>{children}</WritingModeContext.Provider>;
}

/**
 * Read the runtime writing mode. Outside a provider it returns a safe `'full'` default
 * (zero-churn: an un-wrapped render behaves exactly like today's full-mode app).
 */
export function useWritingMode(): WritingModeContextValue {
  const ctx = useContext(WritingModeContext);
  if (!ctx) {
    return { mode: "full", isSimple: false, loaded: true, refresh: async () => {} };
  }
  return ctx;
}
