// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { SettingsChatToolCall } from "../../../api/engine-client";

export type SettingsMode = "au" | "fandom";
export type ToolCallStatus = "pending" | "executed" | "skipped" | "undone" | "error";
export type LargeTextIntent = "character" | "worldbuilding" | "instruction";

// 真相源在引擎 domain/simple_chat.ts（它随简版 tool-call 消息持久化进 chat.yaml，
// 是领域数据；settings-chat 的内存卡片状态共用同一形状）。import + re-export 保
// 本文件内使用与外部 import 路径都不变。
import type { ToolUndoMeta } from "@ficforge/engine";
export type { ToolUndoMeta };

export interface ToolCallCardState {
  id: string;
  toolCall: SettingsChatToolCall;
  parsedArgs: Record<string, unknown>;
  parseError: string | null;
  status: ToolCallStatus;
  isLoading: boolean;
  resultNote: string | null;
  errorMessage: string | null;
  undoMeta: ToolUndoMeta | null;
}

export interface SettingsChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  requestContent?: string;
  toolCalls?: ToolCallCardState[];
}

export interface LoreFileOption {
  name: string;
  filename: string;
}

import {
  EmotionStyle,
  FACT_TYPE_VALUES,
  FACT_STATUS_VALUES,
  NARRATIVE_WEIGHT_VALUES,
  Perspective,
} from "../../../api/engine-client";
// 单一真相源（盲审 R3 M9）：同名文件「是否已存在」的规范化判据 —— 与 lore 新建路径
// （useAuLoreActions / useFandomLoreEditor / 移动端）共用同一函数，避免两处漂移后
// 「是否已存在」结论不一、静默覆盖用户文件。
import { toCanonicalCreateKey } from "../../library/lore-utils";

export const FACT_TYPE_OPTIONS = FACT_TYPE_VALUES;
export const FACT_STATUS_OPTIONS = FACT_STATUS_VALUES;
export const FACT_CREATE_STATUS_OPTIONS = ["active", "unresolved"] as const;
export const NARRATIVE_WEIGHT_OPTIONS = NARRATIVE_WEIGHT_VALUES;
export function coerceString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function coerceStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}

export function normalizeMarkdownFilename(value: string): string {
  const trimmed = value.trim().replace(/\.md$/i, "");
  // 防止路径穿越
  const safe = trimmed
    .replace(/[\/\\]/g, "")
    .replace(/\.\./g, "")
    .replace(/^\.+/, "")
    .trim();
  return `${safe || "untitled"}.md`;
}

function hasUsableMarkdownStem(value: unknown): boolean {
  return coerceString(value).trim().replace(/\.md$/i, "").trim().length > 0;
}

export function getToolOverwriteWarning(
  source: SettingsChatToolCall | ToolCallCardState | string,
  args: Record<string, unknown>,
  existingCharacterFileNames: Set<string>,
  existingWorldbuildingFileNames: Set<string>,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const toolName = typeof source === "string" ? source : getToolCallName(source);
  const existingCharacterKeys = new Set(Array.from(existingCharacterFileNames, (name) => toCanonicalCreateKey(name)));
  const existingWorldbuildingKeys = new Set(
    Array.from(existingWorldbuildingFileNames, (name) => toCanonicalCreateKey(name)),
  );

  if (toolName === "create_character_file" || toolName === "create_core_character_file") {
    const fileName = normalizeMarkdownFilename(coerceString(args.name));
    if (existingCharacterKeys.has(toCanonicalCreateKey(fileName))) {
      return t("settingsMode.warning.existingFile", { name: fileName });
    }
  }

  if (toolName === "create_worldbuilding_file") {
    const fileName = normalizeMarkdownFilename(coerceString(args.name));
    if (existingWorldbuildingKeys.has(toCanonicalCreateKey(fileName))) {
      return t("settingsMode.warning.existingFile", { name: fileName });
    }
  }

  return null;
}

export function getToolMissingTargetError(
  source: SettingsChatToolCall | ToolCallCardState | string,
  args: Record<string, unknown>,
  existingCharacterFileNames: Set<string>,
  existingWorldbuildingFileNames: Set<string>,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const toolName = typeof source === "string" ? source : getToolCallName(source);

  if (toolName === "modify_character_file" || toolName === "modify_core_character_file") {
    const fileName = normalizeMarkdownFilename(coerceString(args.filename));
    if (!existingCharacterFileNames.has(fileName)) {
      return t("settingsMode.validation.targetFileMissing", { name: fileName });
    }
  }

  if (toolName === "modify_worldbuilding_file") {
    const fileName = normalizeMarkdownFilename(coerceString(args.filename));
    if (!existingWorldbuildingFileNames.has(fileName)) {
      return t("settingsMode.validation.targetFileMissing", { name: fileName });
    }
  }

  return null;
}

