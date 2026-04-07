// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { sendSettingsChat, type SettingsChatSessionLlm } from "../../../api/settingsChat";
import { addFact, editFact, updateFactStatus } from "../../../api/facts";
import { deleteLore, listLoreFiles, saveLore } from "../../../api/lore";
import { addPinned, deletePinned, getProject, updateProject, type ProjectInfo } from "../../../api/project";
import { useFeedback } from "../../../hooks/useFeedback";
import { useTranslation } from "../../../i18n/useAppTranslation";
import { SettingsChatHistory } from "./SettingsChatHistory";
import { SettingsChatInput } from "./SettingsChatInput";
import {
  coerceString,
  coerceStringArray,
  createToolCallCardState,
  getToolDuplicateWarning,
  getToolCallName,
  getToolMissingTargetError,
  getToolOverwriteWarning,
  getToolStatusSummary,
  getToolValidationError,
  isToolCallResolved,
  normalizeMarkdownFilename,
  type LargeTextIntent,
  type LoreFileOption,
  type SettingsChatMessage,
  type SettingsMode,
  type ToolCallCardState,
  type ToolUndoMeta,
} from "./types";

interface SettingsChatPanelProps {
  mode: SettingsMode;
  basePath?: string;
  fandomPath?: string;
  placeholder: string;
  title?: string;
  compact?: boolean;
  currentChapter?: number;
  className?: string;
  sessionLlm?: SettingsChatSessionLlm | null;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onAfterMutation?: () => void | Promise<void>;
}

const MESSAGE_STORAGE_PREFIX = "settings-mode";
const CHARACTER_FRONTMATTER_KEYS = ["name", "aliases", "importance", "origin_ref"] as const;
const CORE_CHARACTER_FRONTMATTER_KEYS = ["name"] as const;

type ManagedFrontmatterKey = typeof CHARACTER_FRONTMATTER_KEYS[number];

function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function coerceTrimmedString(value: unknown): string {
  return coerceString(value).trim();
}

function normalizeDisplayName(value: unknown): string {
  return coerceTrimmedString(value).replace(/\.md$/i, "").trim();
}

function splitYamlFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const normalized = content.replace(/\r\n/g, "\n").trimStart();
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: null, body: normalized };
  }
  return {
    frontmatter: match[1],
    body: normalized.slice(match[0].length),
  };
}

function pruneManagedFrontmatter(frontmatter: string, managedKeys: Set<ManagedFrontmatterKey>): string[] {
  const lines = frontmatter.split("\n");
  const result: string[] = [];
  let skippingAliasItems = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (skippingAliasItems) {
      if (/^\s*-\s+/.test(line) || trimmed === "") {
        continue;
      }
      skippingAliasItems = false;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_]+)\s*:/);
    const key = keyMatch?.[1] as ManagedFrontmatterKey | undefined;

    if (key && managedKeys.has(key)) {
      if (key === "aliases" && /^\s*aliases\s*:\s*$/.test(line)) {
        skippingAliasItems = true;
      }
      continue;
    }

    result.push(line);
  }

  while (result.length > 0 && result[0].trim() === "") result.shift();
  while (result.length > 0 && result[result.length - 1].trim() === "") result.pop();

  return result;
}

function buildManagedFrontmatterLines(
  fields: Record<string, unknown>,
  managedKeys: readonly ManagedFrontmatterKey[]
): string[] {
  const lines: string[] = [];
  const name = coerceTrimmedString(fields.name);
  const aliases = coerceStringArray(fields.aliases);
  const importance = coerceString(fields.importance);
  const originRef = coerceTrimmedString(fields.origin_ref);

  if (managedKeys.includes("name") && name) lines.push(`name: ${JSON.stringify(name)}`);
  if (managedKeys.includes("aliases") && aliases.length > 0) {
    lines.push("aliases:");
    aliases.forEach((alias) => {
      lines.push(`  - ${JSON.stringify(alias)}`);
    });
  }
  if (managedKeys.includes("importance") && importance) lines.push(`importance: ${importance}`);
  if (managedKeys.includes("origin_ref") && originRef) lines.push(`origin_ref: ${JSON.stringify(originRef)}`);

  return lines;
}

