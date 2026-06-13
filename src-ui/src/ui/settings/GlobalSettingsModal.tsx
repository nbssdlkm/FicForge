// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useState } from 'react';
import { Spinner } from "../shared/Spinner";
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { HelpCircle, CheckCircle2, XCircle } from 'lucide-react';
import { ModelSelector } from '../shared/ModelSelector';
import { getSettingsForEditing, saveAppPreferences, saveGlobalSettingsForEditing, LLMMode, type SettingsInfo, getDataDir, getDisplayDataDir } from '../../api/engine-client';
import { WRITING_MODES, type WritingMode } from '@ficforge/engine';
import { useWritingMode, writeWritingModeMirror } from '../../hooks/useWritingMode';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import { DebugLogsSection } from './DebugLogsSection';
import { changeLanguage, SUPPORTED_LANGUAGES, type AppLanguage } from '../../i18n';
import { ApiSetupHelp } from '../help/ApiSetupHelp';
import { LlmModeSelect } from './LlmModeSelect';
import { FontSettingsSection } from './FontSettingsSection';
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import { isTauri } from '../../utils/platform';
import { useEmbeddingConnectionTest, useLlmConnectionTest } from '../../hooks/useConnectionTest';
import { canTestLlmConnection } from '../shared/llm-config';
import { SecretStorageNotice } from '../shared/SecretStorageNotice';
import {
  buildGlobalSettingsSaveInput,
  createDefaultGlobalSettingsFormState,
  hydrateGlobalSettingsForm,
} from './form-mappers';
import { DEFAULT_DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_API_BASE, DEFAULT_CONTEXT_WINDOW } from '../../config/defaults';

