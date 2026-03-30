import { useState, useEffect } from 'react';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { getSettings, updateSettings } from '../../api/settings';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';
import { useFeedback } from '../../hooks/useFeedback';

export const GlobalSettingsModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  
  const [settings, setSettings] = useState<any>(null);

  // Form states
  const [mode, setMode] = useState('api');
  const [model, setModel] = useState('deepseek-chat');
  const [apiBase, setApiBase] = useState('https://api.deepseek.com');
  const [apiKey, setApiKey] = useState('');
  const [contextWindow, setContextWindow] = useState(128000);
  const [embeddingModel, setEmbeddingModel] = useState('nomic-embed-text');

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      getSettings().then(res => {
        setSettings(res);
        if (res?.default_llm) {
          setMode(res.default_llm.mode || 'api');
          setModel(res.default_llm.model || 'deepseek-chat');
          setApiBase(res.default_llm.api_base || 'https://api.deepseek.com');
          setApiKey(res.default_llm.api_key || '');
          setContextWindow(res.default_llm.context_window || 128000);
        }
        setEmbeddingModel(res?.embedding?.model || 'nomic-embed-text');
      }).catch(e => {
        showError(e, t("error_messages.unknown"));
      }).finally(() => setLoading(false));
    } else {
      setTestStatus('idle');
      setTestMessage('');
    }
  }, [isOpen]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const newSettings = {
        ...settings,
        default_llm: {
          ...settings.default_llm,
          mode,
          model,
          api_base: apiBase,
          api_key: apiKey,
          context_window: contextWindow,
        },
        embedding: {
          ...settings.embedding,
          model: embeddingModel,
        },
      };
      await updateSettings('./fandoms', newSettings);
      onClose();
    } catch (e: any) {
      showError(e, t("error_messages.unknown"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTestStatus('testing');
    setTestMessage('');
    try {
      // Basic Frontend CORS-allowed OpenAI format test
      // Depending on the API provider, some block preflight, but let's attempt it
      const url = apiBase.endsWith('/') ? `${apiBase}v1/models` : `${apiBase}/v1/models`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (res.ok) {
        setTestStatus('success');
        setTestMessage(t('settings.global.connectionSuccess'));
      } else {
         const err = await res.json().catch(() => ({}));
         throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
    } catch (e: any) {
      setTestStatus('error');
      setTestMessage(`${t('settings.global.testFailedPrefix')}${e.message}`);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("settings.global.title")}>
      {loading ? (
        <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <div className="space-y-6 mt-4">
          <div className="p-4 bg-info/10 text-info text-sm rounded-lg border border-info/20 leading-relaxed font-sans">
            {t("settings.global.description")}
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">{t("common.labels.searchMode")}</label>
              <select value={mode} onChange={(e) => setMode(e.target.value)} className="h-10 rounded-md border border-black/20 dark:border-white/20 bg-background px-3 text-sm focus:ring-2 focus:ring-accent outline-none">
                <option value="api">{getEnumLabel("llm_mode", "api", "api")}</option>
                <option value="local">{getEnumLabel("llm_mode", "local", "local")}</option>
                <option value="ollama">{getEnumLabel("llm_mode", "ollama", "ollama")}</option>
              </select>
              <p className="text-xs text-text/50">{t(`common.help.llmMode.${mode}`)}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">{t("settings.global.defaultModel")}</label>
              <Input value={model} onChange={e => setModel(e.target.value)} placeholder="deepseek-chat" />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">{t("common.labels.apiBase")}</label>
              <Input value={apiBase} onChange={e => setApiBase(e.target.value)} placeholder="https://api.deepseek.com" />
              <p className="text-xs text-text/50">{t("common.help.apiBase")}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">{t("common.labels.apiKey")}</label>
              <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />
              <p className="text-xs text-text/50">{t("common.help.apiKey")}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">{t("common.labels.contextWindow")}</label>
              <Input type="number" value={contextWindow} onChange={e => setContextWindow(parseInt(e.target.value, 10) || 0)} />
              <p className="text-xs text-text/50">{t("common.help.contextWindow")}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">{t("common.labels.searchEngineModel")}</label>
              <Input value={embeddingModel} onChange={e => setEmbeddingModel(e.target.value)} placeholder="nomic-embed-text" />
              <p className="text-xs text-text/50">{t("common.help.searchEngineModel")}</p>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <div className="flex-1 flex items-center pr-4">
               {testStatus === 'testing' && <span className="text-xs text-text/60 flex items-center"><Loader2 size={14} className="animate-spin mr-1"/> {t("common.status.testing")}</span>}
               {testStatus === 'success' && <span className="text-xs text-success flex items-center"><CheckCircle2 size={14} className="mr-1"/> {testMessage}</span>}
               {testStatus === 'error' && <span className="text-xs text-error flex items-start"><XCircle size={14} className="mr-1 shrink-0 mt-0.5"/> <span className="leading-tight">{testMessage}</span></span>}
            </div>
            <Button variant="secondary" size="sm" onClick={handleTest} disabled={testStatus === 'testing' || !apiKey.trim()}>
              {t("common.actions.testConnection")}
            </Button>
          </div>

          <div className="border-t border-black/10 dark:border-white/10 pt-5 flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose}>{t("common.actions.cancel")}</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving} className="w-32">
              {saving ? <Loader2 size={16} className="animate-spin" /> : t("common.actions.saveGlobalSettings")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
