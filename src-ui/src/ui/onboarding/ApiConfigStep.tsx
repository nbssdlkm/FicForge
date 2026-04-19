// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useMemo, useState } from 'react';
import { Spinner } from "../shared/Spinner";
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from '../../i18n/useAppTranslation';
import { LLMMode } from '../../api/engine-client';
import { getEngine } from '../../api/engine-instance';
import { listGenerationModes, type Platform } from '@ficforge/engine';
import { StepIndicator } from './StepIndicator';
import { ApiSetupHelp } from '../help/ApiSetupHelp';
import { useLlmConnectionTest } from '../../hooks/useConnectionTest';
import { canTestLlmConnection } from '../shared/llm-config';

type Mode = LLMMode;

export type ApiConfig = {
  mode: Mode;
  model: string;
  api_base: string;
  api_key: string;
  local_model_path: string;
  ollama_model: string;
};

const DEFAULT_CONFIG: ApiConfig = {
  mode: LLMMode.API,
  model: 'deepseek-chat',
  api_base: 'https://api.deepseek.com',
  api_key: '',
  local_model_path: '',
  ollama_model: '',
};

export function ApiConfigStep({
  onNext,
  onPrev,
  initialConfig,
}: {
  onNext: (config: ApiConfig) => void;
  onPrev: () => void;
  initialConfig?: Partial<ApiConfig>;
}) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ApiConfig>({ ...DEFAULT_CONFIG, ...initialConfig });
  const [helpOpen, setHelpOpen] = useState(false);
  const llmConnection = useLlmConnectionTest({
    getSuccessMessage: (result, params) => t('onboarding.apiConfig.testSuccess', { model: result.model || params.model }),
    getFailureMessage: (result) => t('onboarding.apiConfig.testFailed', { message: result.message || '' }),
    getExceptionMessage: (error) => t('onboarding.apiConfig.testFailed', { message: error instanceof Error ? error.message || t('error_messages.unknown') : t('error_messages.unknown') }),
  });

  const modeOptions = useMemo(() => {
    let platform: Platform = 'web';
    try { platform = getEngine().adapter.getPlatform(); } catch { /* engine not ready, fall back to web */ }
    return listGenerationModes(platform);
  }, []);

  const update = (field: keyof ApiConfig, value: string) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    llmConnection.reset();
  };

  const handleTest = async () => {
    await llmConnection.run({
      mode: config.mode,
      model: config.model,
      apiBase: config.api_base,
      apiKey: config.api_key,
      localModelPath: config.local_model_path,
      ollamaModel: config.ollama_model,
    });
  };

  const canProceed = llmConnection.status === 'success';
  const canTest = llmConnection.status !== 'testing'
    && canTestLlmConnection({
      mode: config.mode,
      model: config.model,
      apiBase: config.api_base,
      apiKey: config.api_key,
      localModelPath: config.local_model_path,
      ollamaModel: config.ollama_model,
    });

  return (
    <div className="max-w-lg mx-auto space-y-6 py-8">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-serif font-bold">{t('onboarding.apiConfig.title')}</h2>
        <StepIndicator current={2} total={4} />
      </div>

      <div className="space-y-2">
        {modeOptions.map(({ mode, availability }) => (
          <label
            key={mode}
            className={`flex items-center gap-3 ${availability.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
          >
            <input
              type="radio"
              name="mode"
              checked={config.mode === mode}
              disabled={!availability.available}
              onChange={() => { update('mode', mode as Mode); }}
              className="accent-accent"
            />
            <span className="text-sm">
              {t(`onboarding.apiConfig.mode${mode.charAt(0).toUpperCase() + mode.slice(1)}`)}
              {!availability.available && ` (${t('common.status.comingSoon')})`}
            </span>
          </label>
        ))}
      </div>

      {config.mode === 'api' && (
        <div className="space-y-4 border-t border-black/10 dark:border-white/10 pt-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-text/90">{t('onboarding.apiConfig.apiBase')}</label>
            <Input value={config.api_base} onChange={e => update('api_base', e.target.value)} placeholder="https://api.deepseek.com" disabled={llmConnection.status === 'testing'} />
            <p className="text-xs text-text/50">{t('onboarding.apiConfig.apiBaseHint')}</p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-text/90">{t('onboarding.apiConfig.apiKey')}</label>
            <Input type="password" value={config.api_key} onChange={e => update('api_key', e.target.value)} placeholder="sk-..." disabled={llmConnection.status === 'testing'} />
            <p className="text-xs text-text/50">
              {t('onboarding.apiConfig.apiKeyHint')}{' '}
              <button type="button" className="text-accent hover:underline" onClick={() => setHelpOpen(true)}>{t('help.apiSetup.howToGet')}</button>
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-text/90">{t('onboarding.apiConfig.model')}</label>
            <Input value={config.model} onChange={e => update('model', e.target.value)} placeholder={t('onboarding.apiConfig.modelPlaceholder')} disabled={llmConnection.status === 'testing'} />
          </div>
        </div>
      )}

      {config.mode === 'local' && (
        <div className="space-y-4 border-t border-black/10 dark:border-white/10 pt-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-text/90">{t('onboarding.apiConfig.localPath')}</label>
            <Input value={config.local_model_path} onChange={e => update('local_model_path', e.target.value)} placeholder="/path/to/model" disabled={llmConnection.status === 'testing'} />
            <p className="text-xs text-text/50">{t('onboarding.apiConfig.localPathHint')}</p>
          </div>
        </div>
      )}

      {config.mode === 'ollama' && (
        <div className="space-y-4 border-t border-black/10 dark:border-white/10 pt-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-text/90">{t('onboarding.apiConfig.ollamaBase')}</label>
            <Input value={config.api_base} onChange={e => update('api_base', e.target.value)} placeholder="http://localhost:11434/v1" disabled={llmConnection.status === 'testing'} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-text/90">{t('onboarding.apiConfig.ollamaModel')}</label>
            <Input value={config.ollama_model} onChange={e => update('ollama_model', e.target.value)} placeholder="llama3" disabled={llmConnection.status === 'testing'} />
          </div>
        </div>
      )}

      <div className="space-y-3">
        <Button tone="neutral" fill="outline" onClick={handleTest} disabled={!canTest} className="w-full">
          {llmConnection.status === 'testing' ? <><Spinner size="sm" className="mr-2" />{t('onboarding.apiConfig.testing')}</> : t('onboarding.apiConfig.testConnection')}
        </Button>

        {llmConnection.status !== 'idle' && (
          <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-md ${llmConnection.status === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
            {llmConnection.status === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            <span>{llmConnection.message}</span>
          </div>
        )}

        {llmConnection.status === 'idle' && (
          <p className="text-xs text-text/50 text-center">{t('onboarding.apiConfig.requireTest')}</p>
        )}
      </div>

      <div className="flex justify-between pt-4">
        <Button tone="neutral" fill="plain" onClick={onPrev} disabled={llmConnection.status === 'testing'}>{t('onboarding.common.prev')}</Button>
        <Button tone="accent" fill="solid" onClick={() => onNext(config)} disabled={!canProceed || llmConnection.status === 'testing'}>
          {t('onboarding.common.next')}
        </Button>
      </div>

      <ApiSetupHelp isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
