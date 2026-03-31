import { Input, Textarea } from "../Input";
import { getEnumLabel } from "../../../i18n/labels";
import type { SettingsMode } from "./types";
import { coerceString, coerceStringArray, getToolCallName } from "./types";
import type { ToolCallCardState } from "./types";

interface ToolCallEditorProps {
  card: ToolCallCardState;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  availableCharacterNames: string[];
  mode: SettingsMode;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function setField(
  value: Record<string, unknown>,
  key: string,
  nextValue: unknown
): Record<string, unknown> {
  return {
    ...value,
    [key]: nextValue,
  };
}

function renderCharactersPicker(
  value: Record<string, unknown>,
  onChange: (next: Record<string, unknown>) => void,
  availableCharacterNames: string[],
  t: ToolCallEditorProps["t"]
) {
  const selected = new Set(coerceStringArray(value.characters));
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-text/70">{t("common.labels.characters")}</label>
      {availableCharacterNames.length > 0 ? (
        <div className="flex flex-wrap gap-2 rounded-lg border border-black/10 bg-background/50 p-3 dark:border-white/10">
          {availableCharacterNames.map((name) => {
            const checked = selected.has(name);
            return (
              <label key={name} className="inline-flex items-center gap-2 text-sm text-text/80">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={checked}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) {
                      next.add(name);
                    } else {
                      next.delete(name);
                    }
                    onChange(setField(value, "characters", Array.from(next)));
                  }}
                />
                <span>{name}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <Input
          value={coerceStringArray(value.characters).join(", ")}
          onChange={(event) =>
            onChange(
              setField(
                value,
                "characters",
                event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean)
              )
            )
          }
          placeholder={t("settingsMode.editor.charactersPlaceholder")}
        />
      )}
    </div>
  );
}

