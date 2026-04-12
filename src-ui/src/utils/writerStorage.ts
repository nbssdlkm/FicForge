// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * WriterLayout 的持久化存储工具。
 * 从 WriterLayout.tsx 抽取，集中管理续写页面的 localStorage 读写。
 */

import type { ContextSummary } from "../api/engine-client";

// ---------------------------------------------------------------------------
// 存储键
// ---------------------------------------------------------------------------

const FACTS_PROMPT_STORAGE_KEY = "ficforge.writer.skipFactsPrompt";
const SETTINGS_MODE_TOOLTIP_STORAGE_KEY = "ficforge.writer.settingsModeTipSeen";

function getGenerateRequestStorageKey(auPath: string, chapterNum: number): string {
  return `ficforge.writer.generateRequest:${auPath}:${chapterNum}`;
}

function getContextSummaryStorageKey(auPath: string, chapterNum: number): string {
  return `ficforge.writer.contextSummary:${auPath}:${chapterNum}`;
}

// ---------------------------------------------------------------------------
// 类型与校验
// ---------------------------------------------------------------------------

export type GenerateRequestState = {
  inputType: "continue" | "instruction";
  userInput: string;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function normalizeContextSummary(value: unknown): ContextSummary | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<ContextSummary>;
  if (
    !isStringArray(candidate.characters_used)
    || !isStringArray(candidate.worldbuilding_used)
    || !isStringArray(candidate.facts_as_focus)
    || !isStringArray(candidate.truncated_layers)
    || !isStringArray(candidate.truncated_characters)
    || typeof candidate.facts_injected !== "number"
    || typeof candidate.pinned_count !== "number"
    || typeof candidate.rag_chunks_retrieved !== "number"
    || typeof candidate.total_input_tokens !== "number"
  ) {
    return null;
  }

  return {
    characters_used: candidate.characters_used,
    worldbuilding_used: candidate.worldbuilding_used,
    facts_injected: candidate.facts_injected,
    facts_as_focus: candidate.facts_as_focus,
    pinned_count: candidate.pinned_count,
    rag_chunks_retrieved: candidate.rag_chunks_retrieved,
    total_input_tokens: candidate.total_input_tokens,
    truncated_layers: candidate.truncated_layers,
    truncated_characters: candidate.truncated_characters,
  };
}

// ---------------------------------------------------------------------------
// Context Summary 持久化
// ---------------------------------------------------------------------------

export function readSavedContextSummaries(auPath: string, chapterNum: number): Record<string, ContextSummary> {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(getContextSummaryStorageKey(auPath, chapterNum));
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(parsed).reduce<Record<string, ContextSummary>>((accumulator, [label, value]) => {
      const summary = normalizeContextSummary(value);
      if (summary) {
        accumulator[label] = summary;
      }
      return accumulator;
    }, {});
  } catch {
    return {};
  }
}

export function saveContextSummaries(
  auPath: string,
  chapterNum: number,
  summaries: Record<string, ContextSummary>,
): void {
  if (typeof window === "undefined") return;

  if (Object.keys(summaries).length === 0) {
    window.localStorage.removeItem(getContextSummaryStorageKey(auPath, chapterNum));
    return;
  }

  window.localStorage.setItem(
    getContextSummaryStorageKey(auPath, chapterNum),
    JSON.stringify(summaries),
  );
}

// ---------------------------------------------------------------------------
// Generate Request 持久化
// ---------------------------------------------------------------------------

export function readSavedGenerateRequest(auPath: string, chapterNum: number): GenerateRequestState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getGenerateRequestStorageKey(auPath, chapterNum));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GenerateRequestState>;
    if (
      (parsed.inputType === "continue" || parsed.inputType === "instruction")
      && typeof parsed.userInput === "string"
    ) {
      return {
        inputType: parsed.inputType,
        userInput: parsed.userInput,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function saveGenerateRequest(auPath: string, chapterNum: number, request: GenerateRequestState): void {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    getGenerateRequestStorageKey(auPath, chapterNum),
    JSON.stringify(request),
  );
}

// ---------------------------------------------------------------------------
// UI 状态标记
// ---------------------------------------------------------------------------

export function getSkipFactsPromptDefault(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(FACTS_PROMPT_STORAGE_KEY) === "1";
}

export function setSkipFactsPromptPersisted(value: boolean): void {
  if (typeof window === "undefined") return;
  if (value) {
    window.localStorage.setItem(FACTS_PROMPT_STORAGE_KEY, "1");
    return;
  }
  window.localStorage.removeItem(FACTS_PROMPT_STORAGE_KEY);
}

export function hasSeenSettingsModeTooltip(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(SETTINGS_MODE_TOOLTIP_STORAGE_KEY) === "1";
}

export function markSettingsModeTooltipSeen(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETTINGS_MODE_TOOLTIP_STORAGE_KEY, "1");
}
