// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** Bilingual prompt routing. */

import type { PromptModule } from "./keys.js";
import { REQUIRED_KEYS } from "./keys.js";
import en from "./en.js";
import zh from "./zh.js";

export type { PromptKey, PromptModule } from "./keys.js";
export { REQUIRED_KEYS } from "./keys.js";

/**
 * Return the prompt module for the given language.
 *
 * Validates that all keys defined in REQUIRED_KEYS are present.
 * Throws on startup if any key is missing.
 */
export function getPrompts(language: "zh" | "en" = "zh"): PromptModule {
  const mod = language === "en" ? en : zh;

  const missing = REQUIRED_KEYS.filter((k) => !(k in mod));
  if (missing.length > 0) {
    throw new Error(
      `Prompt module '${language}' is missing ${missing.length} required key(s): ` +
        `${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "..." : ""}`,
    );
  }

  return mod;
}
