// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Platform detection utilities.
 * Centralizes Tauri / Capacitor / Web environment checks
 * so callers don't need `(window as any)` casts.
 */

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

interface CapacitorWindow {
  Capacitor?: CapacitorGlobal;
}

/** Returns true when running inside a Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== "undefined"
    && !!(window as unknown as TauriWindow).__TAURI_INTERNALS__;
}

/** Returns true when running inside a Capacitor native shell (Android/iOS). */
export function isCapacitor(): boolean {
  const cap = (window as unknown as CapacitorWindow).Capacitor;
  return cap !== undefined && !!cap.isNativePlatform?.();
}
