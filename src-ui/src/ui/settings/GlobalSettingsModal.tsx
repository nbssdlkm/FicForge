import { useEffect, useRef, useState } from 'react';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { getSettings, testConnection, updateSettings, type SettingsInfo } from '../../api/settings';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';
import { useFeedback } from '../../hooks/useFeedback';
import { changeLanguage, SUPPORTED_LANGUAGES, type AppLanguage } from '../../i18n';

export const GlobalSettingsModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const { t, i18n } = useTranslation();
  const { showError } = useFeedback();
  const modalRequestIdRef = useRef(0);
  const testRequestIdRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const [settings, setSettings] = useState<SettingsInfo | null>(null);

  const [mode, setMode] = useState('api');
  const [model, setModel] = useState('deepseek-chat');
  const [localModelPath, setLocalModelPath] = useState('');
  const [ollamaModel, setOllamaModel] = useState('');
  const [apiBase, setApiBase] = useState('https://api.deepseek.com');
  const [apiKey, setApiKey] = useState('');
  const [contextWindow, setContextWindow] = useState(128000);
  const [embeddingModel, setEmbeddingModel] = useState('');
  const [embeddingApiBase, setEmbeddingApiBase] = useState('');
  const [embeddingApiKey, setEmbeddingApiKey] = useState('');
  const [useCustomEmbedding, setUseCustomEmbedding] = useState(false);

  const resetFormState = () => {
    setSettings(null);
    setMode('api');
    setModel('deepseek-chat');
    setLocalModelPath('');
    setOllamaModel('');
    setApiBase('https://api.deepseek.com');
    setApiKey('');
    setContextWindow(128000);
    setEmbeddingModel('');
    setEmbeddingApiBase('');
    setEmbeddingApiKey('');
    setUseCustomEmbedding(false);
  };

  useEffect(() => {
    testRequestIdRef.current += 1;
    setTestStatus('idle');
    setTestMessage('');
  }, [mode, model, localModelPath, ollamaModel, apiBase, apiKey, contextWindow, embeddingModel]);

  useEffect(() => {
    if (isOpen) {
      const requestId = ++modalRequestIdRef.current;
      setLoading(true);
      resetFormState();
      getSettings().then((res) => {
        if (requestId !== modalRequestIdRef.current) return;
        setSettings(res);
        if (res?.default_llm) {
          const nextMode = res.default_llm.mode || 'api';
          setMode(nextMode);
          setModel(res.default_llm.model || 'deepseek-chat');
          setLocalModelPath(res.default_llm.local_model_path || '');
          setOllamaModel(res.default_llm.ollama_model || res.default_llm.model || '');
          setApiBase(
            res.default_llm.api_base
            || (nextMode === 'ollama' ? 'http://localhost:11434' : 'https://api.deepseek.com')
          );
          setApiKey(res.default_llm.api_key || '');
          setContextWindow(res.default_llm.context_window || 128000);
        }
        setEmbeddingModel(res?.embedding?.model || '');
        setEmbeddingApiBase(res?.embedding?.api_base || '');
        setEmbeddingApiKey(res?.embedding?.api_key || '');
        setUseCustomEmbedding(!!(res?.embedding?.model && res?.embedding?.api_key));
      }).catch((error) => {
        if (requestId !== modalRequestIdRef.current) return;
        showError(error, t('error_messages.unknown'));
      }).finally(() => {
        if (requestId === modalRequestIdRef.current) {
          setLoading(false);
        }
      });
    } else {
      modalRequestIdRef.current += 1;
      testRequestIdRef.current += 1;
      resetFormState();
      setLoading(false);
      setSaving(false);
      setTestStatus('idle');
      setTestMessage('');
    }
  }, [isOpen, showError, t]);

  const handleSave = async () => {
    if (!settings) return;
    const requestId = modalRequestIdRef.current;
    setSaving(true);
    try {
      const newSettings = {
        ...settings,
        default_llm: {
          ...settings.default_llm,
          mode,
          model: mode === 'api' ? model : '',
          api_base: mode === 'ollama' ? (apiBase || 'http://localhost:11434') : apiBase,
          api_key: mode === 'api' ? apiKey : '',
          local_model_path: mode === 'local' ? localModelPath : '',
          ollama_model: mode === 'ollama' ? ollamaModel : '',
          context_window: contextWindow,
        },
        embedding: {
          ...settings.embedding,
          mode: useCustomEmbedding ? 'api' : 'local',
          model: useCustomEmbedding ? embeddingModel : '',
          api_base: useCustomEmbedding ? embeddingApiBase : '',
          api_key: useCustomEmbedding ? embeddingApiKey : '',
        },
      };
      await updateSettings(newSettings);
      if (requestId !== modalRequestIdRef.current) return;
      onClose();
    } catch (error) {
      if (requestId !== modalRequestIdRef.current) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (requestId === modalRequestIdRef.current) {
        setSaving(false);
      }
    }
  };

  const handleTest = async () => {
    const requestId = ++testRequestIdRef.current;
    setTestStatus('testing');
    setTestMessage('');
    try {
      const result = await testConnection({
        mode,
        model: mode === 'ollama' ? ollamaModel : model,
        api_base: mode === 'ollama' ? (apiBase || 'http://localhost:11434') : apiBase,
        api_key: mode === 'api' ? apiKey : '',
        local_model_path: mode === 'local' ? localModelPath : '',
        ollama_model: mode === 'ollama' ? ollamaModel : '',
      });
      if (requestId !== testRequestIdRef.current) return;
      if (result.success) {
        setTestStatus('success');
        setTestMessage(result.message || t('settings.global.connectionSuccess'));
      } else {
        setTestStatus('error');
        setTestMessage(result.message || t('error_messages.unknown'));
      }
    } catch (error: any) {
      if (requestId !== testRequestIdRef.current) return;
      setTestStatus('error');
      setTestMessage(`${t('settings.global.testFailedPrefix')}${error.message}`);
    }
  };

  const testRequiresApiKey = mode === 'api';
  const testRequiresLocalPath = mode === 'local';
  const testRequiresOllamaModel = mode === 'ollama';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('settings.global.title')}>
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <div className="mt-4 space-y-6">
          <div className="rounded-lg border border-info/20 bg-info/10 p-4 text-sm font-sans leading-relaxed text-info">
            {t('settings.global.description')}
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">{t('common.labels.searchMode')}</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                disabled={saving}
                className="h-10 rounded-md border border-black/20 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent disabled:opacity-60 dark:border-white/20"
              >
                <option value="api">{getEnumLabel('llm_mode', 'api', 'api')}</option>
                <option value="local">{getEnumLabel('llm_mode', 'local', 'local')}</option>
                <option value="ollama">{getEnumLabel('llm_mode', 'ollama', 'ollama')}</option>
              </select>
              <p className="text-xs text-text/50">{t(`common.help.llmMode.${mode}`)}</p>
            </div>

            {mode === 'api' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-bold text-text/90">{t('settings.global.defaultModel')}</label>
                  <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" disabled={saving} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-bold text-text/90">{t('common.labels.apiBase')}</label>
                  <Input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.deepseek.com" disabled={saving} />
                  <p className="text-xs text-text/50">{t('common.help.apiBase')}</p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-bold text-text/90">{t('common.labels.apiKey')}</label>
                  <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." disabled={saving} />
                  <p className="text-xs text-text/50">{t('common.help.apiKey')}</p>
                </div>
              </>
            )}

            {mode === 'local' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-bold text-text/90">{t('common.labels.localModelPath')}</label>
                <Input value={localModelPath} onChange={(e) => setLocalModelPath(e.target.value)} placeholder="/path/to/model" disabled={saving} />
                <p className="text-xs text-text/50">{t('common.help.localModelPath')}</p>
              </div>
            )}

            {mode === 'ollama' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-bold text-text/90">{t('common.labels.apiBase')}</label>
                  <Input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="http://localhost:11434" disabled={saving} />
                  <p className="text-xs text-text/50">{t('common.help.apiBase')}</p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-bold text-text/90">{t('common.labels.ollamaModel')}</label>
                  <Input value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)} placeholder="llama3" disabled={saving} />
                  <p className="text-xs text-text/50">{t('common.help.ollamaModel')}</p>
                </div>
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">{t('common.labels.contextWindow')}</label>
              <Input type="number" value={contextWindow} onChange={(e) => setContextWindow(parseInt(e.target.value, 10) || 0)} disabled={saving} />
              <p className="text-xs text-text/50">{t('common.help.contextWindow')}</p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-bold text-text/90">{t('common.labels.searchEngineModel')}</label>
              <p className="text-xs text-text/50">{t('settings.global.builtinEmbedding')}</p>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-text/70">
                <input type="checkbox" checked={useCustomEmbedding} onChange={e => setUseCustomEmbedding(e.target.checked)} disabled={saving} className="accent-accent" />
                {t('settings.global.useCustomEmbedding')}
              </label>
              {useCustomEmbedding && (
                <div className="space-y-2 pl-2 border-l-2 border-accent/30">
                  <Input value={embeddingModel} onChange={e => setEmbeddingModel(e.target.value)} placeholder={t('settings.global.embeddingModelPlaceholder')} disabled={saving} className="h-8 text-sm" />
                  <Input value={embeddingApiBase} onChange={e => setEmbeddingApiBase(e.target.value)} placeholder={t('settings.global.embeddingApiBasePlaceholder')} disabled={saving} className="h-8 text-sm" />
                  <Input value={embeddingApiKey} onChange={e => setEmbeddingApiKey(e.target.value)} placeholder={t('settings.global.embeddingApiKeyPlaceholder')} disabled={saving} className="h-8 text-sm" type="password" />
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="flex flex-1 items-center pr-4">
              {testStatus === 'testing' && <span className="flex items-center text-xs text-text/60"><Loader2 size={14} className="mr-1 animate-spin" /> {t('common.status.testing')}</span>}
              {testStatus === 'success' && <span className="flex items-center text-xs text-success"><CheckCircle2 size={14} className="mr-1" /> {testMessage}</span>}
              {testStatus === 'error' && <span className="flex items-start text-xs text-error"><XCircle size={14} className="mr-1 mt-0.5 shrink-0" /> <span className="leading-tight">{testMessage}</span></span>}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleTest}
              disabled={
                saving
                || testStatus === 'testing'
                || (testRequiresApiKey && !apiKey.trim())
                || (testRequiresLocalPath && !localModelPath.trim())
                || (testRequiresOllamaModel && !ollamaModel.trim())
              }
            >
              {t('common.actions.testConnection')}
            </Button>
          </div>

          {/* Language Selector */}
          <div className="space-y-2 border-t border-black/10 pt-5 dark:border-white/10">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">{t('settings.global.languageLabel')}</label>
              <select
                value={i18n.language}
                onChange={async (e) => { await changeLanguage(e.target.value as AppLanguage); }}
                className="h-10 w-48 rounded-md border border-black/20 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-white/20"
              >
                {SUPPORTED_LANGUAGES.map(lang => (
                  <option key={lang} value={lang}>
                    {lang === 'zh' ? '中文' : 'English'}
                  </option>
                ))}
              </select>
              <p className="text-xs text-text/50">{t('settings.global.languageDescription')}</p>
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-black/10 pt-5 dark:border-white/10">
            <Button variant="ghost" onClick={onClose} disabled={saving}>{t('common.actions.cancel')}</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving || !settings} className="w-32">
              {saving ? <Loader2 size={16} className="animate-spin" /> : t('common.actions.saveGlobalSettings')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
