// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * WriterLayout 的持久化存储工具。
 * 从 WriterLayout.tsx 抽取，集中管理续写页面的 localStorage 读写。
 */

import { RAG_COLLECTIONS, type ContextSummary, type RagChunkDetail } from "../api/engine-client";

// ---------------------------------------------------------------------------
// 存储键
// ---------------------------------------------------------------------------

const FACTS_PROMPT_STORAGE_KEY = "ficforge.writer.skipFactsPrompt";
const SETTINGS_MODE_TOOLTIP_STORAGE_KEY = "ficforge.writer.settingsModeTipSeen";

function getInstructionTextStorageKey(auPath: string, chapterNum: number): string {
  return `ficforge.writer.instructionText:${auPath}:${chapterNum}`;
}

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

const VALID_RAG_COLLECTIONS = new Set<string>(RAG_COLLECTIONS);

function normalizeRagChunk(value: unknown): RagChunkDetail | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Partial<RagChunkDetail>;
  if (typeof c.content !== "string") return null;
  if (typeof c.score !== "number" || !Number.isFinite(c.score)) return null;
  if (typeof c.collection !== "string" || !VALID_RAG_COLLECTIONS.has(c.collection)) return null;
  const out: RagChunkDetail = {
    content: c.content,
    collection: c.collection as RagChunkDetail["collection"],
    score: c.score,
  };
  if (typeof c.chapter_num === "number" && Number.isFinite(c.chapter_num) && c.chapter_num > 0) {
    out.chapter_num = c.chapter_num;
  }
  if (typeof c.source_file === "string" && c.source_file) {
    out.source_file = c.source_file;
  }
  return out;
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
    rag_chunks: Array.isArray(candidate.rag_chunks)
      ? candidate.rag_chunks
          .map(normalizeRagChunk)
          .filter((c): c is RagChunkDetail => c !== null)
      : [],
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

  try {
    if (Object.keys(summaries).length === 0) {
      window.localStorage.removeItem(getContextSummaryStorageKey(auPath, chapterNum));
      return;
    }

    window.localStorage.setItem(
      getContextSummaryStorageKey(auPath, chapterNum),
      JSON.stringify(summaries),
    );
  } catch {
    // localStorage 可能在 iOS 隐私模式或容量满时抛异常，不阻断主流程
  }
}

// ---------------------------------------------------------------------------
// Instruction Text 持久化（用户输入的续写指令）
// ---------------------------------------------------------------------------

export function readSavedInstructionText(auPath: string, chapterNum: number): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(getInstructionTextStorageKey(auPath, chapterNum)) || "";
  } catch {
    return "";
  }
}

export function saveInstructionText(auPath: string, chapterNum: number, text: string): void {
  if (typeof window === "undefined") return;
  try {
    if (!text.trim()) {
      window.localStorage.removeItem(getInstructionTextStorageKey(auPath, chapterNum));
      return;
    }
    window.localStorage.setItem(getInstructionTextStorageKey(auPath, chapterNum), text);
  } catch {}
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

  try {
    window.localStorage.setItem(
      getGenerateRequestStorageKey(auPath, chapterNum),
      JSON.stringify(request),
    );
  } catch {
    // localStorage 可能在 iOS 隐私模式或容量满时抛异常，不阻断主流程
  }
}

// ---------------------------------------------------------------------------
// UI 状态标记
// ---------------------------------------------------------------------------

export function getSkipFactsPromptDefault(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FACTS_PROMPT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSkipFactsPromptPersisted(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(FACTS_PROMPT_STORAGE_KEY, "1");
      return;
    }
    window.localStorage.removeItem(FACTS_PROMPT_STORAGE_KEY);
  } catch {
    // localStorage 可能在受限环境下抛异常，不阻断主流程
  }
}

export function hasSeenSettingsModeTooltip(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SETTINGS_MODE_TOOLTIP_STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markSettingsModeTooltipSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_MODE_TOOLTIP_STORAGE_KEY, "1");
  } catch {
    // localStorage 可能在受限环境下抛异常，不阻断主流程
  }
}
