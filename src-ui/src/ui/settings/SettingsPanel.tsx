// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useId, useState } from "react";
import { Button } from "../shared/Button";
import { SessionModelPicker } from "./model-picker/SessionModelPicker";
import type { PickerModelOption, SessionLayer } from "./model-picker/model-picker-utils";
import { useTranslation } from "../../i18n/useAppTranslation";
import { DEFAULT_DEEPSEEK_MODEL } from "../../config/defaults";

interface SettingsPanelProps {
  model?: string;
  onModelChange?: (model: string) => void;
  temperature?: number;
  onTemperatureChange?: (temp: number) => void;
  topP?: number;
  onTopPChange?: (topP: number) => void;
  onSaveGlobal?: () => void;
  onSaveAu?: () => void;
  /** 当前生效层级（badge 三态）。 */
  sessionLayer?: SessionLayer;
  /** 当前生效供应商的可选模型（useSessionParams 派生）。 */
  sessionModelOptions?: PickerModelOption[];
}

export const SettingsPanel = ({
  model: externalModel,
  onModelChange,
  temperature: externalTemp,
  onTemperatureChange,
  topP: externalTopP,
  onTopPChange,
  onSaveGlobal,
  onSaveAu,
  sessionLayer = "global",
  sessionModelOptions = [],
}: SettingsPanelProps = {}) => {
  const { t } = useTranslation();
  const temperatureId = useId();
  const topPId = useId();
  const [localModel, setLocalModel] = useState(externalModel || DEFAULT_DEEPSEEK_MODEL);
  const [temp, setTemp] = useState(externalTemp ?? 1.0);
  const [topP, setTopP] = useState(externalTopP ?? 0.95);

  useEffect(() => {
    setLocalModel(externalModel || DEFAULT_DEEPSEEK_MODEL);
  }, [externalModel]);

  useEffect(() => {
    setTemp(externalTemp ?? 1.0);
  }, [externalTemp]);

  useEffect(() => {
    setTopP(externalTopP ?? 0.95);
  }, [externalTopP]);

  const handleModelChange = (val: string) => {
    setLocalModel(val);
    onModelChange?.(val);
  };
  const handleTempChange = (val: number) => {
    setTemp(val);
    onTemperatureChange?.(val);
  };
  const handleTopPChange = (val: number) => {
    setTopP(val);
    onTopPChange?.(val);
  };

  return (
    <div className="w-full text-sm flex flex-col gap-5 md:gap-4 md:max-w-sm">
      <div className="font-sans font-medium mb-1 text-text/90 text-xs">{t("settingsPanel.title")}</div>

      <div className="flex flex-col gap-1.5">
        {/* SessionModelPicker 是自画控件组（层级 badge + 手填/select 二态 + 按钮），
            不接收 id 透传、内部 select 已自带 aria-label，无法 htmlFor 关联 → span（守则 2b） */}
        <span className="text-xs text-text/70">{t("common.labels.model")}</span>
        <SessionModelPicker
          model={localModel}
          onModelChange={handleModelChange}
          layer={sessionLayer}
          options={sessionModelOptions}
        />
      </div>

      <div className="flex flex-col gap-2 md:gap-1.5">
        <div className="flex justify-between text-sm md:text-xs text-text/70">
          <label htmlFor={temperatureId}>{t("settingsPanel.temperature")}</label>
          <span className="font-mono">{temp.toFixed(1)}</span>
        </div>
        <input
          id={temperatureId}
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={temp}
          onChange={(e) => handleTempChange(parseFloat(e.target.value))}
          className="w-full accent-accent h-2 md:h-1"
        />
      </div>

      <div className="flex flex-col gap-2 md:gap-1.5">
        <div className="flex justify-between text-sm md:text-xs text-text/70">
          <label htmlFor={topPId}>{t("settingsPanel.topP")}</label>
          <span className="font-mono">{topP.toFixed(2)}</span>
        </div>
        <input
          id={topPId}
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={topP}
          onChange={(e) => handleTopPChange(parseFloat(e.target.value))}
          className="w-full accent-accent h-2 md:h-1"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 mt-1">
        <Button
          tone="neutral"
          fill="outline"
          size="sm"
          className="h-11 text-sm md:h-8 md:text-xs"
          onClick={onSaveGlobal}
        >
          {t("common.actions.saveToGlobal")}
        </Button>
        <Button tone="neutral" fill="outline" size="sm" className="h-11 text-sm md:h-8 md:text-xs" onClick={onSaveAu}>
          {t("common.actions.saveToStory")}
        </Button>
      </div>
    </div>
  );
};