function applyManagedFrontmatter(
  content: string,
  fields: Record<string, unknown>,
  managedKeys: readonly ManagedFrontmatterKey[]
): string {
  const { frontmatter, body } = splitYamlFrontmatter(content);
  const managedKeySet = new Set<ManagedFrontmatterKey>(managedKeys);
  const preservedLines = frontmatter ? pruneManagedFrontmatter(frontmatter, managedKeySet) : [];
  const managedLines = buildManagedFrontmatterLines(fields, managedKeys);
  const nextFrontmatter = [...managedLines];

  if (preservedLines.length > 0) {
    if (nextFrontmatter.length > 0) {
      nextFrontmatter.push("");
    }
    nextFrontmatter.push(...preservedLines);
  }

  if (nextFrontmatter.length === 0) {
    return body;
  }

  return ["---", ...nextFrontmatter, "---", "", body.trimStart()].join("\n");
}

function buildOutboundUserMessage(
  rawInput: string,
  intent: LargeTextIntent,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (intent === "character") {
    return [
      t("settingsMode.prompt.largeTextCharacter"),
      rawInput,
    ].join("\n\n");
  }

  if (intent === "worldbuilding") {
    return [
      t("settingsMode.prompt.largeTextWorldbuilding"),
      rawInput,
    ].join("\n\n");
  }

  return rawInput;
}

