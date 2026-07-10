// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect } from 'react';
import { Spinner } from "../shared/Spinner";
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { Input } from '../shared/Input';
import { HelpCircle, CheckCircle2, XCircle } from 'lucide-react';
import { ProviderModelPicker } from './model-picker/ProviderModelPicker';
import { LLMMode, getDataDir } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import { DebugLogsSection } from './DebugLogsSection';
import { changeLanguage, SUPPORTED_LANGUAGES, type AppLanguage } from '../../i18n';
import { ApiSetupHelp } from '../help/ApiSetupHelp';
import { LlmModeSelect } from './LlmModeSelect';
import { FontSettingsSection } from './FontSettingsSection';
import { useEmbeddingConnectionTest, useLlmConnectionTest } from '../../hooks/useConnectionTest';
import { canTestLlmConnection } from '../shared/llm-config';
import { SecretStorageNotice } from '../shared/SecretStorageNotice';
import { useGlobalSettingsData } from './useGlobalSettingsData';
import { useGlobalSettingsForm } from './useGlobalSettingsForm';
import { useGlobalSettingsModals } from './useGlobalSettingsModals';
import { useReactExtractionPref } from './useReactExtractionPref';

export const GlobalSettingsModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const { t, i18n } = useTranslation();
  const { showError } = useFeedback();

  const { settings, displayDataDir, loading, loadKey } = useGlobalSettingsData(isOpen);
  const {
    form, saving, isDirty, save,
    setMode, setModel, setLocalModelPath, setOllamaModel,
    setApiBase, setApiKey, setContextWindow, setChatPath,
    setEmbeddingModel, setEmbeddingApiBase, setEmbeddingApiKey,
  } = useGlobalSettingsForm(isOpen, settings, loadKey);
  const modals = useGlobalSettingsModals(isOpen);
  const reactExtraction = useReactExtractionPref(isOpen, settings, loadKey);

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

  useEffect(() => {
    llmConnection.reset();
    // 连接测试结果随相关字段变化失效；isOpen 兜住「字段恰好没变」的开/关边沿
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, form.mode, form.model, form.localModelPath, form.ollamaModel, form.apiBase, form.apiKey, form.contextWindow, form.chatPath, form.embeddingModel]);

  const handleTest = async () => {
    await llmConnection.run({
      mode: form.mode,
      model: form.model,
      apiBase: form.apiBase,
      apiKey: form.apiKey,
      localModelPath: form.localModelPath,
      ollamaModel: form.ollamaModel,
      // 自定义 chatPath 网关：测试必须打真实生成同款 URL（R2-2）
      chatPath: form.chatPath,
    });
  };

  /** 关闭入口统一走脏检查（R2-5）：X / 取消都先确认再丢弃。 */
  const requestClose = () => {
    if (saving) return;
    if (isDirty) {
      modals.openDiscardConfirm();
      return;
    }
    onClose();
  };

  const handleEmbeddingTest = async () => {
    await embeddingConnection.run({
      model: form.embeddingModel,
      apiBase: form.embeddingApiBase,
      apiKey: form.embeddingApiKey,
    });
  };

  const canRunLlmTest = canTestLlmConnection({
    mode: form.mode,
    model: form.model,
    apiBase: form.apiBase,
    apiKey: form.apiKey,
    localModelPath: form.localModelPath,
    ollamaModel: form.ollamaModel,
  });

  return (
    <Modal isOpen={isOpen} onClose={requestClose} title={t('settings.global.title')}>
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
              <Button tone="neutral" fill="plain" size="sm" className="text-xs text-accent" onClick={modals.openApiHelp}>
                <HelpCircle size={14} className="mr-1" />
                {t('help.apiSetup.howToGet')}
              </Button>
            </div>
            <LlmModeSelect
              value={form.mode}
              onChange={(next) => setMode(next as LLMMode)}
              disabled={saving}
            />

            {form.mode === 'api' && (
              <>
                {/* 供应商主导选择器：供应商 → 模型（推荐/已启用/自定义 + 拉取 + 手填）→ ctx 三态 */}
                <ProviderModelPicker
                  kind="chat"
                  model={form.model}
                  onModelChange={setModel}
                  apiBase={form.apiBase}
                  onApiBaseAutoFill={setApiBase}
                  onChatPathAutoFill={setChatPath}
                  apiKey={form.apiKey}
                  onApiKeyAutoFill={setApiKey}
                  contextWindow={form.contextWindow}
                  onContextWindowChange={setContextWindow}
                  disabled={saving}
                />

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-bold text-text/90">{t('common.labels.apiBase')}</label>
                  <Input value={form.apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.deepseek.com" disabled={saving} />
                  <p className="text-xs text-text/50">{t('common.help.apiBase')}</p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-bold text-text/90">{t('common.labels.apiKey')}</label>
                  <Input type="password" value={form.apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." disabled={saving} />
                  <p className="text-xs text-text/50">{t('common.help.apiKey')}</p>
                </div>
              </>
            )}

            {form.mode === 'local' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-bold text-text/90">{t('common.labels.localModelPath')}</label>
                <Input value={form.localModelPath} onChange={(e) => setLocalModelPath(e.target.value)} placeholder="/path/to/model" disabled={saving} />
                <p className="text-xs text-text/50">{t('common.help.localModelPath')}</p>
              </div>
            )}

            {form.mode === 'ollama' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-bold text-text/90">{t('common.labels.apiBase')}</label>
                  <Input value={form.apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="http://localhost:11434/v1" disabled={saving} />
                  <p className="text-xs text-text/50">{t('common.help.apiBase')}</p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-bold text-text/90">{t('common.labels.ollamaModel')}</label>
                  <Input value={form.ollamaModel} onChange={(e) => setOllamaModel(e.target.value)} placeholder="llama3" disabled={saving} />
                  <p className="text-xs text-text/50">{t('common.help.ollamaModel')}</p>
                </div>
              </>
            )}

            {/* api 模式的 ctx 由 ProviderModelPicker 内联管理（权威只读/估算提示）；其余模式保留手填 */}
            {form.mode !== 'api' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-bold text-text/90">{t('common.labels.contextWindow')}</label>
                <Input type="number" value={form.contextWindow} onChange={(e) => setContextWindow(e.target.value)} disabled={saving} />
                {/* "" = 窗口未知（R2-3）：显式警示，不静默按默认处理 */}
                {form.contextWindow.trim() === ''
                  ? <p className="text-xs text-warning">{t('modelPicker.ctxUnknown')}</p>
                  : <p className="text-xs text-text/50">{t('common.help.contextWindow')}</p>}
              </div>
            )}

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
                <Button tone="neutral" fill="plain" size="sm" className="text-xs text-accent" onClick={modals.openApiHelp}>
                  <HelpCircle size={14} className="mr-1" />
                  {t('help.apiSetup.howToGet')}
                </Button>
              </div>
              <div className="space-y-2 pl-2 border-l-2 border-accent/30">
                <p className="text-xs leading-relaxed text-warning">
                  {t('settings.global.embeddingIndependentHint')}
                </p>
                {/* embedding 槽位复用同一选择器：kind="embedding" 只显示 embedding 类型模型（+手填） */}
                <ProviderModelPicker
                  kind="embedding"
                  model={form.embeddingModel}
                  onModelChange={setEmbeddingModel}
                  apiBase={form.embeddingApiBase}
                  onApiBaseAutoFill={setEmbeddingApiBase}
                  apiKey={form.embeddingApiKey}
                  onApiKeyAutoFill={setEmbeddingApiKey}
                  disabled={saving}
                />
                <Input value={form.embeddingApiBase} onChange={e => setEmbeddingApiBase(e.target.value)} placeholder={t('settings.global.embeddingApiBasePlaceholder')} disabled={saving} className="h-11 text-base md:h-8 md:text-sm" />
                <Input value={form.embeddingApiKey} onChange={e => setEmbeddingApiKey(e.target.value)} placeholder={t('settings.global.embeddingApiKeyPlaceholder')} disabled={saving} className="h-11 text-base md:h-8 md:text-sm" type="password" />
                <div className="flex items-center gap-2 pt-1">
                  <Button tone="neutral" fill="outline" size="sm" onClick={handleEmbeddingTest} disabled={saving || embeddingConnection.status === 'testing' || !form.embeddingModel.trim()}>
                    {embeddingConnection.status === 'testing' ? <Spinner size="sm" className="mr-1" /> : null}
                    {t('common.actions.testEmbeddingConnection')}
                  </Button>
                  {embeddingConnection.status === 'success' && <span className="flex items-center text-xs text-success"><CheckCircle2 size={14} className="mr-1" /> {embeddingConnection.message}</span>}
                  {embeddingConnection.status === 'error' && <span className="flex items-start text-xs text-error"><XCircle size={14} className="mr-1 mt-0.5 shrink-0" /> <span className="leading-tight">{embeddingConnection.message}</span></span>}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2 border-t border-rule pt-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">{t('settings.global.languageLabel')}</label>
              <select
                value={i18n.resolvedLanguage === 'en' ? 'en' : 'zh'}
                onChange={(e) => { changeLanguage(e.target.value as AppLanguage).catch((err) => showError(err, t('error_messages.unknown'))); }}
                className="h-11 w-full rounded-sm border border-rule bg-background px-3 text-base outline-hidden focus:ring-2 focus:ring-accent md:h-10 md:w-48 md:text-sm"
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
              <label className="text-sm font-bold text-text/90">{t('settings.global.reactExtractionLabel', { defaultValue: '增强事实提取' })}</label>
              <select
                value={reactExtraction.enabled ? 'on' : 'off'}
                onChange={(e) => { void reactExtraction.toggle(e.target.value === 'on'); }}
                className="h-11 w-full rounded-sm border border-rule bg-background px-3 text-base outline-hidden focus:ring-2 focus:ring-accent md:h-10 md:w-48 md:text-sm"
              >
                <option value="on">{t('settings.global.reactExtractionOn', { defaultValue: '开启（推荐）' })}</option>
                <option value="off">{t('settings.global.reactExtractionOff', { defaultValue: '关闭' })}</option>
              </select>
              <p className="text-xs text-text/50">{t('settings.global.reactExtractionDescription', { defaultValue: '确认章节后用 AI 自动给笔记找跨章因果、归入剧情线。会多花几秒；关闭则用更快的基础提取。' })}</p>
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
            <Button tone="neutral" fill="plain" onClick={requestClose} disabled={saving}>{t('common.actions.cancel')}</Button>
            <Button tone="accent" fill="solid" onClick={save} disabled={saving || !settings} className="w-24">
              {saving ? <Spinner size="md" /> : t('common.actions.save')}
            </Button>
          </div>
        </div>
      )}
      <ApiSetupHelp isOpen={modals.isApiHelpOpen} onClose={modals.closeApiHelp} />
      {/* 脏检查确认（R2-5）：仅覆盖「保存」按钮管辖的连接与模型选择字段 */}
      <ConfirmDialog
        isOpen={modals.isDiscardConfirmOpen}
        onClose={modals.closeDiscardConfirm}
        onConfirm={() => {
          modals.closeDiscardConfirm();
          onClose();
        }}
        title={t('settings.global.discardConfirmTitle')}
        message={t('settings.global.discardConfirmMessage')}
        confirmLabel={t('settings.global.discardConfirmYes')}
        destructive
      />
    </Modal>
  );
};
