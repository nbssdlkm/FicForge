import { useEffect, useRef, useState } from 'react';
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from '../../i18n/useAppTranslation';
import { testConnection } from '../../api/settings';
import { StepIndicator } from './StepIndicator';

type Mode = 'api' | 'local' | 'ollama';

type TestResult = { success: boolean; model?: string; message?: string; error_code?: string } | null;

export type ApiConfig = {
  mode: Mode;
  model: string;
  api_base: string;
  api_key: string;
  local_model_path: string;
  ollama_model: string;
};

const DEFAULT_CONFIG: ApiConfig = {
  mode: 'api',
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
  const requestIdRef = useRef(0);
  const [config, setConfig] = useState<ApiConfig>({ ...DEFAULT_CONFIG, ...initialConfig });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
    };
  }, []);

  const update = (field: keyof ApiConfig, value: string) => {
    requestIdRef.current += 1;
    setConfig(prev => ({ ...prev, [field]: value }));
    setTesting(false);
    setTestResult(null); // 修改配置后清除测试结果
  };

  const handleTest = async () => {
    const requestId = ++requestIdRef.current;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection({
        mode: config.mode,
        model: config.mode === 'ollama' ? config.ollama_model : config.model,
        api_base: config.mode === 'ollama' ? (config.api_base || 'http://localhost:11434') : config.api_base,
        api_key: config.mode === 'api' ? config.api_key : '',
        local_model_path: config.mode === 'local' ? config.local_model_path : '',
        ollama_model: config.mode === 'ollama' ? config.ollama_model : '',
      });
      if (requestId !== requestIdRef.current) return;
      setTestResult(result as TestResult);
    } catch (e: any) {
      if (requestId !== requestIdRef.current) return;
      setTestResult({ success: false, message: e.message || t('error_messages.unknown') });
    } finally {
      if (requestId === requestIdRef.current) {
        setTesting(false);
      }
    }
  };

  const canProceed = testResult?.success === true;
  const canTest = testing
    ? false
    : config.mode === 'api'
      ? Boolean(config.api_key.trim())
      : config.mode === 'local'
        ? Boolean(config.local_model_path.trim())
        : Boolean(config.ollama_model.trim());

  return (
    <div className="max-w-lg mx-auto space-y-6 py-8">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-serif font-bold">{t('onboarding.apiConfig.title')}</h2>
        <StepIndicator current={2} total={4} />
      </div>

      {/* Mode selector */}
      <div className="space-y-2">
        {(['api', 'local', 'ollama'] as Mode[]).map(mode => (
          <label key={mode} className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="mode"
              checked={config.mode === mode}
              onChange={() => { update('mode', mode); }}
              className="accent-accent"
            />
            <span className="text-sm">{t(`onboarding.apiConfig.mode${mode.charAt(0).toUpperCase() + mode.slice(1)}`)}</span>
          </label>
        ))}
      </div>

      {/* API mode fields */}
      {config.mode === 'api' && (
        <div className="space-y-4 border-t border-black/10 dark:border-white/10 pt-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-text/80">{t('onboarding.apiConfig.apiBase')}</label>
            <Input value={config.api_base} onChange={e => update('api_base', e.target.value)} placeholder="https://api.deepseek.com" disabled={testing} />
            <p className="text-xs text-text/40">{t('onboarding.apiConfig.apiBaseHint')}</p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-text/80">{t('onboarding.apiConfig.apiKey')}</label>
            <Input type="password" value={config.api_key} onChange={e => update('api_key', e.target.value)} placeholder="sk-..." disabled={testing} />
            <p className="text-xs text-text/40">{t('onboarding.apiConfig.apiKeyHint')}</p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-text/80">{t('onboarding.apiConfig.model')}</label>
            <Input value={config.model} onChange={e => update('model', e.target.value)} placeholder="deepseek-chat" disabled={testing} />
          </div>
        </div>
      )}

      {/* Local mode fields */}
      {config.mode === 'local' && (
        <div className="space-y-4 border-t border-black/10 dark:border-white/10 pt-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-text/80">{t('onboarding.apiConfig.localPath')}</label>
            <Input value={config.local_model_path} onChange={e => update('local_model_path', e.target.value)} placeholder="/path/to/model" disabled={testing} />
            <p className="text-xs text-text/40">{t('onboarding.apiConfig.localPathHint')}</p>
          </div>
        </div>
      )}

      {/* Ollama mode fields */}
      {config.mode === 'ollama' && (
        <div className="space-y-4 border-t border-black/10 dark:border-white/10 pt-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-text/80">{t('onboarding.apiConfig.ollamaBase')}</label>
            <Input value={config.api_base} onChange={e => update('api_base', e.target.value)} placeholder="http://localhost:11434" disabled={testing} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-text/80">{t('onboarding.apiConfig.ollamaModel')}</label>
            <Input value={config.ollama_model} onChange={e => update('ollama_model', e.target.value)} placeholder="llama3" disabled={testing} />
          </div>
        </div>
      )}

      {/* Test connection */}
      <div className="space-y-3">
        <Button variant="secondary" onClick={handleTest} disabled={!canTest} className="w-full">
          {testing ? <><Loader2 size={14} className="animate-spin mr-2" />{t('onboarding.apiConfig.testing')}</> : t('onboarding.apiConfig.testConnection')}
        </Button>

        {testResult && (
          <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-md ${testResult.success ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
            {testResult.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            <span>
              {testResult.success
                ? t('onboarding.apiConfig.testSuccess', { model: testResult.model || config.model })
                : t('onboarding.apiConfig.testFailed', { message: testResult.message || '' })}
            </span>
          </div>
        )}

        {!canProceed && testResult === null && (
          <p className="text-xs text-text/40 text-center">{t('onboarding.apiConfig.requireTest')}</p>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onPrev} disabled={testing}>{t('onboarding.common.prev')}</Button>
        <Button variant="primary" onClick={() => onNext(config)} disabled={!canProceed || testing}>
          {t('onboarding.common.next')}
        </Button>
      </div>
    </div>
  );
}