export function ToolCallEditor({
  card,
  value,
  onChange,
  availableCharacterNames,
  mode,
  t,
}: ToolCallEditorProps) {
  const toolName = getToolCallName(card);

  if (toolName === "create_character_file") {
    return (
      <div className="space-y-3">
        <Input
          label={t("common.labels.displayName")}
          value={coerceString(value.name)}
          onChange={(event) => onChange(setField(value, "name", event.target.value))}
        />
        <Input
          label={t("common.labels.aliases")}
          value={coerceStringArray(value.aliases).join(", ")}
          onChange={(event) =>
            onChange(
              setField(
                value,
                "aliases",
                event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean)
              )
            )
          }
        />
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text/70">{t("common.labels.importance")}</label>
            <select
              value={coerceString(value.importance) || "medium"}
              onChange={(event) => onChange(setField(value, "importance", event.target.value))}
              className="h-10 w-full rounded-md border border-black/20 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-white/20"
            >
              {["high", "medium", "low"].map((option) => (
                <option key={option} value={option}>
                  {getEnumLabel("importance", option, option)}
                </option>
              ))}
            </select>
          </div>
          <Input
            label={t("settingsMode.editor.originRef")}
            value={coerceString(value.origin_ref)}
            onChange={(event) => onChange(setField(value, "origin_ref", event.target.value))}
          />
        </div>
        <Textarea
          label={t("settingsMode.editor.content")}
          value={coerceString(value.content)}
          onChange={(event) => onChange(setField(value, "content", event.target.value))}
          className="min-h-[220px] font-mono"
        />
      </div>
    );
  }

  if (toolName === "modify_character_file") {
    return (
      <div className="space-y-3">
        <Input
          label={t("settingsMode.editor.filename")}
          value={coerceString(value.filename)}
          onChange={(event) => onChange(setField(value, "filename", event.target.value))}
        />
        <Input
          label={t("settingsMode.editor.changeSummary")}
          value={coerceString(value.change_summary)}
          onChange={(event) => onChange(setField(value, "change_summary", event.target.value))}
        />
        <Textarea
          label={t("settingsMode.editor.content")}
          value={coerceString(value.new_content)}
          onChange={(event) => onChange(setField(value, "new_content", event.target.value))}
          className="min-h-[220px] font-mono"
        />
      </div>
    );
  }

  if (toolName === "create_core_character_file") {
    return (
      <div className="space-y-3">
        <Input
          label={t("common.labels.displayName")}
          value={coerceString(value.name)}
          onChange={(event) => onChange(setField(value, "name", event.target.value))}
        />
        <Textarea
          label={t("settingsMode.editor.content")}
          value={coerceString(value.content)}
          onChange={(event) => onChange(setField(value, "content", event.target.value))}
          className="min-h-[220px] font-mono"
        />
      </div>
    );
  }

  if (toolName === "modify_core_character_file" || toolName === "modify_worldbuilding_file") {
    return (
      <div className="space-y-3">
        <Input
          label={t("settingsMode.editor.filename")}
          value={coerceString(value.filename)}
          onChange={(event) => onChange(setField(value, "filename", event.target.value))}
        />
        <Input
          label={t("settingsMode.editor.changeSummary")}
          value={coerceString(value.change_summary)}
          onChange={(event) => onChange(setField(value, "change_summary", event.target.value))}
        />
        <Textarea
          label={t("settingsMode.editor.content")}
          value={coerceString(value.new_content)}
          onChange={(event) => onChange(setField(value, "new_content", event.target.value))}
          className="min-h-[220px] font-mono"
        />
      </div>
    );
  }

  if (toolName === "create_worldbuilding_file") {
    return (
      <div className="space-y-3">
        <Input
          label={t("common.labels.displayName")}
          value={coerceString(value.name)}
          onChange={(event) => onChange(setField(value, "name", event.target.value))}
        />
        <Textarea
          label={t("settingsMode.editor.content")}
          value={toolName === "create_worldbuilding_file" ? coerceString(value.content) : ""}
          onChange={(event) => onChange(setField(value, "content", event.target.value))}
          className="min-h-[220px] font-mono"
        />
      </div>
    );
  }

  if (toolName === "add_fact" || toolName === "modify_fact") {
    const typeValue = coerceString((value.fact_type ?? value.type) as string) || "plot_event";
    return (
      <div className="space-y-3">
        {toolName === "modify_fact" && (
          <Input
            label={t("settingsMode.editor.factId")}
            value={coerceString(value.fact_id)}
            onChange={(event) => onChange(setField(value, "fact_id", event.target.value))}
          />
        )}
        <Textarea
          label={t("common.labels.contentRaw")}
          value={coerceString(value.content_raw)}
          onChange={(event) => onChange(setField(value, "content_raw", event.target.value))}
          className="min-h-[100px]"
        />
        <Textarea
          label={t("common.labels.contentClean")}
          value={coerceString(value.content_clean)}
          onChange={(event) => onChange(setField(value, "content_clean", event.target.value))}
          className="min-h-[120px]"
        />
        {renderCharactersPicker(value, onChange, availableCharacterNames, t)}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text/70">{t("common.labels.factType")}</label>
            <select
              value={typeValue}
              onChange={(event) => {
                onChange(setField(setField(value, "fact_type", event.target.value), "type", event.target.value));
              }}
              className="h-10 w-full rounded-md border border-black/20 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-white/20"
            >
              {["plot_event", "character_detail", "relationship", "worldbuilding", "foreshadowing"].map((option) => (
                <option key={option} value={option}>
                  {getEnumLabel("fact_type", option, option)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text/70">{t("common.labels.factStatus")}</label>
            <select
              value={coerceString(value.status) || "active"}
              onChange={(event) => onChange(setField(value, "status", event.target.value))}
              className="h-10 w-full rounded-md border border-black/20 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-white/20"
            >
              {(toolName === "modify_fact"
                ? ["active", "unresolved", "resolved", "deprecated"]
                : ["active", "unresolved"]).map((option) => (
                <option key={option} value={option}>
                  {getEnumLabel("fact_status", option, option)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text/70">{t("common.labels.narrativeWeight")}</label>
            <select
              value={coerceString(value.narrative_weight) || "medium"}
              onChange={(event) => onChange(setField(value, "narrative_weight", event.target.value))}
              className="h-10 w-full rounded-md border border-black/20 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-white/20"
            >
              {["high", "medium", "low"].map((option) => (
                <option key={option} value={option}>
                  {getEnumLabel("narrative_weight", option, option)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    );
  }

  if (toolName === "add_pinned_context") {
    return (
      <Textarea
        label={t("common.labels.pinnedContext")}
        value={coerceString(value.content)}
        onChange={(event) => onChange(setField(value, "content", event.target.value))}
        className="min-h-[160px]"
      />
    );
  }

  if (toolName === "update_writing_style") {
    const field = coerceString(value.field) || "custom_instructions";
    const fieldValue = coerceString(value.value);
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text/70">{t("settingsMode.editor.styleField")}</label>
          <select
            value={field}
            onChange={(event) => onChange(setField(value, "field", event.target.value))}
            className="h-10 w-full rounded-md border border-black/20 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-white/20"
          >
            <option value="perspective">{t("common.labels.perspective")}</option>
            <option value="emotion_style">{t("common.labels.emotionStyle")}</option>
            <option value="custom_instructions">{t("common.labels.customInstructions")}</option>
          </select>
        </div>
        {field === "perspective" ? (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text/70">{t("settingsMode.editor.styleValue")}</label>
            <select
              value={fieldValue || "third_person"}
              onChange={(event) => onChange(setField(value, "value", event.target.value))}
              className="h-10 w-full rounded-md border border-black/20 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-white/20"
            >
              {["third_person", "first_person"].map((option) => (
                <option key={option} value={option}>
                  {getEnumLabel("perspective", option, option)}
                </option>
              ))}
            </select>
          </div>
        ) : field === "emotion_style" ? (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text/70">{t("settingsMode.editor.styleValue")}</label>
            <select
              value={fieldValue || "implicit"}
              onChange={(event) => onChange(setField(value, "value", event.target.value))}
              className="h-10 w-full rounded-md border border-black/20 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-white/20"
            >
              {["implicit", "explicit"].map((option) => (
                <option key={option} value={option}>
                  {getEnumLabel("emotion_style", option, option)}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <Textarea
            label={t("settingsMode.editor.styleValue")}
            value={fieldValue}
            onChange={(event) => onChange(setField(value, "value", event.target.value))}
            className="min-h-[160px]"
          />
        )}
      </div>
    );
  }

  if (toolName === "update_core_includes") {
    const selected = new Set(
      coerceStringArray(value.filenames).map((item) => item.replace(/\.md$/i, ""))
    );
    return (
      <div className="space-y-2">
        <label className="text-xs font-medium text-text/70">{t("common.labels.coreAlwaysInclude")}</label>
        <div className="rounded-lg border border-black/10 bg-background/50 p-3 dark:border-white/10">
          {availableCharacterNames.length === 0 ? (
            <p className="text-sm text-text/55">{t("settingsMode.editor.noCharacters")}</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {availableCharacterNames.map((name) => (
                <label key={name} className="inline-flex items-center gap-2 text-sm text-text/80">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={selected.has(name)}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) {
                        next.add(name);
                      } else {
                        next.delete(name);
                      }
                      onChange(setField(value, "filenames", Array.from(next)));
                    }}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text/60">{t("settingsMode.editor.unsupportedTool", { mode })}</p>
      <Textarea
        label={t("settingsMode.editor.rawArguments")}
        value={JSON.stringify(value, null, 2)}
        onChange={(event) => {
          try {
            const parsed = JSON.parse(event.target.value);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              onChange(parsed as Record<string, unknown>);
            }
          } catch {
            // keep editor lenient
          }
        }}
        className="min-h-[180px] font-mono"
      />
    </div>
  );
}
