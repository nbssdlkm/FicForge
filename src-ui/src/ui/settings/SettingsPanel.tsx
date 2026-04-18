// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useState } from 'react';
import { Button } from '../shared/Button';
import { Card } from '../shared/Card';
import { MODEL_PRESETS } from '../shared/ModelSelector';
import { useTranslation } from '../../i18n/useAppTranslation';

const ALL_PRESET_NAMES = MODEL_PRESETS.flatMap(g => g.models.map(m => m.name));

interface SettingsPanelProps {
  model?: string;
  onModelChange?: (model: string) => void;
  temperature?: number;
  onTemperatureChange?: (temp: number) => void;
  topP?: number;
  onTopPChange?: (topP: number) => void;
  onSaveGlobal?: () => void;
  onSaveAu?: () => void;
}

export const SettingsPanel = ({
  model: externalModel,
  onModelChange,
  temperature: externalTemp,
  onTemperatureChange,
  topP: externalTopP,
  onTopPChange,
  onSaveGlobal,
  onSaveAu
}: SettingsPanelProps = {}) => {
  const { t } = useTranslation();
  const [localModel, setLocalModel] = useState(externalModel || 'deepseek-chat');
  const [temp, setTemp] = useState(externalTemp ?? 1.0);
  const [topP, setTopP] = useState(externalTopP ?? 0.95);

  useEffect(() => {
    setLocalModel(externalModel || 'deepseek-chat');
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
    <Card className="w-full p-4 text-sm flex flex-col gap-5 md:gap-4 md:max-w-sm !shadow-none border-transparent bg-transparent px-0">
      <div className="font-sans font-medium mb-1 text-text/80 text-xs">{t("settingsPanel.title")}</div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-text/70">{t("common.labels.model")}</label>
        <select value={localModel} onChange={e => handleModelChange(e.target.value)}
          className="h-11 w-full rounded-md border border-black/20 bg-background px-3 text-base text-text outline-none focus:ring-1 focus:ring-accent dark:border-white/20 md:h-8 md:px-2 md:text-xs">
          {!ALL_PRESET_NAMES.includes(localModel) && localModel ? (
            <option value={localModel}>{localModel}</option>
          ) : null}
          {MODEL_PRESETS.map(group => (
            <optgroup key={group.group} label={group.group}>
              {group.models.map(m => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2 md:gap-1.5">
        <div className="flex justify-between text-sm md:text-xs text-text/70">
          <label>{t("settingsPanel.temperature")}</label>
          <span className="font-mono">{temp.toFixed(1)}</span>
        </div>
        <input type="range" min="0" max="2" step="0.1" value={temp}
          onChange={e => handleTempChange(parseFloat(e.target.value))}
          className="w-full accent-accent h-2 md:h-1" />
      </div>

      <div className="flex flex-col gap-2 md:gap-1.5">
        <div className="flex justify-between text-sm md:text-xs text-text/70">
          <label>{t("settingsPanel.topP")}</label>
          <span className="font-mono">{topP.toFixed(2)}</span>
        </div>
        <input type="range" min="0" max="1" step="0.05" value={topP}
          onChange={e => handleTopPChange(parseFloat(e.target.value))}
          className="w-full accent-accent h-2 md:h-1" />
      </div>

      <div className="grid grid-cols-2 gap-2 mt-1">
        <Button variant="secondary" size="sm" className="h-11 text-sm md:h-8 md:text-xs" onClick={onSaveGlobal}>{t("common.actions.saveToGlobal")}</Button>
        <Button variant="secondary" size="sm" className="h-11 text-sm md:h-8 md:text-xs" onClick={onSaveAu}>{t("common.actions.saveToStory")}</Button>
      </div>
    </Card>
  );
};
