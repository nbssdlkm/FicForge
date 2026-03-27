import { useState } from 'react';
import { Button } from '../shared/Button';
import { Card } from '../shared/Card';

export const SettingsPanel = () => {
  const [temp, setTemp] = useState(1.0);
  const [topP, setTopP] = useState(0.95);

  return (
    <Card className="w-full max-w-sm p-4 text-sm flex flex-col gap-4 !shadow-none border-transparent bg-transparent px-0">
      <div className="font-sans font-medium mb-1 text-text/80 uppercase tracking-wide text-xs">生成参数配置</div>
      
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-text/70">模型</label>
        <select className="h-8 rounded border border-black/20 dark:border-white/20 bg-background px-2 text-xs focus:ring-1 focus:ring-accent outline-none">
          <option>deepseek-chat</option>
          <option>claude-3-5-sonnet</option>
          <option>llama3</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-xs text-text/70">
          <label>Temperature</label>
          <span>{temp.toFixed(1)}</span>
        </div>
        <input 
          type="range" min="0" max="2" step="0.1" 
          value={temp} onChange={(e) => setTemp(parseFloat(e.target.value))}
          className="w-full accent-accent h-1" 
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-xs text-text/70">
          <label>Top-p</label>
          <span>{topP.toFixed(2)}</span>
        </div>
        <input 
          type="range" min="0" max="1" step="0.05" 
          value={topP} onChange={(e) => setTopP(parseFloat(e.target.value))}
          className="w-full accent-accent h-1" 
        />
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2">
        <Button variant="secondary" size="sm" className="text-xs h-8">记住到全局</Button>
        <Button variant="secondary" size="sm" className="text-xs h-8">记住到本 AU</Button>
      </div>
    </Card>
  );
};
