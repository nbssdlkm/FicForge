import { useState } from 'react';
import { Button } from '../shared/Button';
import { Card } from '../shared/Card';

interface SettingsPanelProps {
  model?: string;
  onModelChange?: (model: string) => void;
  temperature?: number;
  onTemperatureChange?: (temp: number) => void;
  topP?: number;
  onTopPChange?: (topP: number) => void;
}

export const SettingsPanel = ({
  model: externalModel,
  onModelChange,
  temperature: externalTemp,
  onTemperatureChange,
  topP: externalTopP,
  onTopPChange,
}: SettingsPanelProps = {}) => {
  const [localModel, setLocalModel] = useState(externalModel || 'deepseek-chat');
  const [temp, setTemp] = useState(externalTemp ?? 1.0);
  const [topP, setTopP] = useState(externalTopP ?? 0.95);

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
    <Card className="w-full max-w-sm p-4 text-sm flex flex-col gap-4 !shadow-none border-transparent bg-transparent px-0">
      <div className="font-sans font-medium mb-1 text-text/80 uppercase tracking-wide text-xs">生成参数配置</div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-text/70">模型</label>
        <select value={localModel} onChange={e => handleModelChange(e.target.value)}
          className="h-8 rounded border border-black/20 dark:border-white/20 bg-background px-2 text-xs focus:ring-1 focus:ring-accent outline-none">
          <option value="deepseek-chat">deepseek-chat</option>
          <option value="claude-3-5-sonnet">claude-3-5-sonnet</option>
          <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
          <option value="gpt-4o">gpt-4o</option>
          <option value="llama3">llama3</option>
          <option value="qwen-max">qwen-max</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-xs text-text/70">
          <label>Temperature</label>
          <span>{temp.toFixed(1)}</span>
        </div>
        <input type="range" min="0" max="2" step="0.1" value={temp}
          onChange={e => handleTempChange(parseFloat(e.target.value))}
          className="w-full accent-accent h-1" />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-xs text-text/70">
          <label>Top-p</label>
          <span>{topP.toFixed(2)}</span>
        </div>
        <input type="range" min="0" max="1" step="0.05" value={topP}
          onChange={e => handleTopPChange(parseFloat(e.target.value))}
          className="w-full accent-accent h-1" />
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2">
        <Button variant="secondary" size="sm" className="text-xs h-8">记住到全局</Button>
        <Button variant="secondary" size="sm" className="text-xs h-8">记住到本 AU</Button>
      </div>
    </Card>
  );
};
