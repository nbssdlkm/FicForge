// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Button } from "../Button";
import { Card } from "../Card";
import { Tag } from "../Tag";
import { ToolCallEditor } from "./ToolCallEditor";
import { getEnumLabel, getOriginRefLabel } from "../../../i18n/labels";
import {
  getToolDuplicateWarning,
  getToolMissingTargetError,
  coerceString,
  coerceStringArray,
  getToolOverwriteWarning,
  getToolValidationError,
  getToolCallName,
  toPreviewText,
  type SettingsMode,
  type ToolCallCardState,
} from "./types";

interface ToolCallCardProps {
  card: ToolCallCardState;
  mode: SettingsMode;
  t: (key: string, options?: Record<string, unknown>) => string;
  availableCharacterNames: string[];
  existingCharacterFileNames: Set<string>;
  existingWorldbuildingFileNames: Set<string>;
  existingPinnedTexts: string[];
  globalBusy: boolean;
  onConfirm: (cardId: string, nextArgs?: Record<string, unknown>) => Promise<void>;
  onSkip: (cardId: string) => void;
  onUndo: (cardId: string) => Promise<void>;
}

function getCardTitle(
  card: ToolCallCardState,
  mode: SettingsMode,
  t: ToolCallCardProps["t"]
): string {
  const args = card.parsedArgs;
  const name = coerceString(args.name);
  const filename = coerceString(args.filename);
  const factId = coerceString(args.fact_id);

  switch (getToolCallName(card)) {
    case "create_character_file":
      return t("settingsMode.card.createCharacter", { name: name || t("common.none") });
    case "modify_character_file":
      return t("settingsMode.card.modifyCharacter", { filename: filename || t("common.none") });
    case "create_worldbuilding_file":
      return mode === "fandom"
        ? t("settingsMode.card.createFandomWorldbuilding", { name: name || t("common.none") })
        : t("settingsMode.card.createWorldbuilding", { name: name || t("common.none") });
    case "modify_worldbuilding_file":
      return mode === "fandom"
        ? t("settingsMode.card.modifyFandomWorldbuilding", { filename: filename || t("common.none") })
        : t("settingsMode.card.modifyWorldbuilding", { filename: filename || t("common.none") });
    case "add_fact":
      return t("settingsMode.card.addFact");
    case "modify_fact":
      return t("settingsMode.card.modifyFact", { factId: factId || t("common.none") });
    case "add_pinned_context":
      return t("settingsMode.card.addPinned");
    case "update_writing_style":
      return t("settingsMode.card.updateStyle");
    case "update_core_includes":
      return t("settingsMode.card.updateCoreIncludes");
    case "create_core_character_file":
      return t("settingsMode.card.createCoreCharacter", { name: name || t("common.none") });
    case "modify_core_character_file":
      return t("settingsMode.card.modifyCoreCharacter", { filename: filename || t("common.none") });
    default:
      return getToolCallName(card);
  }
}

function getLorePreview(card: ToolCallCardState): { preview: string; full: string } | null {
  const args = card.parsedArgs;
  const toolName = getToolCallName(card);

  if (toolName === "create_character_file" || toolName === "create_worldbuilding_file" || toolName === "create_core_character_file") {
    const content = coerceString(args.content);
    return content ? { preview: toPreviewText(content), full: content } : null;
  }

  if (
    toolName === "modify_character_file"
    || toolName === "modify_worldbuilding_file"
    || toolName === "modify_core_character_file"
  ) {
    const content = coerceString(args.new_content);
    return content ? { preview: toPreviewText(content), full: content } : null;
  }

  return null;
}

function getStatusVariant(card: ToolCallCardState): "success" | "warning" | "error" | "default" {
  if (card.status === "executed" || card.status === "undone") return "success";
  if (card.status === "skipped") return "warning";
  if (card.status === "error") return "error";
  return "default";
}

function renderFactSummary(card: ToolCallCardState, t: ToolCallCardProps["t"]) {
  const args = card.parsedArgs;
  const characters = coerceStringArray(args.characters);
  const type = coerceString((args.fact_type ?? args.type) as string);
  const weight = coerceString(args.narrative_weight);
  const status = coerceString(args.status);

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-text/80">
        {coerceString(args.content_clean) || coerceString(args.content_raw) || t("common.none")}
      </p>
      <div className="flex flex-wrap gap-2">
        {type ? <Tag variant="info">{getEnumLabel("fact_type", type, type)}</Tag> : null}
        {weight ? <Tag variant="warning">{getEnumLabel("narrative_weight", weight, weight)}</Tag> : null}
        {status ? <Tag variant="default">{getEnumLabel("fact_status", status, status)}</Tag> : null}
      </div>
      {characters.length > 0 ? (
        <p className="text-xs text-text/55">
          {t("common.labels.characters")}{t("common.labelColon")}{characters.join(t("common.listSeparator"))}
        </p>
      ) : null}
    </div>
  );
}

