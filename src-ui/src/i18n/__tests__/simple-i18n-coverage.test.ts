// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect } from "vitest";
import zh from "../../locales/zh.json";
import en from "../../locales/en.json";

// Anti-silent-Chinese guard (Phase 2 spec §7.2): every simple.* key referenced anywhere in
// src-ui/src (incl. ui/settings/GlobalSettingsModal) must exist in BOTH zh.json and en.json,
// so a missing English translation can never hide behind an inline Chinese defaultValue.
// Scope is the WHOLE src tree — not a hardcoded dir list — and __tests__ are excluded.
const sources = import.meta.glob("../../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function collectSimpleKeys(): string[] {
  const keys = new Set<string>();
  const re = /\bt\(\s*['"](simple\.[A-Za-z0-9_.]+)['"]/g;
  for (const [path, content] of Object.entries(sources)) {
    if (path.includes("__tests__")) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) keys.add(m[1]);
  }
  return [...keys].sort();
}

function resolve(obj: unknown, dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

describe("simple.* i18n coverage", () => {
  const keys = collectSimpleKeys();

  it("finds a substantial simple.* key surface", () => {
    expect(keys.length).toBeGreaterThan(80);
  });

  it("every referenced simple.* key exists in zh.json", () => {
    const missing = keys.filter((k) => typeof resolve(zh, k) !== "string");
    expect(missing).toEqual([]);
  });

  it("every referenced simple.* key exists in en.json", () => {
    const missing = keys.filter((k) => typeof resolve(en, k) !== "string");
    expect(missing).toEqual([]);
  });
});
