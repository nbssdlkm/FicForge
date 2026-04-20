// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearOnboardingDismissedForSession,
  isOnboardingCompleted,
  isOnboardingDismissedForSession,
  markOnboardingDismissedForSession,
} from "../OnboardingFlow";

type MemoryStorage = Storage & {
  clear: () => void;
};

function createMemoryStorage(): MemoryStorage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("Onboarding session dismissal helpers", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
  });

  it("tracks skip dismissal in session storage without marking onboarding complete", () => {
    expect(isOnboardingCompleted()).toBe(false);
    expect(isOnboardingDismissedForSession()).toBe(false);

    markOnboardingDismissedForSession();

    expect(isOnboardingDismissedForSession()).toBe(true);
    expect(isOnboardingCompleted()).toBe(false);

    clearOnboardingDismissedForSession();

    expect(isOnboardingDismissedForSession()).toBe(false);
  });
});