export function ToolCallCard({
  card,
  mode,
  t,
  availableCharacterNames,
  existingCharacterFileNames,
  existingWorldbuildingFileNames,
  existingPinnedTexts,
  globalBusy,
  onConfirm,
  onSkip,
  onUndo,
}: ToolCallCardProps) {
  const [isExpanded, setExpanded] = useState(false);
  const [isEditing, setEditing] = useState(false);
  const [draftArgs, setDraftArgs] = useState<Record<string, unknown>>(card.parsedArgs);
  const preview = useMemo(() => getLorePreview(card), [card]);
  const validationError = useMemo(
    () => getToolValidationError(
      card,
      isEditing ? draftArgs : card.parsedArgs,
      t,
      new Set(availableCharacterNames)
    ),
    [availableCharacterNames, card, draftArgs, isEditing, t]
  );
  const overwriteWarning = useMemo(
    () =>
      getToolOverwriteWarning(
        card,
        isEditing ? draftArgs : card.parsedArgs,
        existingCharacterFileNames,
        existingWorldbuildingFileNames,
        t
      ),
    [card, draftArgs, existingCharacterFileNames, existingWorldbuildingFileNames, isEditing, t]
  );
  const missingTargetError = useMemo(
    () =>
      getToolMissingTargetError(
        card,
        isEditing ? draftArgs : card.parsedArgs,
        existingCharacterFileNames,
        existingWorldbuildingFileNames,
        t
      ),
    [card, draftArgs, existingCharacterFileNames, existingWorldbuildingFileNames, isEditing, t]
  );
  const warning = useMemo(
    () =>
      getToolDuplicateWarning(
        card,
        isEditing ? draftArgs : card.parsedArgs,
        existingPinnedTexts,
        t
      ),
    [card, draftArgs, existingPinnedTexts, isEditing, t]
  );

  useEffect(() => {
    setDraftArgs(card.parsedArgs);
    setEditing(false);
  }, [card.id, card.parsedArgs]);

  const statusTag = card.status === "pending"
    ? null
    : (
      <Tag variant={getStatusVariant(card)}>
        {card.status === "executed"
          ? t("settingsMode.executed")
          : card.status === "skipped"
            ? t("settingsMode.skipped")
            : card.status === "undone"
              ? t("settingsMode.undone")
              : card.status === "error"
                ? t("settingsMode.failed")
                : t("error_messages.unknown")}
      </Tag>
    );

  return (
    <Card className={`space-y-4 ${card.status === "pending" ? "bg-surface/70" : "bg-black/[0.02] dark:bg-white/[0.03]"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-text">{getCardTitle(card, mode, t)}</h4>
          {statusTag}
        </div>
        {card.isLoading ? <Loader2 size={16} className="animate-spin text-accent" /> : null}
      </div>

      {card.parseError ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          <p className="font-medium">{t("settingsMode.parseErrorTitle")}</p>
          <p className="mt-1">{t("settingsMode.parseError")}</p>
          <details className="mt-3">
            <summary className="cursor-pointer select-none text-xs font-medium text-warning/90">
              {t("settingsMode.showRawArguments")}
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-warning/20 bg-black/5 p-3 text-xs text-text dark:bg-white/5">
              {card.toolCall.function.arguments}
            </pre>
          </details>
        </div>
      ) : null}

      {warning ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {warning}
        </div>
      ) : null}

      {overwriteWarning ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {overwriteWarning}
        </div>
      ) : null}

      {validationError && !card.parseError ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {validationError}
        </div>
      ) : null}

      {missingTargetError ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {missingTargetError}
        </div>
      ) : null}

      {card.errorMessage ? (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {card.errorMessage}
        </div>
      ) : null}

      {!isEditing ? (
        <div className="space-y-3 text-sm text-text/75">
          {(() => {
            const args = card.parsedArgs;
            const toolName = getToolCallName(card);

            if (toolName === "create_character_file") {
              return (
                <div className="grid gap-2 md:grid-cols-2">
                  <p>{t("common.labels.displayName")}{t("common.labelColon")}{coerceString(args.name) || t("common.none")}</p>
                  <p>{t("common.labels.aliases")}{t("common.labelColon")}{coerceStringArray(args.aliases).join(t("common.listSeparator")) || t("common.none")}</p>
                  <p>{t("common.labels.importance")}{t("common.labelColon")}{getEnumLabel("importance", coerceString(args.importance), t("common.none"))}</p>
                  <p>{t("settingsMode.field.origin")}{t("common.labelColon")}{getOriginRefLabel(coerceString(args.origin_ref)) || t("common.none")}</p>
                </div>
              );
            }

            if (toolName === "modify_character_file" || toolName === "modify_core_character_file" || toolName === "modify_worldbuilding_file") {
              return (
                <div className="space-y-2">
                  <p>{t("settingsMode.editor.filename")}{t("common.labelColon")}{coerceString(args.filename) || t("common.none")}</p>
                  <p>{t("settingsMode.editor.changeSummary")}{t("common.labelColon")}{coerceString(args.change_summary) || t("common.none")}</p>
                </div>
              );
            }

            if (toolName === "create_worldbuilding_file" || toolName === "create_core_character_file") {
              return <p>{t("common.labels.displayName")}{t("common.labelColon")}{coerceString(args.name) || t("common.none")}</p>;
            }

            if (toolName === "add_fact" || toolName === "modify_fact") {
              return renderFactSummary(card, t);
            }

            if (toolName === "add_pinned_context") {
              return <p className="text-sm leading-relaxed text-text/80">{coerceString(args.content) || t("common.none")}</p>;
            }

            if (toolName === "update_writing_style") {
              const field = coerceString(args.field);
              const fieldLabel = field === "perspective"
                ? t("common.labels.perspective")
                : field === "emotion_style"
                  ? t("common.labels.emotionStyle")
                  : t("common.labels.customInstructions");
              const rawValue = coerceString(args.value);
              const displayValue = field === "perspective"
                ? getEnumLabel("perspective", rawValue, rawValue)
                : field === "emotion_style"
                  ? getEnumLabel("emotion_style", rawValue, rawValue)
                  : rawValue;
              return (
                <div className="space-y-2">
                  <p>{t("settingsMode.editor.styleField")}{t("common.labelColon")}{fieldLabel}</p>
                  <p>{t("settingsMode.editor.styleValue")}{t("common.labelColon")}{displayValue || t("common.none")}</p>
                </div>
              );
            }

            if (toolName === "update_core_includes") {
              const filenames = coerceStringArray(args.filenames);
              return (
                <p>
                  {t("common.labels.coreAlwaysInclude")}{t("common.labelColon")}{filenames.length > 0 ? filenames.join(t("common.listSeparator")) : t("common.none")}
                </p>
              );
            }

            return (
              <pre className="overflow-x-auto rounded-lg border border-black/10 bg-background/40 p-3 text-xs dark:border-white/10">
                {JSON.stringify(args, null, 2)}
              </pre>
            );
          })()}

          {preview ? (
            <div className="rounded-lg border border-black/10 bg-background/40 p-3 dark:border-white/10">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-text/80">
                {isExpanded ? preview.full : preview.preview}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-7 px-2 text-xs"
                onClick={() => setExpanded((current) => !current)}
              >
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {isExpanded ? t("settingsMode.collapseContent") : t("settingsMode.expandContent")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <ToolCallEditor
          card={card}
          value={draftArgs}
          onChange={setDraftArgs}
          availableCharacterNames={availableCharacterNames}
          mode={mode}
          t={t}
        />
      )}

      {card.status === "executed" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/20 bg-success/5 p-3">
          <div className="flex items-center gap-2 text-sm text-success">
            <span>{card.resultNote || t("settingsMode.executed")}</span>
            {card.undoMeta?.kind === "unsupported" ? (
              <span className="inline-flex items-center gap-1 text-text/55">
                <AlertCircle size={13} />
                {card.undoMeta.note || t("settingsMode.undoNotSupported")}
              </span>
            ) : null}
          </div>
          {card.undoMeta && card.undoMeta.kind !== "unsupported" ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-text/70"
              onClick={() => void onUndo(card.id)}
              disabled={card.isLoading || (globalBusy && !card.isLoading)}
            >
              {t("settingsMode.undo")}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isEditing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraftArgs(card.parsedArgs);
                  setEditing(false);
                }}
                disabled={globalBusy && !card.isLoading}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void onConfirm(card.id, draftArgs)}
                disabled={
                  card.parseError !== null
                  || card.isLoading
                  || (globalBusy && !card.isLoading)
                  || validationError !== null
                  || warning !== null
                  || overwriteWarning !== null
                  || missingTargetError !== null
                }
              >
                {card.isLoading ? <Loader2 size={14} className="animate-spin" /> : t("settingsMode.confirm")}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void onConfirm(card.id)}
                disabled={
                  card.parseError !== null
                  || card.isLoading
                  || (globalBusy && !card.isLoading)
                  || validationError !== null
                  || warning !== null
                  || overwriteWarning !== null
                  || missingTargetError !== null
                }
              >
                {card.isLoading ? <Loader2 size={14} className="animate-spin" /> : t("settingsMode.confirm")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditing(true)}
                disabled={card.parseError !== null || card.isLoading || (globalBusy && !card.isLoading)}
              >
                {t("settingsMode.editAndConfirm")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSkip(card.id)}
                disabled={card.isLoading || (globalBusy && !card.isLoading)}
              >
                {t("settingsMode.skip")}
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