export const GlobalSettingsModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const { t, i18n } = useTranslation();
  const { showError, showSuccess } = useFeedback();
  const { mode: writingMode, refresh: refreshWritingMode } = useWritingMode();
  const modalGuard = useActiveRequestGuard(isOpen ? 'global-settings-open' : 'global-settings-closed');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [settings, setSettings] = useState<SettingsInfo | null>(null);

  const [mode, setMode] = useState<LLMMode>(LLMMode.API);
  const [model, setModel] = useState(DEFAULT_DEEPSEEK_MODEL);
  const [localModelPath, setLocalModelPath] = useState('');
  const [ollamaModel, setOllamaModel] = useState('');
  const [apiBase, setApiBase] = useState(DEFAULT_DEEPSEEK_API_BASE);
  const [apiKey, setApiKey] = useState('');
  const [contextWindow, setContextWindow] = useState(DEFAULT_CONTEXT_WINDOW);
  const [embeddingModel, setEmbeddingModel] = useState('');
  const [embeddingApiBase, setEmbeddingApiBase] = useState('');
  const [embeddingApiKey, setEmbeddingApiKey] = useState('');
  const [useCustomEmbedding, setUseCustomEmbedding] = useState(false);
  const [apiHelpOpen, setApiHelpOpen] = useState(false);
  const [displayDataDir, setDisplayDataDir] = useState('');

  const llmConnection = useLlmConnectionTest({
    getSuccessMessage: () => t('settings.global.connectionSuccess'),
    getFailureMessage: (result) => result.message || t('error_messages.unknown'),
    getExceptionMessage: (error) => `${t('settings.global.testFailedPrefix')}${error instanceof Error ? error.message || t('error_messages.unknown') : t('error_messages.unknown')}`,
  });
  const embeddingConnection = useEmbeddingConnectionTest({
    getSuccessMessage: (result) => `${t('settings.global.connectionSuccess')} dim=${result.dimension}`,
    getFailureMessage: (result) => result.message || t('error_messages.unknown'),
    getExceptionMessage: (error) => error instanceof Error ? error.message || t('error_messages.unknown') : t('error_messages.unknown'),
  });

  const resetFormState = () => {
    const defaults = createDefaultGlobalSettingsFormState();
    setSettings(null);
    setMode(defaults.mode);
    setModel(defaults.model);
    setLocalModelPath(defaults.localModelPath);
    setOllamaModel(defaults.ollamaModel);
    setApiBase(defaults.apiBase);
    setApiKey(defaults.apiKey);
    setContextWindow(defaults.contextWindow);
    setEmbeddingModel(defaults.embeddingModel);
    setEmbeddingApiBase(defaults.embeddingApiBase);
    setEmbeddingApiKey(defaults.embeddingApiKey);
    setUseCustomEmbedding(defaults.useCustomEmbedding);
    setApiHelpOpen(false);
  };

  useEffect(() => {
    llmConnection.reset();
  }, [mode, model, localModelPath, ollamaModel, apiBase, apiKey, contextWindow, embeddingModel]);

  useEffect(() => {
    if (isOpen) {
      const token = modalGuard.start();
      setLoading(true);
      resetFormState();
      getDisplayDataDir().then((dir) => {
        if (!modalGuard.isStale(token)) setDisplayDataDir(dir);
      }).catch(() => {});
      getSettingsForEditing().then((res) => {
        if (modalGuard.isStale(token)) return;
        setSettings(res);
        const form = hydrateGlobalSettingsForm(res);
        setMode(form.mode);
        setModel(form.model);
        setLocalModelPath(form.localModelPath);
        setOllamaModel(form.ollamaModel);
        setApiBase(form.apiBase);
        setApiKey(form.apiKey);
        setContextWindow(form.contextWindow);
        setEmbeddingModel(form.embeddingModel);
        setEmbeddingApiBase(form.embeddingApiBase);
        setEmbeddingApiKey(form.embeddingApiKey);
        setUseCustomEmbedding(form.useCustomEmbedding);
      }).catch((error) => {
        if (modalGuard.isStale(token)) return;
        showError(error, t('error_messages.unknown'));
      }).finally(() => {
        if (!modalGuard.isStale(token)) {
          setLoading(false);
        }
      });
    } else {
      llmConnection.reset();
      resetFormState();
      setLoading(false);
      setSaving(false);
    }
  }, [isOpen]);

  const handleSave = async () => {
    if (!settings) return;
    const token = modalGuard.start();
    setSaving(true);
    try {
      await saveGlobalSettingsForEditing(buildGlobalSettingsSaveInput({
        mode,
        model,
        localModelPath,
        ollamaModel,
        apiBase,
        apiKey,
        contextWindow,
        embeddingModel,
        embeddingApiBase,
        embeddingApiKey,
        useCustomEmbedding,
      }));
      if (modalGuard.isStale(token)) return;
      // Don't auto-close — user explicitly asked to keep the modal open after
      // save so they can continue tweaking other sections without reopening.
      // A toast confirms the save landed.
      showSuccess(t('settings.global.savedToast'));
    } catch (error) {
      if (modalGuard.isStale(token)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!modalGuard.isStale(token)) {
        setSaving(false);
      }
    }
  };

  const handleTest = async () => {
    await llmConnection.run({
      mode,
      model,
      apiBase,
      apiKey,
      localModelPath,
      ollamaModel,
    });
  };

  const handleEmbeddingTest = async () => {
    await embeddingConnection.run({
      model: embeddingModel,
      apiBase: embeddingApiBase,
      apiKey: embeddingApiKey,
    });
  };

  const canRunLlmTest = canTestLlmConnection({
    mode,
    model,
    apiBase,
    apiKey,
    localModelPath,
    ollamaModel,
  });

  return (
    <Modal isOpen={isOpen} onClose={saving ? () => {} : onClose} title={t('settings.global.title')}>
      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="sm" className="text-accent" /></div>
      ) : (
        <div className="mt-4 space-y-6">
          <div className="rounded-sm border border-info/30 bg-info/10 p-4 font-serif text-sm leading-relaxed text-info">
            {t('settings.global.description')}
          </div>
          <SecretStorageNotice enabled={isOpen} />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-text/90">{t('common.labels.searchMode')}</span>
              <Button tone="neutral" fill="plain" size="sm" className="text-xs text-accent" onClick={() => setApiHelpOpen(true)}>
                <HelpCircle size={14} className="mr-1" />
                {t('help.apiSetup.howToGet')}
              </Button>
            </div>
            <LlmModeSelect
              value={mode}
              onChange={(next) => setMode(next as LLMMode)}
              disabled={saving}
            />

            {mode === 'api' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-bold text-text/90">{t('settings.global.defaultModel')}</label>
                  <ModelSelector value={model} onChange={setModel} onApiBaseAutoFill={setApiBase} disabled={saving} />
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
                  <Input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="http://localhost:11434/v1" disabled={saving} />
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

            <div className="flex items-center gap-2 pt-1">
              <Button
                tone="neutral"
                fill="outline"
                size="sm"
                onClick={handleTest}
                disabled={saving || llmConnection.status === 'testing' || !canRunLlmTest}
              >
                {llmConnection.status === 'testing' ? <Spinner size="sm" className="mr-1" /> : null}
                {t('common.actions.testLlmConnection')}
              </Button>
              {llmConnection.status === 'success' && <span className="flex items-center text-xs text-success"><CheckCircle2 size={14} className="mr-1" /> {llmConnection.message}</span>}
              {llmConnection.status === 'error' && <span className="flex items-start text-xs text-error"><XCircle size={14} className="mr-1 mt-0.5 shrink-0" /> <span className="leading-tight">{llmConnection.message}</span></span>}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-text/90">{t('common.labels.searchEngineModel')}</label>
                <Button tone="neutral" fill="plain" size="sm" className="text-xs text-accent" onClick={() => setApiHelpOpen(true)}>
                  <HelpCircle size={14} className="mr-1" />
                  {t('help.apiSetup.howToGet')}
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
                  <p className="text-xs leading-relaxed text-warning">
                    {t('settings.global.embeddingIndependentHint')}
                  </p>
                  <Input value={embeddingModel} onChange={e => setEmbeddingModel(e.target.value)} placeholder={t('settings.global.embeddingModelPlaceholder')} disabled={saving} className="h-11 text-base md:h-8 md:text-sm" />
                  <Input value={embeddingApiBase} onChange={e => setEmbeddingApiBase(e.target.value)} placeholder={t('settings.global.embeddingApiBasePlaceholder')} disabled={saving} className="h-11 text-base md:h-8 md:text-sm" />
                  <Input value={embeddingApiKey} onChange={e => setEmbeddingApiKey(e.target.value)} placeholder={t('settings.global.embeddingApiKeyPlaceholder')} disabled={saving} className="h-11 text-base md:h-8 md:text-sm" type="password" />
                  <div className="flex items-center gap-2 pt-1">
                    <Button tone="neutral" fill="outline" size="sm" onClick={handleEmbeddingTest} disabled={saving || embeddingConnection.status === 'testing' || !embeddingModel.trim()}>
                      {embeddingConnection.status === 'testing' ? <Spinner size="sm" className="mr-1" /> : null}
                      {t('common.actions.testEmbeddingConnection')}
                    </Button>
                    {embeddingConnection.status === 'success' && <span className="flex items-center text-xs text-success"><CheckCircle2 size={14} className="mr-1" /> {embeddingConnection.message}</span>}
                    {embeddingConnection.status === 'error' && <span className="flex items-start text-xs text-error"><XCircle size={14} className="mr-1 mt-0.5 shrink-0" /> <span className="leading-tight">{embeddingConnection.message}</span></span>}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2 border-t border-rule pt-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">{t('settings.global.languageLabel')}</label>
              <select
                value={i18n.resolvedLanguage === 'en' ? 'en' : 'zh'}
                onChange={(e) => { changeLanguage(e.target.value as AppLanguage).catch((err) => showError(err, t('error_messages.unknown'))); }}
                className="h-11 w-full rounded-sm border border-rule bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent md:h-10 md:w-48 md:text-sm"
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

          <div className="space-y-2 border-t border-rule pt-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">{t('simple.settings.modeLabel', { defaultValue: '写作模式' })}</label>
              <select
                value={writingMode}
                onChange={async (e) => {
                  const next = e.target.value as WritingMode;
                  try {
                    await saveAppPreferences({ writing_mode: next });
                    writeWritingModeMirror(next);
                    await refreshWritingMode();
                  } catch (err) {
                    showError(err, t('error_messages.unknown'));
                  }
                }}
                className="h-11 w-full rounded-sm border border-rule bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent md:h-10 md:w-48 md:text-sm"
              >
                {WRITING_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m === 'simple'
                      ? t('simple.settings.modeSimple', { defaultValue: '简版 · 对话式' })
                      : t('simple.settings.modeFull', { defaultValue: '完整版' })}
                  </option>
                ))}
              </select>
              <p className="text-xs text-text/50">{t('simple.settings.modeDescription', { defaultValue: '切换在下次打开作品时生效。简版用对话式续写，完整版是手动编辑器。' })}</p>
            </div>
          </div>

          <FontSettingsSection />

          <div className="space-y-1 border-t border-rule pt-5">
            <label className="text-sm font-bold text-text/90">{t('settings.global.dataPathLabel')}</label>
            <p className="rounded-sm border border-rule bg-rule-soft px-3 py-2 font-mono text-xs text-text/70">
              {displayDataDir || getDataDir() || t('settings.global.dataPathDefault')}
            </p>
            <p className="text-xs text-text/50">{t('settings.global.dataPathHint')}</p>
          </div>

          <DebugLogsSection />

          <p className="mt-4 text-xs leading-relaxed text-text/30">{t('ethics.aboutFooter')}</p>

          {/* Sticky footer — modal body is overflow-y-auto, so sticky bottom-0
              keeps the save/cancel pair pinned to the visible bottom edge no
              matter how far the user has scrolled. Negative horizontal margin
              cancels Modal/Sheet body padding (px-6 desktop, px-4 mobile) so
              the bg-surface fill spans the full modal width. */}
          <div className="sticky bottom-0 -mx-4 md:-mx-6 flex justify-end gap-3 border-t border-rule bg-surface px-4 md:px-6 py-3">
            <Button tone="neutral" fill="plain" onClick={onClose} disabled={saving}>{t('common.actions.cancel')}</Button>
            <Button tone="accent" fill="solid" onClick={handleSave} disabled={saving || !settings} className="w-24">
              {saving ? <Spinner size="md" /> : t('common.actions.save')}
            </Button>
          </div>
        </div>
      )}
      <ApiSetupHelp isOpen={apiHelpOpen} onClose={() => setApiHelpOpen(false)} />
    </Modal>
  );
};
