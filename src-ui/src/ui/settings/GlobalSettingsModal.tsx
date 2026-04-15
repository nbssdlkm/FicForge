// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useRef, useState } from 'react';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { HelpCircle, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { getSettings, testConnection, testEmbeddingConnection, updateSettings, LLMMode, type SettingsInfo, getDataDir, getDisplayDataDir } from '../../api/engine-client';
import { ConflictResolveModal } from '../shared/ConflictResolveModal';
import { useSyncOperations } from './useSyncOperations';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';
import { useFeedback } from '../../hooks/useFeedback';
import { DebugLogsSection } from './DebugLogsSection';
import { changeLanguage, SUPPORTED_LANGUAGES, type AppLanguage } from '../../i18n';
import { ApiSetupHelp } from '../help/ApiSetupHelp';
import { GlobalSettingsSyncSection } from './GlobalSettingsSyncSection';

/** Tauri 环境检测 */
const isTauri = () => typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

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

  const [mode, setMode] = useState<LLMMode>(LLMMode.API);
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
  const [syncMode, setSyncMode] = useState<'none' | 'webdav'>('none');
  const [syncUrl, setSyncUrl] = useState('');
  const [syncUsername, setSyncUsername] = useState('');
  const [syncPassword, setSyncPassword] = useState('');
  const [syncRemoteDir, setSyncRemoteDir] = useState('/FicForge/');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [apiHelpOpen, setApiHelpOpen] = useState(false);
  const [displayDataDir, setDisplayDataDir] = useState('');
  const [embTestStatus, setEmbTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [embTestMessage, setEmbTestMessage] = useState('');
  const embTestIdRef = useRef(0);

  const syncOps = useSyncOperations({ url: syncUrl, username: syncUsername, password: syncPassword, remote_dir: syncRemoteDir });
  const {
    conflicts,
    conflictModalOpen, setConflictModalOpen,
    handleResolveConflict, handleResolveAllConflicts,
    resetSyncState,
  } = syncOps;

  const resetFormState = () => {
    setSettings(null);
    setMode(LLMMode.API);
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
    setSyncMode('none');
    setSyncUrl('');
    setSyncUsername('');
    setSyncPassword('');
    setSyncRemoteDir('/FicForge/');
    setLastSync(null);
    setApiHelpOpen(false);
    resetSyncState();
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
      // 异步获取显示用路径（Capacitor 返回 file:// URI，Tauri 返回绝对路径，Web 返回空）
      getDisplayDataDir().then((dir) => {
        if (requestId === modalRequestIdRef.current) setDisplayDataDir(dir);
      }).catch(() => {});
      getSettings().then((res) => {
        if (requestId !== modalRequestIdRef.current) return;
        setSettings(res);
        if (res?.default_llm) {
          const nextMode = res.default_llm.mode || LLMMode.API;
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
        const sync = res.sync;
        if (sync) {
          setSyncMode(sync.mode || 'none');
          if (sync.webdav) {
            setSyncUrl(sync.webdav.url || '');
            setSyncUsername(sync.webdav.username || '');
            setSyncPassword(sync.webdav.password || '');
            setSyncRemoteDir(sync.webdav.remote_dir || '/FicForge/');
          }
          setLastSync(sync.last_sync || null);
        }
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
  }, [isOpen]);

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
          mode: (useCustomEmbedding || !isTauri()) ? LLMMode.API : LLMMode.LOCAL,
          model: (useCustomEmbedding || !isTauri()) ? embeddingModel : '',
          api_base: (useCustomEmbedding || !isTauri()) ? embeddingApiBase : '',
          api_key: (useCustomEmbedding || !isTauri()) ? embeddingApiKey : '',
        },
        sync: {
          mode: syncMode,
          ...(syncMode === 'webdav' ? {
            webdav: { url: syncUrl, username: syncUsername, password: syncPassword, remote_dir: syncRemoteDir },
          } : {}),
          ...(lastSync ? { last_sync: lastSync } : {}),
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
        setTestMessage(t('settings.global.connectionSuccess'));
      } else {
        setTestStatus('error');
        setTestMessage(result.message || t('error_messages.unknown'));
      }
    } catch (error: any) {
      if (requestId !== testRequestIdRef.current) return;
      setTestStatus('error');
      setTestMessage(`${t('settings.global.testFailedPrefix')}${error?.message || t('error_messages.unknown')}`);
    }
  };

  const handleEmbeddingTest = async () => {
    const requestId = ++embTestIdRef.current;
    setEmbTestStatus('testing');
    setEmbTestMessage('');
    try {
      const base = embeddingApiBase || apiBase;
      const key = embeddingApiKey || apiKey;
      const result = await testEmbeddingConnection({ api_base: base, api_key: key, model: embeddingModel });
      if (requestId !== embTestIdRef.current) return;
      if (result.success) {
        setEmbTestStatus('success');
        setEmbTestMessage(`${t('settings.global.connectionSuccess')} dim=${result.dimension}`);
      } else {
        setEmbTestStatus('error');
        setEmbTestMessage(result.message || t('error_messages.unknown'));
      }
    } catch (error: any) {
      if (requestId !== embTestIdRef.current) return;
      setEmbTestStatus('error');
      setEmbTestMessage(error?.message || t('error_messages.unknown'));
    }
  };

  const testRequiresApiKey = mode === 'api';
  const testRequiresLocalPath = mode === 'local';
  const testRequiresOllamaModel = mode === 'ollama';

  return (
    <Modal isOpen={isOpen} onClose={saving ? () => {} : onClose} title={t('settings.global.title')}>
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <div className="mt-4 space-y-6">
          <div className="rounded-lg border border-info/20 bg-info/10 p-4 text-sm font-sans leading-relaxed text-info">
            {t('settings.global.description')}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-text/90">{t('common.labels.searchMode')}</span>
              <Button variant="ghost" size="sm" className="text-xs text-accent" onClick={() => setApiHelpOpen(true)}>
                <HelpCircle size={14} className="mr-1" />
                {t('settings.sync.helpButton')}
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as LLMMode)}
                disabled={saving}
                className="h-11 rounded-md border border-black/20 bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent disabled:opacity-60 dark:border-white/20 md:h-10 md:text-sm"
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
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-text/90">{t('common.labels.searchEngineModel')}</label>
                <Button variant="ghost" size="sm" className="text-xs text-accent" onClick={() => setApiHelpOpen(true)}>
                  <HelpCircle size={14} className="mr-1" />
                  {t('settings.sync.helpButton')}
                </Button>
              </div>
              {isTauri() ? (
                <>
                  <p className="text-xs text-text/50">{t('settings.global.builtinEmbedding')}</p>
                  <label className="flex min-h-[44px] items-center gap-2 cursor-pointer text-sm text-text/70">
                    <input type="checkbox" checked={useCustomEmbedding} onChange={e => setUseCustomEmbedding(e.target.checked)} disabled={saving} className="accent-accent" />
                    {t('settings.global.useCustomEmbedding')}
                  </label>
                </>
              ) : (
                <p className="text-xs text-text/50">{t('settings.global.embeddingMobileHint')}</p>
              )}
              {(useCustomEmbedding || !isTauri()) && (
                <div className="space-y-2 pl-2 border-l-2 border-accent/30">
                  <Input value={embeddingModel} onChange={e => setEmbeddingModel(e.target.value)} placeholder={t('settings.global.embeddingModelPlaceholder')} disabled={saving} className="h-11 text-base md:h-8 md:text-sm" />
                  <Input value={embeddingApiBase} onChange={e => setEmbeddingApiBase(e.target.value)} placeholder={t('settings.global.embeddingApiBasePlaceholder')} disabled={saving} className="h-11 text-base md:h-8 md:text-sm" />
                  <Input value={embeddingApiKey} onChange={e => setEmbeddingApiKey(e.target.value)} placeholder={t('settings.global.embeddingApiKeyPlaceholder')} disabled={saving} className="h-11 text-base md:h-8 md:text-sm" type="password" />
                  <div className="flex items-center gap-2 pt-1">
                    <Button variant="secondary" size="sm" onClick={handleEmbeddingTest} disabled={saving || embTestStatus === 'testing' || !embeddingModel.trim()}>
                      {embTestStatus === 'testing' ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
                      {t('common.actions.testConnection')}
                    </Button>
                    {embTestStatus === 'success' && <span className="flex items-center text-xs text-success"><CheckCircle2 size={14} className="mr-1" /> {embTestMessage}</span>}
                    {embTestStatus === 'error' && <span className="flex items-start text-xs text-error"><XCircle size={14} className="mr-1 mt-0.5 shrink-0" /> <span className="leading-tight">{embTestMessage}</span></span>}
                  </div>
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

          {/* Sync Settings */}
          <GlobalSettingsSyncSection
            syncMode={syncMode}
            setSyncMode={setSyncMode}
            syncUrl={syncUrl}
            setSyncUrl={setSyncUrl}
            syncUsername={syncUsername}
            setSyncUsername={setSyncUsername}
            syncPassword={syncPassword}
            setSyncPassword={setSyncPassword}
            syncRemoteDir={syncRemoteDir}
            setSyncRemoteDir={setSyncRemoteDir}
            lastSync={lastSync}
            setLastSync={setLastSync}
            syncOps={syncOps}
          />

          {/* Language Selector */}
          <div className="space-y-2 border-t border-black/10 pt-5 dark:border-white/10">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">{t('settings.global.languageLabel')}</label>
              <select
                value={i18n.resolvedLanguage === 'en' ? 'en' : 'zh'}
                onChange={(e) => { changeLanguage(e.target.value as AppLanguage).catch((err) => showError(err, t('error_messages.unknown'))); }}
                className="h-11 w-full rounded-md border border-black/20 bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent dark:border-white/20 md:h-10 md:w-48 md:text-sm"
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

          {/* 数据存储路径 */}
          <div className="space-y-1 border-t border-black/10 pt-5 dark:border-white/10">
            <label className="text-sm font-bold text-text/90">{t('settings.global.dataPathLabel')}</label>
            <p className="rounded-md bg-black/5 px-3 py-2 font-mono text-xs text-text/60 dark:bg-white/5">
              {displayDataDir || getDataDir() || t('settings.global.dataPathDefault')}
            </p>
            <p className="text-xs text-text/40">{t('settings.global.dataPathHint')}</p>
          </div>

          <DebugLogsSection />

          <p className="text-[11px] text-text/35 leading-relaxed mt-4">{t('ethics.aboutFooter')}</p>

          <div className="flex justify-end gap-3 border-t border-black/10 pt-5 dark:border-white/10">
            <Button variant="ghost" onClick={onClose} disabled={saving}>{t('common.actions.cancel')}</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving || !settings} className="w-32">
              {saving ? <Loader2 size={16} className="animate-spin" /> : t('common.actions.saveGlobalSettings')}
            </Button>
          </div>
        </div>
      )}
      <ApiSetupHelp isOpen={apiHelpOpen} onClose={() => setApiHelpOpen(false)} />
      <ConflictResolveModal
        isOpen={conflictModalOpen}
        onClose={() => setConflictModalOpen(false)}
        conflicts={conflicts}
        onResolve={handleResolveConflict}
        onResolveAll={handleResolveAllConflicts}
      />
    </Modal>
  );
};