export function getToolDuplicateWarning(
  source: SettingsChatToolCall | ToolCallCardState | string,
  args: Record<string, unknown>,
  existingPinnedTexts: string[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const toolName = typeof source === "string" ? source : getToolCallName(source);

  if (toolName === "add_pinned_context") {
    const content = coerceString(args.content).trim();
    if (content && existingPinnedTexts.some((item) => item.trim() === content)) {
      return t("settingsMode.warning.duplicatePinned");
    }
  }

  return null;
}

export function toPreviewText(value: string, maxChars = 200): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}…`;
}

export function getToolCallName(source: SettingsChatToolCall | ToolCallCardState): string {
  return "toolCall" in source ? source.toolCall.function.name : source.function.name;
}

export function getToolValidationError(
  source: SettingsChatToolCall | ToolCallCardState | string,
  args: Record<string, unknown>,
  t: (key: string, options?: Record<string, unknown>) => string,
  availableCharacterNames?: Set<string>,
): string | null {
  const toolName = typeof source === "string" ? source : getToolCallName(source);
  const importance = coerceString(args.importance);
  const factType = coerceString(args.fact_type) || coerceString(args.type);
  const factStatus = coerceString(args.status);
  const narrativeWeight = coerceString(args.narrative_weight);

  if (
    toolName === "create_character_file" ||
    toolName === "create_core_character_file" ||
    toolName === "create_worldbuilding_file"
  ) {
    if (!hasUsableMarkdownStem(args.name)) {
      return t("settingsMode.validation.nameRequired");
    }
    if (!coerceString(args.content).trim()) {
      return t("settingsMode.validation.contentRequired");
    }
    if (toolName === "create_character_file" && importance && !["main", "supporting", "minor"].includes(importance)) {
      return t("settingsMode.validation.importanceInvalid");
    }
    return null;
  }

  if (
    toolName === "modify_character_file" ||
    toolName === "modify_core_character_file" ||
    toolName === "modify_worldbuilding_file"
  ) {
    if (!hasUsableMarkdownStem(args.filename)) {
      return t("settingsMode.validation.filenameRequired");
    }
    if (!coerceString(args.new_content).trim()) {
      return t("settingsMode.validation.contentRequired");
    }
    return null;
  }

  if (toolName === "add_fact") {
    if (!coerceString(args.content_raw).trim() && !coerceString(args.content_clean).trim()) {
      return t("settingsMode.validation.factContentRequired");
    }
    if (!factType.trim()) {
      return t("settingsMode.validation.factTypeRequired");
    }
    if (!coerceString(args.status).trim()) {
      return t("settingsMode.validation.factStatusRequired");
    }
    if (!FACT_TYPE_OPTIONS.includes(factType as (typeof FACT_TYPE_OPTIONS)[number])) {
      return t("settingsMode.validation.factTypeInvalid");
    }
    if (!FACT_CREATE_STATUS_OPTIONS.includes(factStatus as (typeof FACT_CREATE_STATUS_OPTIONS)[number])) {
      return t("settingsMode.validation.factStatusInvalid");
    }
    if (
      narrativeWeight &&
      !NARRATIVE_WEIGHT_OPTIONS.includes(narrativeWeight as (typeof NARRATIVE_WEIGHT_OPTIONS)[number])
    ) {
      return t("settingsMode.validation.narrativeWeightInvalid");
    }
    return null;
  }

  if (toolName === "modify_fact") {
    if (!coerceString(args.fact_id).trim()) {
      return t("settingsMode.validation.factIdRequired");
    }
    const hasAnyField =
      Object.prototype.hasOwnProperty.call(args, "content_raw") ||
      Object.prototype.hasOwnProperty.call(args, "content_clean") ||
      Object.prototype.hasOwnProperty.call(args, "characters") ||
      Object.prototype.hasOwnProperty.call(args, "fact_type") ||
      Object.prototype.hasOwnProperty.call(args, "type") ||
      Object.prototype.hasOwnProperty.call(args, "narrative_weight") ||
      Object.prototype.hasOwnProperty.call(args, "status");
    if (!hasAnyField) {
      return t("settingsMode.validation.factChangesRequired");
    }
    if (
      (Object.prototype.hasOwnProperty.call(args, "fact_type") || Object.prototype.hasOwnProperty.call(args, "type")) &&
      !factType
    ) {
      return t("settingsMode.validation.factTypeRequired");
    }
    if (Object.prototype.hasOwnProperty.call(args, "status") && !factStatus) {
      return t("settingsMode.validation.factStatusRequired");
    }
    if (Object.prototype.hasOwnProperty.call(args, "narrative_weight") && !narrativeWeight) {
      return t("settingsMode.validation.narrativeWeightRequired");
    }
    if (factType && !FACT_TYPE_OPTIONS.includes(factType as (typeof FACT_TYPE_OPTIONS)[number])) {
      return t("settingsMode.validation.factTypeInvalid");
    }
    if (factStatus && !FACT_STATUS_OPTIONS.includes(factStatus as (typeof FACT_STATUS_OPTIONS)[number])) {
      return t("settingsMode.validation.factStatusInvalid");
    }
    if (
      narrativeWeight &&
      !NARRATIVE_WEIGHT_OPTIONS.includes(narrativeWeight as (typeof NARRATIVE_WEIGHT_OPTIONS)[number])
    ) {
      return t("settingsMode.validation.narrativeWeightInvalid");
    }
    return null;
  }

  if (toolName === "add_pinned_context") {
    if (!coerceString(args.content).trim()) {
      return t("settingsMode.validation.pinnedContentRequired");
    }
    return null;
  }

  if (toolName === "update_writing_style") {
    const field = coerceString(args.field);
    const value = coerceString(args.value);
    if (!field.trim()) {
      return t("settingsMode.validation.styleFieldRequired");
    }
    if (field !== "custom_instructions" && !value.trim()) {
      return t("settingsMode.validation.styleValueRequired");
    }
    if (!["perspective", "emotion_style", "custom_instructions"].includes(field)) {
      return t("settingsMode.validation.styleFieldInvalid");
    }
    if (field === "perspective" && !Object.values(Perspective).includes(value as Perspective)) {
      return t("settingsMode.validation.stylePerspectiveInvalid");
    }
    if (field === "emotion_style" && !Object.values(EmotionStyle).includes(value as EmotionStyle)) {
      return t("settingsMode.validation.styleEmotionInvalid");
    }
    return null;
  }

  if (toolName === "update_core_includes") {
    if (!Array.isArray(args.filenames)) {
      return t("settingsMode.validation.coreIncludesRequired");
    }
    if (availableCharacterNames) {
      const selections = coerceStringArray(args.filenames)
        .map((item) => item.replace(/\.md$/i, "").trim())
        .filter(Boolean);
      if (selections.length === 0) {
        return t("settingsMode.validation.coreIncludesRequired");
      }
      const validSelections = selections.filter((item) => availableCharacterNames.has(item));
      if (validSelections.length === 0) {
        return t("settingsMode.validation.coreIncludesAllMissing");
      }
    }
    return null;
  }

  return null;
}

export function safeParseToolArguments(argumentsText: string): {
  parsedArgs: Record<string, unknown>;
  parseError: string | null;
} {
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        parsedArgs: parsed as Record<string, unknown>,
        parseError: null,
      };
    }
  } catch {
    // ignore
  }

  return {
    parsedArgs: {},
    parseError: "INVALID_TOOL_ARGUMENTS",
  };
}

export function createToolCallCardState(toolCall: SettingsChatToolCall): ToolCallCardState {
  const parsed = safeParseToolArguments(toolCall.function.arguments);
  return {
    id: toolCall.id || `${toolCall.function.name}-${Math.random().toString(36).slice(2, 8)}`,
    toolCall,
    parsedArgs: parsed.parsedArgs,
    parseError: parsed.parseError,
    status: "pending",
    isLoading: false,
    resultNote: null,
    errorMessage: null,
    undoMeta: null,
  };
}

export function isToolCallResolved(status: ToolCallStatus): boolean {
  return status === "executed" || status === "skipped" || status === "undone";
}

export function getToolStatusSummary(
  card: ToolCallCardState,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const name = getToolCallName(card);
  if (card.status === "executed") return t("settingsMode.statusSummary.executed", { name });
  if (card.status === "skipped") return t("settingsMode.statusSummary.skipped", { name });
  if (card.status === "undone") return t("settingsMode.statusSummary.undone", { name });
  return null;
}
