// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState } from 'react';
import { useTranslation } from '../../i18n/useAppTranslation';

/**
 * 预设模型及其对应的 API base URL。
 * 选择预设时自动填充 baseurl，减少用户手动输入。
 */
const MODEL_PRESETS: { group: string; models: { name: string; apiBase: string }[] }[] = [
  {
    group: 'DeepSeek',
    models: [
      { name: 'deepseek-chat', apiBase: 'https://api.deepseek.com' },
      { name: 'deepseek-reasoner', apiBase: 'https://api.deepseek.com' },
    ],
  },
  {
    group: 'OpenAI',
    models: [
      { name: 'gpt-4o', apiBase: 'https://api.openai.com' },
      { name: 'gpt-4o-mini', apiBase: 'https://api.openai.com' },
      { name: 'gpt-4.1', apiBase: 'https://api.openai.com' },
    ],
  },
  {
    group: 'Claude',
    models: [
      { name: 'claude-sonnet-4-6', apiBase: 'https://api.anthropic.com' },
      { name: 'claude-3-5-sonnet', apiBase: 'https://api.anthropic.com' },
    ],
  },
  {
    group: 'Qwen',
    models: [
      { name: 'qwen-max', apiBase: 'https://dashscope.aliyuncs.com/compatible-mode' },
      { name: 'qwen-plus', apiBase: 'https://dashscope.aliyuncs.com/compatible-mode' },
    ],
  },
  {
    group: 'Gemini',
    models: [
      { name: 'gemini-2.5-flash', apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai' },
      { name: 'gemini-2.5-pro', apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai' },
    ],
  },
  {
    group: 'Ollama',
    models: [
      { name: 'llama3', apiBase: 'http://localhost:11434/v1' },
      { name: 'qwen2.5', apiBase: 'http://localhost:11434/v1' },
    ],
  },
];

const ALL_PRESETS = MODEL_PRESETS.flatMap(g => g.models);

interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
  onApiBaseAutoFill?: (apiBase: string) => void;
  disabled?: boolean;
  className?: string;
}

export function ModelSelector({ value, onChange, onApiBaseAutoFill, disabled, className }: ModelSelectorProps) {
  const { t } = useTranslation();
  const [isCustom, setIsCustom] = useState(() => !ALL_PRESETS.some(p => p.name === value));

  const handleSelect = (modelName: string) => {
    setIsCustom(false);
    onChange(modelName);
    const preset = ALL_PRESETS.find(p => p.name === modelName);
    if (preset && onApiBaseAutoFill) {
      onApiBaseAutoFill(preset.apiBase);
    }
  };

  return (
    <div className={className}>
      {isCustom ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('modelSelector.customPlaceholder')}
            disabled={disabled}
            className="h-11 flex-1 rounded-md border border-black/20 bg-background px-3 text-base text-text placeholder:text-text/40 outline-none focus:ring-1 focus:ring-accent dark:border-white/20 md:h-9 md:text-sm"
          />
          <button
            type="button"
            onClick={() => setIsCustom(false)}
            disabled={disabled}
            className="shrink-0 rounded-md border border-black/20 bg-background px-3 text-xs text-text/60 hover:text-text dark:border-white/20 md:text-xs"
          >
            {t('modelSelector.presets')}
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <select
            value={ALL_PRESETS.some(p => p.name === value) ? value : ''}
            onChange={(e) => handleSelect(e.target.value)}
            disabled={disabled}
            className="h-11 flex-1 rounded-md border border-black/20 bg-background px-3 text-base text-text outline-none focus:ring-1 focus:ring-accent dark:border-white/20 md:h-9 md:text-sm"
          >
            {!ALL_PRESETS.some(p => p.name === value) && (
              <option value="" disabled>{t('modelSelector.selectHint')}</option>
            )}
            {MODEL_PRESETS.map(group => (
              <optgroup key={group.group} label={group.group}>
                {group.models.map(m => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setIsCustom(true)}
            disabled={disabled}
            className="shrink-0 rounded-md border border-black/20 bg-background px-3 text-xs text-text/60 hover:text-text dark:border-white/20 md:text-xs"
          >
            {t('modelSelector.custom')}
          </button>
        </div>
      )}
    </div>
  );
}
