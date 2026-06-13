// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { MODEL_PRESETS } from "../shared/ModelSelector";
import { Modal } from "../shared/Modal";
import { Button } from "../shared/Button";
import { Spinner } from "../shared/Spinner";
import { useTranslation } from "../../i18n/useAppTranslation";

const ALL_PRESET_NAMES = MODEL_PRESETS.flatMap(g => g.models.map(m => m.name));

interface SimpleSettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  isLoading?: boolean;

  model: string;
  onModelChange: (value: string) => void;
  temperature: number;
  onTemperatureChange: (value: number) => void;
  topP: number;
  onTopPChange: (value: number) => void;
  onSaveGlobal: () => Promise<void> | void;
  onSaveAu: () => Promise<void> | void;

  fontSize: number;
  onFontSizeChange: (value: number) => void;
  lineHeight: number;
  onLineHeightChange: (value: number) => void;
}

export function SimpleSettingsDrawer({
  isOpen,
  onClose,
  isLoading,
  model,
  onModelChange,
  temperature,
  onTemperatureChange,
  topP,
  onTopPChange,
  onSaveGlobal,
  onSaveAu,
  fontSize,
  onFontSizeChange,
  lineHeight,
  onLineHeightChange,
}: SimpleSettingsDrawerProps) {
  const { t } = useTranslation();

  const body = isLoading ? (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <Spinner />
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
        {t("simple.settings.loading", { defaultValue: "加载设置中…" })}
      </span>
    </div>
  ) : (
    <>
      <div className="flex flex-col gap-6">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright mb-2">
            {t("common.labels.model", { defaultValue: "Model" })}
          </div>
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            className="h-10 w-full rounded-sm border border-rule bg-background px-3 text-sm text-text outline-none focus:ring-1 focus:ring-gold-bright"
          >
            {!ALL_PRESET_NAMES.includes(model) && model ? (
              <option value={model}>{model}</option>
            ) : null}
            {MODEL_PRESETS.map((group) => (
              <optgroup key={group.group} label={group.group}>
                {group.models.map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright mb-2">
            {t("settingsPanel.temperature", { defaultValue: "Temperature" })}
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-sm text-text/70">{t("settingsPanel.temperature")}</span>
            <span className="font-display text-[12px] font-semibold not-italic text-accent">{temperature.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="0" max="2" step="0.1"
            value={temperature}
            onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
            className="w-full accent-accent h-1.5"
          />
        </div>

        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright mb-2">
            {t("settingsPanel.topP", { defaultValue: "Top P" })}
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-sm text-text/70">{t("settingsPanel.topP")}</span>
            <span className="font-display text-[12px] font-semibold not-italic text-accent">{topP.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0" max="1" step="0.05"
            value={topP}
            onChange={(e) => onTopPChange(parseFloat(e.target.value))}
            className="w-full accent-accent h-1.5"
          />
        </div>

        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright mb-2">
            {t("writer.fontSize", { defaultValue: "Font Size" })}
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-sm text-text/70">{t("writer.fontSize", { defaultValue: "Font Size" })}</span>
            <span className="font-display text-[12px] font-semibold not-italic text-accent">{fontSize}px</span>
          </div>
          <input
            type="range"
            min="14" max="28" step="1"
            value={fontSize}
            onChange={(e) => onFontSizeChange(parseInt(e.target.value))}
            className="w-full accent-accent h-1.5"
          />
        </div>

        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright mb-2">
            {t("writer.lineHeight", { defaultValue: "Line Height" })}
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-sm text-text/70">{t("writer.lineHeight", { defaultValue: "Line Height" })}</span>
            <span className="font-display text-[12px] font-semibold not-italic text-accent">{lineHeight.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="1.4" max="2.4" step="0.1"
            value={lineHeight}
            onChange={(e) => onLineHeightChange(parseFloat(e.target.value))}
            className="w-full accent-accent h-1.5"
          />
        </div>
      </div>

      <div className="border-t border-rule pt-4 mt-6 flex gap-2">
        <Button tone="neutral" fill="outline" size="sm" className="flex-1 font-sans text-[11px] uppercase tracking-[0.08em]" onClick={() => void onSaveGlobal()}>
          {t("common.actions.saveToGlobal")}
        </Button>
        <Button tone="accent" size="sm" className="flex-1 font-sans text-[11px] uppercase tracking-[0.08em]" onClick={() => void onSaveAu()}>
          {t("common.actions.saveToStory")}
        </Button>
      </div>
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("simple.settings.title", { defaultValue: "续写设置" })} className="max-w-md">
      {body}
    </Modal>
  );
}