function serializeAssistantMessage(
  message: SettingsChatMessage,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const toolSummaries = (message.toolCalls || []).map((card) => {
    const args = Object.entries(card.parsedArgs)
      .slice(0, 4)
      .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(t("common.listSeparator")) : String(value)}`)
      .join(t("common.listComma"));
    return `${getToolCallName(card)}${args ? `${t("common.parenOpen")}${args}${t("common.parenClose")}` : ""}`;
  });
  const summaries = (message.toolCalls || [])
    .map((card) => getToolStatusSummary(card, t))
    .filter((item): item is string => Boolean(item));

  const parts = [message.content];
  if (toolSummaries.length > 0) {
    parts.push(t("settingsMode.historyPreviousTools", { tools: `- ${toolSummaries.join("\n- ")}` }));
  }
  if (summaries.length > 0) {
    parts.push(t("settingsMode.historyProcessedTools", { tools: `- ${summaries.join("\n- ")}` }));
  }
  return parts.filter(Boolean).join("\n\n");
}

function toApiMessages(
  messages: SettingsChatMessage[],
  t: (key: string, options?: Record<string, unknown>) => string
): { role: "user" | "assistant"; content: string }[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.role === "assistant" ? serializeAssistantMessage(message, t) : message.content,
  }));
}

function normalizeCoreIncludes(value: unknown): string[] {
  return Array.from(
    new Set(
      coerceStringArray(value)
        .map((item) => item.trim().replace(/\.md$/i, ""))
        .filter(Boolean)
    )
  );
}

function normalizeAvailableCharacterNames(files: LoreFileOption[]): Set<string> {
  return new Set(files.map((file) => file.name.trim()).filter(Boolean));
}

export function SettingsChatPanel({
  mode,
  basePath,
  fandomPath,
  placeholder,
  title,
  compact = false,
  currentChapter = 1,
  className = "",
  sessionLlm = null,
  disabled = false,
  onBusyChange,
  onAfterMutation,
}: SettingsChatPanelProps) {
  const { t } = useTranslation();
  const { showError, showToast } = useFeedback();
  const [messages, setMessages] = useState<SettingsChatMessage[]>([]);
  const messagesRef = useRef<SettingsChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [isPostMutationBusy, setPostMutationBusy] = useState(false);
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const projectInfoRef = useRef<ProjectInfo | null>(null);
  const [characterFiles, setCharacterFiles] = useState<LoreFileOption[]>([]);
  const [worldbuildingFiles, setWorldbuildingFiles] = useState<LoreFileOption[]>([]);
  const characterFilesRef = useRef<LoreFileOption[]>([]);
  const worldbuildingFilesRef = useRef<LoreFileOption[]>([]);
  const loadingCardIdsRef = useRef<Set<string>>(new Set());
  const supportDataRequestIdRef = useRef(0);
  const chatRequestIdRef = useRef(0);
  const contextVersionRef = useRef(0);
  const onAfterMutationRef = useRef<typeof onAfterMutation>(onAfterMutation);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    projectInfoRef.current = projectInfo;
  }, [projectInfo]);

  useEffect(() => {
    characterFilesRef.current = characterFiles;
  }, [characterFiles]);

  useEffect(() => {
    worldbuildingFilesRef.current = worldbuildingFiles;
  }, [worldbuildingFiles]);

  useEffect(() => {
    onAfterMutationRef.current = onAfterMutation;
  }, [onAfterMutation]);

  const hasLoadingCards = messages.some((message) =>
    (message.toolCalls || []).some((card) => card.isLoading)
  );
  const mutationBusy = sending || hasLoadingCards || isPostMutationBusy;

  useEffect(() => {
    onBusyChange?.(mutationBusy);
  }, [mutationBusy, onBusyChange]);

  useEffect(() => {
    contextVersionRef.current += 1;
    chatRequestIdRef.current += 1;
    supportDataRequestIdRef.current += 1;
    loadingCardIdsRef.current.clear();
    setSending(false);
    setPostMutationBusy(false);
    setMessages([]);
    setInputText("");
    setProjectInfo(null);
    projectInfoRef.current = null;
    setCharacterFiles([]);
    characterFilesRef.current = [];
    setWorldbuildingFiles([]);
    worldbuildingFilesRef.current = [];
  }, [basePath, mode]);

  const loadSupportData = useCallback(async () => {
    if (!basePath) return;
    const requestId = ++supportDataRequestIdRef.current;

    try {
      if (mode === "au") {
        const [project, characters, worldbuilding] = await Promise.all([
          getProject(basePath).catch(() => null),
          listLoreFiles({ au_path: basePath, category: "characters" }).catch(() => ({ files: [] })),
          listLoreFiles({ au_path: basePath, category: "worldbuilding" }).catch(() => ({ files: [] })),
        ]);
        if (requestId !== supportDataRequestIdRef.current) return;
        setProjectInfo(project);
        setCharacterFiles(characters.files);
        characterFilesRef.current = characters.files;
        setWorldbuildingFiles(worldbuilding.files);
        worldbuildingFilesRef.current = worldbuilding.files;
        return;
      }

      const [characters, worldbuilding] = await Promise.all([
        listLoreFiles({ fandom_path: basePath, category: "core_characters" }).catch(() => ({ files: [] })),
        listLoreFiles({ fandom_path: basePath, category: "core_worldbuilding" }).catch(() => ({ files: [] })),
      ]);
      if (requestId !== supportDataRequestIdRef.current) return;
      setProjectInfo(null);
      setCharacterFiles(characters.files);
      characterFilesRef.current = characters.files;
      setWorldbuildingFiles(worldbuilding.files);
      worldbuildingFilesRef.current = worldbuilding.files;
    } catch (error) {
      if (requestId !== supportDataRequestIdRef.current) return;
      showError(error, t("error_messages.unknown"));
    }
  }, [basePath, mode, showError, t]);

  useEffect(() => {
    void loadSupportData();
  }, [loadSupportData]);

  const updateMessageCards = useCallback((
    messageId: string,
    updater: (cards: ToolCallCardState[]) => ToolCallCardState[]
  ) => {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== messageId || !message.toolCalls) return message;
        return {
          ...message,
          toolCalls: updater(message.toolCalls),
        };
      })
    );
  }, []);

  const updateSingleCard = useCallback((
    messageId: string,
    cardId: string,
    updater: (card: ToolCallCardState) => ToolCallCardState
  ) => {
    updateMessageCards(messageId, (cards) =>
      cards.map((card) => (card.id === cardId ? updater(card) : card))
    );
  }, [updateMessageCards]);

  const runAfterMutation = useCallback(async (expectedContextVersion: number) => {
    await loadSupportData();
    if (expectedContextVersion !== contextVersionRef.current) {
      return;
    }
    if (onAfterMutationRef.current) {
      await onAfterMutationRef.current();
    }
  }, [loadSupportData]);

  const executeTool = useCallback(async (
    card: ToolCallCardState,
    nextArgs?: Record<string, unknown>,
    contextVersion?: number
  ): Promise<{ resultNote: string; undoMeta: ToolUndoMeta | null; warningMessage?: string | null }> => {
    if (!basePath) {
      throw new Error(t("error_messages.unknown"));
    }

    const args = nextArgs || card.parsedArgs;
    const toolName = getToolCallName(card);
    const executionContextVersion = contextVersion ?? contextVersionRef.current;
    let latestCharacterFiles: { files: LoreFileOption[] };
    let latestWorldbuildingFiles: { files: LoreFileOption[] };
    try {
      [latestCharacterFiles, latestWorldbuildingFiles] = await Promise.all(
        mode === "au"
          ? [
              listLoreFiles({ au_path: basePath, category: "characters" }),
              listLoreFiles({ au_path: basePath, category: "worldbuilding" }),
            ]
          : [
              listLoreFiles({ fandom_path: basePath, category: "core_characters" }),
              listLoreFiles({ fandom_path: basePath, category: "core_worldbuilding" }),
            ]
      );
    } catch {
      throw new Error(t("settingsMode.error.supportDataUnavailable"));
    }
    if (executionContextVersion !== contextVersionRef.current) {
      throw new Error("STALE_CONTEXT");
    }
    characterFilesRef.current = latestCharacterFiles.files;
    worldbuildingFilesRef.current = latestWorldbuildingFiles.files;
    const latestCharacterFileNames = new Set(latestCharacterFiles.files.map((file) => file.filename));
    const latestWorldbuildingFileNames = new Set(latestWorldbuildingFiles.files.map((file) => file.filename));
    const availableCharacterNames = normalizeAvailableCharacterNames(latestCharacterFiles.files);
    const validationError = getToolValidationError(card, args, t, availableCharacterNames);
    if (validationError) {
      throw new Error(validationError);
    }
    const missingTargetError = getToolMissingTargetError(
      card,
      args,
      latestCharacterFileNames,
      latestWorldbuildingFileNames,
      t
    );
    if (missingTargetError) {
      throw new Error(missingTargetError);
    }
    const overwriteWarning = getToolOverwriteWarning(
      card,
      args,
      latestCharacterFileNames,
      latestWorldbuildingFileNames,
      t
    );
    if (overwriteWarning) {
      throw new Error(overwriteWarning);
    }
    let ensuredProject: ProjectInfo | null = null;
    if (mode === "au") {
      try {
        ensuredProject = await getProject(basePath);
      } catch {
        throw new Error(t("settingsMode.error.projectUnavailable"));
      }
    }
    if (executionContextVersion !== contextVersionRef.current) {
      throw new Error("STALE_CONTEXT");
    }
    if (ensuredProject) {
      projectInfoRef.current = ensuredProject;
    }
    const duplicateWarning = getToolDuplicateWarning(
      card,
      args,
      ensuredProject?.pinned_context || projectInfoRef.current?.pinned_context || [],
      t
    );
    if (duplicateWarning) {
      throw new Error(duplicateWarning);
    }
    const requireAuProject = (): ProjectInfo => {
      if (!ensuredProject) {
        throw new Error(t("settingsMode.error.projectUnavailable"));
      }
      return ensuredProject;
    };

    if (toolName === "create_character_file") {
      const currentProject = requireAuProject();
      const name = normalizeDisplayName(args.name) || t("common.unknownAu");
      const filename = normalizeMarkdownFilename(name);
      const content = applyManagedFrontmatter(
        coerceString(args.content),
        { ...args, name },
        CHARACTER_FRONTMATTER_KEYS
      );
      await saveLore({ au_path: basePath, category: "characters", filename, content });

      try {
        const nextCharacters = Array.from(
          new Set([...(currentProject.cast_registry.characters || []), name])
        );
        await updateProject(basePath, { cast_registry: { characters: nextCharacters } });
      } catch (error) {
        try {
          await deleteLore({ au_path: basePath, category: "characters", filename });
        } catch {
          throw new Error(
            t("settingsMode.error.createCharacterRollbackFailed", { name: filename })
          );
        }
        throw error;
      }

      return {
        resultNote: t("settingsMode.executedWithTarget", { target: filename }),
        undoMeta: { kind: "lore", category: "characters", filename },
        warningMessage: null,
      };
    }

    if (toolName === "modify_character_file") {
      const filename = normalizeMarkdownFilename(coerceString(args.filename));
      await saveLore({
        au_path: basePath,
        category: "characters",
        filename,
        content: coerceString(args.new_content),
      });
      return {
        resultNote: t("settingsMode.executedWithTarget", { target: filename }),
        undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
        warningMessage: null,
      };
    }

    if (toolName === "create_core_character_file") {
      const name = normalizeDisplayName(args.name) || t("common.unknownFandom");
      const filename = normalizeMarkdownFilename(name);
      await saveLore({
        fandom_path: basePath,
        category: "core_characters",
        filename,
        content: applyManagedFrontmatter(
          coerceString(args.content),
          { ...args, name },
          CORE_CHARACTER_FRONTMATTER_KEYS
        ),
      });
      return {
        resultNote: t("settingsMode.executedWithTarget", { target: filename }),
        undoMeta: { kind: "lore", category: "core_characters", filename },
        warningMessage: null,
      };
    }

    if (toolName === "modify_core_character_file") {
      const filename = normalizeMarkdownFilename(coerceString(args.filename));
      await saveLore({
        fandom_path: basePath,
        category: "core_characters",
        filename,
        content: coerceString(args.new_content),
      });
      return {
        resultNote: t("settingsMode.executedWithTarget", { target: filename }),
        undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
        warningMessage: null,
      };
    }

    if (toolName === "create_worldbuilding_file") {
      const name = coerceTrimmedString(args.name) || t("common.none");
      const filename = normalizeMarkdownFilename(name);
      const request = mode === "au"
        ? { au_path: basePath, category: "worldbuilding", filename, content: coerceString(args.content) }
        : { fandom_path: basePath, category: "core_worldbuilding", filename, content: coerceString(args.content) };
      await saveLore(request);
      return {
        resultNote: t("settingsMode.executedWithTarget", { target: filename }),
        undoMeta: {
          kind: "lore",
          category: mode === "au" ? "worldbuilding" : "core_worldbuilding",
          filename,
        },
        warningMessage: null,
      };
    }

    if (toolName === "modify_worldbuilding_file") {
      const filename = normalizeMarkdownFilename(coerceString(args.filename));
      const request = mode === "au"
        ? { au_path: basePath, category: "worldbuilding", filename, content: coerceString(args.new_content) }
        : { fandom_path: basePath, category: "core_worldbuilding", filename, content: coerceString(args.new_content) };
      await saveLore(request);
      return {
        resultNote: t("settingsMode.executedWithTarget", { target: filename }),
        undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
        warningMessage: null,
      };
    }

    if (toolName === "add_fact") {
      const response = await addFact(basePath, currentChapter, {
        content_raw: coerceString(args.content_raw) || coerceString(args.content_clean),
        content_clean: coerceString(args.content_clean),
        characters: coerceStringArray(args.characters),
        type: coerceString(args.fact_type) || coerceString(args.type) || "plot_event",
        narrative_weight: coerceString(args.narrative_weight) || "medium",
        status: coerceString(args.status) || "active",
      });
      return {
        resultNote: t("settingsMode.executedWithTarget", { target: response.fact_id || t("settingsMode.card.addFact") }),
        undoMeta: {
          kind: "fact",
          factId: response.fact_id,
          chapterNum: currentChapter,
        },
        warningMessage: null,
      };
    }

    if (toolName === "modify_fact") {
      const factId = coerceString(args.fact_id);
      if (!factId) {
        throw new Error(t("settingsMode.error.missingFactId"));
      }

      const updatedFields: Record<string, unknown> = {};
      const contentRaw = coerceString(args.content_raw);
      const contentClean = coerceString(args.content_clean);
      const characters = coerceStringArray(args.characters);
      const type = coerceString(args.fact_type) || coerceString(args.type);
      const weight = coerceString(args.narrative_weight);
      const status = coerceString(args.status);

      if (Object.prototype.hasOwnProperty.call(args, "content_raw")) updatedFields.content_raw = contentRaw;
      if (Object.prototype.hasOwnProperty.call(args, "content_clean")) updatedFields.content_clean = contentClean;
      if (Object.prototype.hasOwnProperty.call(args, "characters")) updatedFields.characters = characters;
      if (
        Object.prototype.hasOwnProperty.call(args, "fact_type")
        || Object.prototype.hasOwnProperty.call(args, "type")
      ) {
        if (type) updatedFields.type = type;
      }
      if (Object.prototype.hasOwnProperty.call(args, "narrative_weight") && weight) updatedFields.narrative_weight = weight;
      if (Object.prototype.hasOwnProperty.call(args, "status") && status) updatedFields.status = status;

      await editFact(basePath, factId, updatedFields);
      return {
        resultNote: t("settingsMode.executedWithTarget", { target: factId }),
        undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
        warningMessage: null,
      };
    }

    if (toolName === "add_pinned_context") {
      const content = coerceString(args.content).trim();
      const index = ensuredProject?.pinned_context.length || 0;
      await addPinned(basePath, content);
      return {
        resultNote: t("settingsMode.executedWithTarget", { target: t("common.labels.pinnedContext") }),
        undoMeta: {
          kind: "pinned",
          pinnedIndex: index,
          pinnedContent: content,
        },
        warningMessage: null,
      };
    }

    if (toolName === "update_writing_style") {
      const currentProject = requireAuProject();
      const field = coerceString(args.field);
      const value = coerceString(args.value);
      const writingStyle = {
        ...(currentProject.writing_style || {}),
        [field]: value,
      };
      await updateProject(basePath, { writing_style: writingStyle });
      return {
        resultNote: t("settingsMode.executedWithTarget", { target: t("common.labels.writingStyle") }),
        undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
        warningMessage: null,
      };
    }

    if (toolName === "update_core_includes") {
      const currentProject = requireAuProject();
      const requestedNames = normalizeCoreIncludes(args.filenames);
      const availableNames = new Set([
        ...latestCharacterFiles.files.map((file) => file.name),
        ...(currentProject.cast_registry.characters || []),
      ]);
      const validNames = requestedNames.filter((name) => availableNames.has(name));
      const missingNames = requestedNames.filter((name) => !availableNames.has(name));

      if (validNames.length === 0) {
        throw new Error(t("settingsMode.error.coreIncludesMissingAll"));
      }

      await updateProject(basePath, { core_always_include: validNames });
      return {
        resultNote: t("settingsMode.executedWithTarget", { target: t("common.labels.coreAlwaysInclude") }),
        undoMeta: { kind: "unsupported", note: t("settingsMode.undoNotSupported") },
        warningMessage: missingNames.length > 0
          ? t("settingsMode.warning.coreIncludesPartialMissing", { names: missingNames.join(t("common.listSeparator")) })
          : null,
      };
    }

    throw new Error(t("settingsMode.error.unsupportedTool", { name: toolName }));
  }, [basePath, currentChapter, mode, t]);

  const handleConfirmTool = useCallback(async (
    messageId: string,
    cardId: string,
    nextArgs?: Record<string, unknown>
  ) => {
    const contextVersion = contextVersionRef.current;
    const message = messagesRef.current.find((item) => item.id === messageId);
    const card = message?.toolCalls?.find((item) => item.id === cardId);
    if (
      disabled
      || sending
      || isPostMutationBusy
      || 
      !card
      || card.isLoading
      || card.parseError
      || loadingCardIdsRef.current.has(cardId)
      || loadingCardIdsRef.current.size > 0
    ) {
      return;
    }

    loadingCardIdsRef.current.add(cardId);

    updateSingleCard(messageId, cardId, (current) => ({
      ...current,
      isLoading: true,
      errorMessage: null,
    }));

    let result: { resultNote: string; undoMeta: ToolUndoMeta | null; warningMessage?: string | null };

    try {
      result = await executeTool(card, nextArgs, contextVersion);
    } catch (error) {
      if (error instanceof Error && error.message === "STALE_CONTEXT") {
        loadingCardIdsRef.current.delete(cardId);
        return;
      }
      if (contextVersion !== contextVersionRef.current) {
        loadingCardIdsRef.current.delete(cardId);
        return;
      }
      updateSingleCard(messageId, cardId, (current) => ({
        ...current,
        isLoading: false,
        status: "error",
        errorMessage: error instanceof Error ? error.message : t("error_messages.unknown"),
      }));
      showError(error, t("error_messages.unknown"));
      loadingCardIdsRef.current.delete(cardId);
      return;
    }

    if (contextVersion !== contextVersionRef.current) {
      loadingCardIdsRef.current.delete(cardId);
      return;
    }

    updateSingleCard(messageId, cardId, (current) => ({
      ...current,
      parsedArgs: nextArgs || current.parsedArgs,
      status: "executed",
      isLoading: false,
      resultNote: result.resultNote,
      undoMeta: result.undoMeta,
      errorMessage: null,
    }));

    if (result.warningMessage) {
      showToast(result.warningMessage, "warning");
    }

    setPostMutationBusy(true);
    try {
      await runAfterMutation(contextVersion);
    } catch (error) {
      if (contextVersion !== contextVersionRef.current) {
        loadingCardIdsRef.current.delete(cardId);
        return;
      }
      showError(error, t("error_messages.unknown"));
    } finally {
      if (contextVersion === contextVersionRef.current) {
        setPostMutationBusy(false);
      }
      loadingCardIdsRef.current.delete(cardId);
    }
  }, [disabled, executeTool, isPostMutationBusy, runAfterMutation, sending, showError, showToast, t, updateSingleCard]);

  const handleSkipTool = useCallback((messageId: string, cardId: string) => {
    if (disabled || sending || isPostMutationBusy) {
      return;
    }
    updateSingleCard(messageId, cardId, (current) => ({
      ...current,
      status: "skipped",
      resultNote: t("settingsMode.skipped"),
      errorMessage: null,
    }));
  }, [disabled, isPostMutationBusy, sending, t, updateSingleCard]);

  const handleUndoTool = useCallback(async (messageId: string, cardId: string) => {
    const contextVersion = contextVersionRef.current;
    const message = messagesRef.current.find((item) => item.id === messageId);
    const card = message?.toolCalls?.find((item) => item.id === cardId);
    if (
      disabled
      || sending
      || isPostMutationBusy
      || 
      !card
      || !card.undoMeta
      || !basePath
      || card.isLoading
      || loadingCardIdsRef.current.has(cardId)
      || loadingCardIdsRef.current.size > 0
    ) {
      return;
    }

    loadingCardIdsRef.current.add(cardId);

    updateSingleCard(messageId, cardId, (current) => ({
      ...current,
      isLoading: true,
      errorMessage: null,
    }));

    try {
      if (card.undoMeta.kind === "lore" && card.undoMeta.category && card.undoMeta.filename) {
        if (mode === "au") {
          await deleteLore({
            au_path: basePath,
            category: card.undoMeta.category,
            filename: card.undoMeta.filename,
          });
        } else {
          await deleteLore({
            fandom_path: basePath,
            category: card.undoMeta.category,
            filename: card.undoMeta.filename,
          });
        }
      } else if (card.undoMeta.kind === "fact" && card.undoMeta.factId) {
        await updateFactStatus(basePath, card.undoMeta.factId, "deprecated", card.undoMeta.chapterNum || currentChapter);
      } else if (card.undoMeta.kind === "pinned") {
        const latestProject = await getProject(basePath);
        const pinnedContext = latestProject.pinned_context || [];
        const pinnedContent = (card.undoMeta.pinnedContent || "").trim();
        let pinnedIndex =
          typeof card.undoMeta.pinnedIndex === "number"
          && pinnedContext[card.undoMeta.pinnedIndex]?.trim() === pinnedContent
            ? card.undoMeta.pinnedIndex
            : -1;

        if (pinnedIndex < 0 && pinnedContent) {
          pinnedIndex = pinnedContext.map((item) => item.trim()).lastIndexOf(pinnedContent);
        }

        if (pinnedIndex < 0) {
          throw new Error(t("settingsMode.error.pinnedUndoNotFound"));
        }

      await deletePinned(basePath, pinnedIndex);
      } else {
        throw new Error(t("settingsMode.undoNotSupported"));
      }

      if (contextVersion !== contextVersionRef.current) {
        loadingCardIdsRef.current.delete(cardId);
        return;
      }

      updateSingleCard(messageId, cardId, (current) => ({
        ...current,
        isLoading: false,
        status: "undone",
        resultNote: t("settingsMode.undone"),
        undoMeta: null,
      }));
      setPostMutationBusy(true);
      await runAfterMutation(contextVersion);
      loadingCardIdsRef.current.delete(cardId);
    } catch (error) {
      if (contextVersion !== contextVersionRef.current) {
        loadingCardIdsRef.current.delete(cardId);
        return;
      }
      updateSingleCard(messageId, cardId, (current) => ({
        ...current,
        isLoading: false,
        errorMessage: error instanceof Error ? error.message : t("error_messages.unknown"),
      }));
      showError(error, t("error_messages.unknown"));
      loadingCardIdsRef.current.delete(cardId);
    } finally {
      if (contextVersion === contextVersionRef.current) {
        setPostMutationBusy(false);
      }
    }
  }, [basePath, currentChapter, disabled, isPostMutationBusy, mode, runAfterMutation, sending, showError, t, updateSingleCard]);

  const handleConfirmAll = useCallback(async (messageId: string) => {
    if (disabled || sending || isPostMutationBusy) {
      return;
    }
    const message = messagesRef.current.find((item) => item.id === messageId);
    const pendingIds = (message?.toolCalls || [])
      .filter((card) =>
        !isToolCallResolved(card.status)
        && !card.isLoading
        && !loadingCardIdsRef.current.has(card.id)
        && !card.parseError
        && !getToolValidationError(
          card,
          card.parsedArgs,
          t,
          new Set(characterFilesRef.current.map((file) => file.name.trim()).filter(Boolean))
        )
        && !getToolMissingTargetError(
          card,
          card.parsedArgs,
          new Set(characterFilesRef.current.map((file) => file.filename)),
          new Set(worldbuildingFilesRef.current.map((file) => file.filename)),
          t
        )
        && !getToolOverwriteWarning(
          card,
          card.parsedArgs,
          new Set(characterFilesRef.current.map((file) => file.filename)),
          new Set(worldbuildingFilesRef.current.map((file) => file.filename)),
          t
        )
        && !getToolDuplicateWarning(
          card,
          card.parsedArgs,
          projectInfoRef.current?.pinned_context || [],
          t
        )
      )
      .map((card) => card.id);

    for (const cardId of pendingIds) {
      await handleConfirmTool(messageId, cardId);
    }
  }, [disabled, handleConfirmTool, isPostMutationBusy, sending, t]);

  const handleSkipAll = useCallback((messageId: string) => {
    if (disabled || sending || isPostMutationBusy) {
      return;
    }
    updateMessageCards(messageId, (cards) =>
      cards.map((card) =>
        isToolCallResolved(card.status) || card.isLoading || loadingCardIdsRef.current.has(card.id)
          ? card
          : {
              ...card,
              status: "skipped",
              resultNote: t("settingsMode.skipped"),
              errorMessage: null,
            }
      )
    );
  }, [disabled, isPostMutationBusy, sending, t, updateMessageCards]);

  const sendMessage = useCallback(async (intent: LargeTextIntent) => {
    const trimmed = inputText.trim();
    if (!trimmed || !basePath || mutationBusy || disabled) return;

    const requestId = ++chatRequestIdRef.current;
    const outgoing = buildOutboundUserMessage(trimmed, intent, t);
    const userMessageId = createMessageId(MESSAGE_STORAGE_PREFIX);
    const nextMessages = [
      ...messagesRef.current,
      {
        id: userMessageId,
        role: "user" as const,
        content: trimmed,
      },
    ];

    setMessages(nextMessages);
    setSending(true);

    try {
      const response = await sendSettingsChat({
        base_path: basePath,
        mode,
        // 对话历史全量发送，由后端 settings_chat.py 负责截断（保留最近 5 轮）。
        messages: [
          ...toApiMessages(messagesRef.current, t),
          { role: "user", content: outgoing },
        ],
        ...(fandomPath ? { fandom_path: fandomPath } : {}),
        ...(sessionLlm ? { session_llm: sessionLlm } : {}),
      });
      if (requestId !== chatRequestIdRef.current) return;
      const toolCalls = Array.isArray(response.tool_calls) ? response.tool_calls : [];

      const assistantMessage: SettingsChatMessage = {
        id: createMessageId(MESSAGE_STORAGE_PREFIX),
        role: "assistant",
        content: response.content || t("settingsMode.emptyAssistant"),
        toolCalls: toolCalls.map((toolCall) => createToolCallCardState(toolCall)),
      };

      setMessages((current) => [...current, assistantMessage]);
      setInputText("");
    } catch (error) {
      if (requestId !== chatRequestIdRef.current) return;
      setMessages((current) => current.filter((message) => message.id !== userMessageId));
      showError(error, t("error_messages.unknown"));
    } finally {
      if (requestId === chatRequestIdRef.current) {
        setSending(false);
      }
    }
  }, [basePath, disabled, fandomPath, inputText, mode, mutationBusy, sessionLlm, showError, t]);

  const existingCharacterFileNames = useMemo(
    () => new Set(characterFiles.map((file) => file.filename)),
    [characterFiles]
  );
  const existingWorldbuildingFileNames = useMemo(
    () => new Set(worldbuildingFiles.map((file) => file.filename)),
    [worldbuildingFiles]
  );
  const existingPinnedTexts = projectInfo?.pinned_context || [];
  const availableCharacterNames = useMemo(
    () => characterFiles.map((file) => file.name),
    [characterFiles]
  );
  const availableCharacterNameSet = useMemo(
    () => new Set(availableCharacterNames),
    [availableCharacterNames]
  );

  return (
    <div className={`flex h-full min-h-0 flex-col ${className}`}>
      {title ? (
        <div className="flex items-center gap-2 border-b border-black/10 px-4 py-3 text-sm font-semibold text-text dark:border-white/10">
          <Sparkles size={16} className="text-accent" />
          <span>{title}</span>
        </div>
      ) : null}

      <div className={`min-h-0 flex-1 ${compact ? "rounded-[20px] border border-black/10 bg-surface/35 shadow-subtle dark:border-white/10" : ""}`}>
        <SettingsChatHistory
          messages={messages}
          mode={mode}
          t={t}
        compact={compact}
        availableCharacterNames={availableCharacterNames}
        existingCharacterFileNames={existingCharacterFileNames}
        existingWorldbuildingFileNames={existingWorldbuildingFileNames}
        existingPinnedTexts={existingPinnedTexts}
        disabled={disabled || mutationBusy}
        availableCharacterNameSet={availableCharacterNameSet}
        onConfirmTool={handleConfirmTool}
        onSkipTool={handleSkipTool}
        onUndoTool={handleUndoTool}
          onConfirmAll={handleConfirmAll}
          onSkipAll={handleSkipAll}
        />
      </div>

      <SettingsChatInput
        value={inputText}
        onChange={setInputText}
        onSend={() => void sendMessage("instruction")}
        onLargeTextAction={(intent) => void sendMessage(intent)}
        placeholder={placeholder}
        sending={sending}
        compact={compact}
        disableSend={!basePath || disabled || mutationBusy}
        busyHint={hasLoadingCards ? t("settingsMode.toolActionBusy") : null}
        t={t}
      />
    </div>
  );
}
