// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useRef, useState } from 'react';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { HelpCircle, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { getSettings, testConnection, updateSettings, LLMMode, type SettingsInfo } from '../../api/engine-client';
import { syncAllAus, resolveFileConflict, testWebDAVConnection, type WebDAVConfig } from '../../api/engine-sync';
import { ConflictResolveModal, type ConflictItem } from '../shared/ConflictResolveModal';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';
import { useFeedback } from '../../hooks/useFeedback';
import { changeLanguage, SUPPORTED_LANGUAGES, type AppLanguage } from '../../i18n';
import { ApiSetupHelp } from '../help/ApiSetupHelp';

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
  const [syncTestStatus, setSyncTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncHelpOpen, setSyncHelpOpen] = useState(false);
  const [apiHelpOpen, setApiHelpOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncResultStatus, setSyncResultStatus] = useState<'idle' | 'success' | 'error' | 'conflicts'>('idle');
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [opsConflictDetails, setOpsConflictDetails] = useState<string[]>([]);
  // Map display path → { auPath, filePath } for conflict resolution
  const conflictPathMapRef = useRef<Map<string, { auPath: string; filePath: string }>>(new Map());

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
    setSyncTestStatus('idle');
    setLastSync(null);
    setSyncHelpOpen(false);
    setApiHelpOpen(false);
    setSyncing(false);
    setSyncMessage('');
    setSyncResultStatus('idle');
    setConflicts([]);
    setConflictModalOpen(false);
    setOpsConflictDetails([]);
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
          <div className="space-y-4 border-t border-black/10 pt-5 dark:border-white/10">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-text/90">{t('settings.sync.title')}</h3>
              <Button variant="ghost" size="sm" className="text-xs text-accent" onClick={() => setSyncHelpOpen(!syncHelpOpen)}>
                {syncHelpOpen ? t('common.actions.close') : t('settings.sync.helpButton')}
              </Button>
            </div>

            {syncHelpOpen && (
              <div className="rounded-xl border border-info/20 bg-info/5 p-4 text-sm text-text/80 space-y-3">
                <p className="font-medium text-text/90">{t('settings.sync.help.intro')}</p>
                <div>
                  <p className="font-medium">{t('settings.sync.help.option1Title')}</p>
                  <p className="text-xs text-text/60 mt-1">{t('settings.sync.help.option1Desc')}</p>
                </div>
                <div>
                  <p className="font-medium">{t('settings.sync.help.option2Title')}</p>
                  <p className="text-xs text-text/60 mt-1">{t('settings.sync.help.option2Desc')}</p>
                </div>
                <div className="rounded-lg bg-background/60 p-3 text-xs space-y-1">
                  <p className="font-medium text-text/70">{t('settings.sync.help.stepsTitle')}</p>
                  <p>{t('settings.sync.help.step1')}</p>
                  <p>{t('settings.sync.help.step2')}</p>
                  <p>{t('settings.sync.help.step3')}</p>
                  <p>{t('settings.sync.help.step4')}</p>
                </div>
                <div className="text-xs text-text/50 space-y-1">
                  <p>{t('settings.sync.help.syncScope')}</p>
                  <p>{t('settings.sync.help.notSynced')}</p>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text/80">{t('settings.sync.modeLabel')}</label>
              <select
                value={syncMode}
                onChange={(e) => { setSyncMode(e.target.value as 'none' | 'webdav'); setSyncTestStatus('idle'); }}
                className="h-11 w-full rounded-md border border-black/20 bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent dark:border-white/20 md:h-10 md:w-48 md:text-sm"
              >
                <option value="none">{t('settings.sync.modeNone')}</option>
                <option value="webdav">WebDAV</option>
              </select>
            </div>

            {syncMode === 'webdav' && (
              <div className="space-y-3 rounded-xl border border-black/10 bg-surface/30 p-4 dark:border-white/10">
                <Input label={t('settings.sync.serverUrl')} value={syncUrl} onChange={(e) => setSyncUrl(e.target.value)} placeholder="https://dav.jianguoyun.com/dav/" />
                <Input label={t('settings.sync.username')} value={syncUsername} onChange={(e) => setSyncUsername(e.target.value)} />
                <Input label={t('settings.sync.password')} type="password" value={syncPassword} onChange={(e) => setSyncPassword(e.target.value)} />
                <Input label={t('settings.sync.remoteDir')} value={syncRemoteDir} onChange={(e) => setSyncRemoteDir(e.target.value)} placeholder="/FicForge/" />
                <div className="flex items-center gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      const reqId = modalRequestIdRef.current;
                      setSyncTestStatus('testing');
                      try {
                        const raw = syncUrl.trim();
                        if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
                          setSyncTestStatus('error');
                          return;
                        }
                        const result = await testWebDAVConnection({
                          url: raw,
                          username: syncUsername,
                          password: syncPassword,
                          remote_dir: syncRemoteDir,
                        });
                        if (reqId !== modalRequestIdRef.current) return;
                        setSyncTestStatus(result.success ? 'success' : 'error');
                      } catch {
                        if (reqId !== modalRequestIdRef.current) return;
                        setSyncTestStatus('error');
                      }
                    }}
                    disabled={!syncUrl.trim() || !syncUsername.trim() || syncTestStatus === 'testing'}
                  >
                    {syncTestStatus === 'testing' ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
                    {t('settings.sync.testConnection')}
                  </Button>
                  {syncTestStatus === 'success' && <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 size={14} /> {t('settings.sync.connected')}</span>}
                  {syncTestStatus === 'error' && <span className="flex items-center gap-1 text-xs text-error"><XCircle size={14} /> {t('settings.sync.failed')}</span>}
                </div>
                {lastSync && (
                  <p className="text-xs text-text/40">{t('settings.sync.lastSync')}: {new Date(lastSync).toLocaleString()}</p>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full"
                  onClick={async () => {
                    const syncRequestId = modalRequestIdRef.current;
                    setSyncing(true);
                    setSyncMessage('');
                    setSyncResultStatus('idle');
                    try {
                      const webdavConfig: WebDAVConfig = {
                        url: syncUrl,
                        username: syncUsername,
                        password: syncPassword,
                        remote_dir: syncRemoteDir,
                      };
                      const result = await syncAllAus(webdavConfig);
                      if (syncRequestId !== modalRequestIdRef.current) return;
                      if (result.fileConflicts.length > 0) {
                        const map = new Map<string, { auPath: string; filePath: string }>();
                        const items = result.fileConflicts.map(fc => {
                          const displayPath = `${fc.auPath}/${fc.path}`;
                          map.set(displayPath, { auPath: fc.auPath, filePath: fc.path });
                          return { path: displayPath, localModified: fc.localModified, remoteModified: fc.remoteModified };
                        });
                        conflictPathMapRef.current = map;
                        setConflicts(items);
                        setConflictModalOpen(true);
                        setSyncResultStatus('conflicts');
                        // 冲突 + 错误并存时，两者都显示
                        const msg = t('settings.sync.conflictsFound', { count: result.fileConflicts.length });
                        setSyncMessage(result.errors.length > 0
                          ? `${msg} | ${t('settings.sync.syncError', { message: result.errors[0] })}`
                          : msg);
                      } else if (result.errors.length > 0) {
                        setSyncResultStatus('error');
                        setSyncMessage(t('settings.sync.syncError', { message: result.errors[0] }));
                      } else if (result.opsConflicts && result.opsConflicts.length > 0) {
                        setOpsConflictDetails(result.opsConflicts);
                        setSyncResultStatus('conflicts');
                        setSyncMessage(t('settings.sync.opsConflictsFound', { count: result.opsConflicts.length }));
                      } else {
                        // 完全成功——才更新 last_sync
                        const now = new Date().toISOString();
                        setLastSync(now);
                        await updateSettings({
                          sync: {
                            mode: syncMode,
                            webdav: { url: syncUrl, username: syncUsername, password: syncPassword, remote_dir: syncRemoteDir },
                            last_sync: now,
                          },
                        }).catch((err) => { console.warn('last_sync persist failed:', err); });
                        setSyncResultStatus('success');
                        setSyncMessage(t('settings.sync.syncSuccess'));
                      }
                    } catch (e: any) {
                      if (syncRequestId !== modalRequestIdRef.current) return;
                      setSyncResultStatus('error');
                      setSyncMessage(t('settings.sync.syncError', { message: e?.message || t('error_messages.unknown') }));
                    } finally {
                      if (syncRequestId === modalRequestIdRef.current) {
                        setSyncing(false);
                      }
                    }
                  }}
                  disabled={syncTestStatus !== 'success' || syncing}
                >
                  {syncing ? <><Loader2 size={14} className="mr-1 animate-spin" />{t('settings.sync.syncing')}</> : t('settings.sync.syncNow')}
                </Button>
                {syncMessage && (
                  <p className={`text-xs mt-2 ${syncResultStatus === 'success' ? 'text-success' : syncResultStatus === 'error' ? 'text-error' : 'text-text/60'}`}>
                    {syncMessage}
                  </p>
                )}
                {opsConflictDetails.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {opsConflictDetails.map((detail, i) => (
                      <div key={i} className="text-xs text-text/50">
                        {detail}
                      </div>
                    ))}
                    <p className="text-xs text-text/40 mt-1">{t('settings.sync.opsConflictsMergedHint')}</p>
                  </div>
                )}
              </div>
            )}
          </div>

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
        onResolve={async (path, choice) => {
          try {
            const webdavConfig: WebDAVConfig = { url: syncUrl, username: syncUsername, password: syncPassword, remote_dir: syncRemoteDir };
            const entry = conflictPathMapRef.current.get(path);
            if (entry) {
              await resolveFileConflict(entry.auPath, entry.filePath, choice, webdavConfig);
            }
            // 函数式更新，避免快速连续点击时闭包过期
            let isEmpty = false;
            setConflicts(prev => {
              const remaining = prev.filter(c => c.path !== path);
              isEmpty = remaining.length === 0;
              return remaining;
            });
            if (isEmpty) {
              setConflictModalOpen(false);
              setSyncResultStatus('success');
              setSyncMessage(t('settings.sync.syncSuccess'));
            }
          } catch (e: any) {
            setSyncResultStatus('error');
            setSyncMessage(t('settings.sync.syncError', { message: e?.message || '' }));
          }
        }}
        onResolveAll={async (choice) => {
          const webdavConfig: WebDAVConfig = { url: syncUrl, username: syncUsername, password: syncPassword, remote_dir: syncRemoteDir };
          // 逐个解决，每成功一个就移除，避免部分失败后状态不一致
          const snapshot = [...conflicts];
          let lastError: string | null = null;
          for (const c of snapshot) {
            try {
              const entry = conflictPathMapRef.current.get(c.path);
              if (entry) {
                await resolveFileConflict(entry.auPath, entry.filePath, choice, webdavConfig);
              }
              setConflicts(prev => prev.filter(item => item.path !== c.path));
            } catch (e: any) {
              lastError = e?.message || '';
            }
          }
          if (lastError) {
            setSyncResultStatus('error');
            setSyncMessage(t('settings.sync.syncError', { message: lastError }));
          } else {
            setConflictModalOpen(false);
            setSyncResultStatus('success');
            setSyncMessage(t('settings.sync.syncSuccess'));
          }
        }}
      />
    </Modal>
  );
};
