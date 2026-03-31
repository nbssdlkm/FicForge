import type { SettingsChatToolCall } from "../../../api/settingsChat";

export type SettingsMode = "au" | "fandom";
export type ToolCallStatus = "pending" | "executed" | "skipped" | "undone" | "error";
export type LargeTextIntent = "character" | "worldbuilding" | "instruction";

export interface ToolUndoMeta {
  kind: "lore" | "fact" | "pinned" | "unsupported";
  category?: string;
  filename?: string;
  factId?: string;
  pinnedIndex?: number;
  pinnedContent?: string;
  chapterNum?: number;
  note?: string;
}

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
  toolCalls?: ToolCallCardState[];
}

export interface LoreFileOption {
  name: string;
  filename: string;
}

export const VALID_FACT_TYPES = [
  "character_detail",
  "relationship",
  "backstory",
  "plot_event",
  "foreshadowing",
  "world_rule",
] as const;

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
  return `${trimmed || "untitled"}.md`;
}

function hasUsableMarkdownStem(value: unknown): boolean {
  return coerceString(value).trim().replace(/\.md$/i, "").trim().length > 0;
}

function toCanonicalCreateKey(value: string): string {
  return value
    .trim()
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "_");
}

export function getToolOverwriteWarning(
  source: SettingsChatToolCall | ToolCallCardState | string,
  args: Record<string, unknown>,
  existingCharacterFileNames: Set<string>,
  existingWorldbuildingFileNames: Set<string>,
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  const toolName = typeof source === "string" ? source : getToolCallName(source);
  const existingCharacterKeys = new Set(
    Array.from(existingCharacterFileNames, (name) => toCanonicalCreateKey(name))
  );
  const existingWorldbuildingKeys = new Set(
    Array.from(existingWorldbuildingFileNames, (name) => toCanonicalCreateKey(name))
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
  t: (key: string, options?: Record<string, unknown>) => string
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
  t: (key: string, options?: Record<string, unknown>) => string
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
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  const toolName = typeof source === "string" ? source : getToolCallName(source);
  const importance = coerceString(args.importance);
  const factType = coerceString(args.fact_type) || coerceString(args.type);
  const factStatus = coerceString(args.status);
  const narrativeWeight = coerceString(args.narrative_weight);

  if (
    toolName === "create_character_file"
    || toolName === "create_core_character_file"
    || toolName === "create_worldbuilding_file"
  ) {
    if (!hasUsableMarkdownStem(args.name)) {
      return t("settingsMode.validation.nameRequired");
    }
    if (!coerceString(args.content).trim()) {
      return t("settingsMode.validation.contentRequired");
    }
    if (toolName === "create_character_file" && importance && !["high", "medium", "low"].includes(importance)) {
      return t("settingsMode.validation.importanceInvalid");
    }
    return null;
  }

  if (
    toolName === "modify_character_file"
    || toolName === "modify_core_character_file"
    || toolName === "modify_worldbuilding_file"
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
    if (!VALID_FACT_TYPES.includes(factType as typeof VALID_FACT_TYPES[number])) {
      return t("settingsMode.validation.factTypeInvalid");
    }
    if (!["active", "unresolved"].includes(factStatus)) {
      return t("settingsMode.validation.factStatusInvalid");
    }
    if (narrativeWeight && !["low", "medium", "high"].includes(narrativeWeight)) {
      return t("settingsMode.validation.narrativeWeightInvalid");
    }
    return null;
  }

  if (toolName === "modify_fact") {
    if (!coerceString(args.fact_id).trim()) {
      return t("settingsMode.validation.factIdRequired");
    }
    const hasAnyField =
      Object.prototype.hasOwnProperty.call(args, "content_raw")
      || Object.prototype.hasOwnProperty.call(args, "content_clean")
      || Object.prototype.hasOwnProperty.call(args, "characters")
      || Object.prototype.hasOwnProperty.call(args, "fact_type")
      || Object.prototype.hasOwnProperty.call(args, "type")
      || Object.prototype.hasOwnProperty.call(args, "narrative_weight")
      || Object.prototype.hasOwnProperty.call(args, "status");
    if (!hasAnyField) {
      return t("settingsMode.validation.factChangesRequired");
    }
    if (
      (Object.prototype.hasOwnProperty.call(args, "fact_type")
        || Object.prototype.hasOwnProperty.call(args, "type"))
      && !factType
    ) {
      return t("settingsMode.validation.factTypeRequired");
    }
    if (Object.prototype.hasOwnProperty.call(args, "status") && !factStatus) {
      return t("settingsMode.validation.factStatusRequired");
    }
    if (Object.prototype.hasOwnProperty.call(args, "narrative_weight") && !narrativeWeight) {
      return t("settingsMode.validation.narrativeWeightRequired");
    }
    if (factType && !VALID_FACT_TYPES.includes(factType as typeof VALID_FACT_TYPES[number])) {
      return t("settingsMode.validation.factTypeInvalid");
    }
    if (factStatus && !["active", "unresolved", "resolved", "deprecated"].includes(factStatus)) {
      return t("settingsMode.validation.factStatusInvalid");
    }
    if (narrativeWeight && !["low", "medium", "high"].includes(narrativeWeight)) {
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
    if (field === "perspective" && !["third_person", "first_person"].includes(value)) {
      return t("settingsMode.validation.stylePerspectiveInvalid");
    }
    if (field === "emotion_style" && !["implicit", "explicit"].includes(value)) {
      return t("settingsMode.validation.styleEmotionInvalid");
    }
    return null;
  }

  if (toolName === "update_core_includes") {
    if (!Array.isArray(args.filenames)) {
      return t("settingsMode.validation.coreIncludesRequired");
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
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  const name = getToolCallName(card);
  if (card.status === "executed") return t("settingsMode.statusSummary.executed", { name });
  if (card.status === "skipped") return t("settingsMode.statusSummary.skipped", { name });
  if (card.status === "undone") return t("settingsMode.statusSummary.undone", { name });
  return null;
}
