// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useState } from 'react';
import { Spinner } from "../shared/Spinner";
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { Input } from '../shared/Input';
import { HelpCircle, CheckCircle2, XCircle } from 'lucide-react';
import { ProviderModelPicker } from './model-picker/ProviderModelPicker';
import { getSettingsForEditing, saveAppPreferences, saveGlobalSettingsForEditing, LLMMode, type SettingsInfo, getDataDir, getDisplayDataDir } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import { catchAndLog } from '../../utils/ui-logger';
import { DebugLogsSection } from './DebugLogsSection';
import { changeLanguage, SUPPORTED_LANGUAGES, type AppLanguage } from '../../i18n';
import { ApiSetupHelp } from '../help/ApiSetupHelp';
import { LlmModeSelect } from './LlmModeSelect';
import { FontSettingsSection } from './FontSettingsSection';
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import { useEmbeddingConnectionTest, useLlmConnectionTest } from '../../hooks/useConnectionTest';
import { canTestLlmConnection } from '../shared/llm-config';
import { SecretStorageNotice } from '../shared/SecretStorageNotice';
import {
  buildGlobalSettingsSaveInput,
  createDefaultGlobalSettingsFormState,
  hydrateGlobalSettingsForm,
  type GlobalSettingsFormState,
} from './form-mappers';
import { DEFAULT_DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_API_BASE } from '../../config/defaults';

export const GlobalSettingsModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const { t, i18n } = useTranslation();
  const { showError, showSuccess } = useFeedback();
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
  const [contextWindow, setContextWindow] = useState(''); // 表单态："" = 窗口未知（R2-3）
  const [chatPath, setChatPath] = useState('');
  const [embeddingModel, setEmbeddingModel] = useState('');
  const [embeddingApiBase, setEmbeddingApiBase] = useState('');
  const [embeddingApiKey, setEmbeddingApiKey] = useState('');
  const [apiHelpOpen, setApiHelpOpen] = useState(false);
  const [displayDataDir, setDisplayDataDir] = useState('');
  const [reactExtractionEnabled, setReactExtractionEnabled] = useState(true); // M9，默认开（PD-4）
  // 脏检查基线：hydrate / 保存成功后的表单快照（R2-5）。null = 尚未加载完成（视为不脏）。
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

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
    setChatPath(defaults.chatPath);
    setEmbeddingModel(defaults.embeddingModel);
    setEmbeddingApiBase(defaults.embeddingApiBase);
    setEmbeddingApiKey(defaults.embeddingApiKey);
    setApiHelpOpen(false);
    setReactExtractionEnabled(true);
    setSavedSnapshot(null);
    setDiscardConfirmOpen(false);
  };

  /**
   * 脏检查快照（R2-5）：只含「保存」按钮管辖的连接与模型选择字段。
   * 语言 / 提取开关 / 字体 / 服务商目录与模型清单是即时保存的，不计脏。
   * 用固定序数组序列化（对象键序随构造点漂移，字符串比对会误报）。
   *
   * contextWindow 计脏（per-model 覆盖后）：选择器的自动校正已放宽为「仅表单为空时 seed 一次」，
   * 不再每次打开就强制回填官方值 —— 常见情况（配置已存 ctx 值 → 打开时字段非空 → 不触发 seed）
   * 不再误报「打开就脏」。故把它纳入脏检查，让「只改了 ctx 覆盖就关窗」也能弹丢弃确认（否则该覆盖
   * 会被静默丢失）。仅遗留「权威模型 + 空 ctx 的迁移旧配置」打开时 seed 一次 → 罕见的一次性误报，
   * 首次保存后自愈。
   */
  const formSnapshot = (f: GlobalSettingsFormState): string => JSON.stringify([
    f.mode, f.model, f.localModelPath, f.ollamaModel, f.apiBase, f.apiKey,
    f.contextWindow, f.chatPath, f.embeddingModel, f.embeddingApiBase, f.embeddingApiKey,
  ]);
  const currentForm = (): GlobalSettingsFormState => ({
    mode, model, localModelPath, ollamaModel, apiBase, apiKey,
    contextWindow, chatPath, embeddingModel, embeddingApiBase, embeddingApiKey,
  });
  const isDirty = savedSnapshot !== null && formSnapshot(currentForm()) !== savedSnapshot;

  useEffect(() => {
    llmConnection.reset();
  }, [mode, model, localModelPath, ollamaModel, apiBase, apiKey, contextWindow, chatPath, embeddingModel]);

  useEffect(() => {
    if (isOpen) {
      const token = modalGuard.start();
      setLoading(true);
      resetFormState();
      getDisplayDataDir().then((dir) => {
        if (!modalGuard.isStale(token)) setDisplayDataDir(dir);
      }).catch(catchAndLog('globalSettings', 'getDisplayDataDir failed'));
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
        setChatPath(form.chatPath);
        setEmbeddingModel(form.embeddingModel);
        setEmbeddingApiBase(form.embeddingApiBase);
        setEmbeddingApiKey(form.embeddingApiKey);
        setReactExtractionEnabled(res.app?.react_extraction_enabled !== false);
        setSavedSnapshot(formSnapshot(form));
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
      const form = currentForm();
      await saveGlobalSettingsForEditing(buildGlobalSettingsSaveInput(form));
      if (modalGuard.isStale(token)) return;
      // Don't auto-close — user explicitly asked to keep the modal open after
      // save so they can continue tweaking other sections without reopening.
      // A toast confirms the save landed.
      setSavedSnapshot(formSnapshot(form));
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
      // 自定义 chatPath 网关：测试必须打真实生成同款 URL（R2-2）
      chatPath,
    });
  };

  /** 关闭入口统一走脏检查（R2-5）：X / 取消都先确认再丢弃。 */
  const requestClose = () => {
    if (saving) return;
    if (isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    onClose();
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
                {/* 供应商主导选择器：供应商 → 模型（推荐/已启用/自定义 + 拉取 + 手填）→ ctx 三态 */}
                <ProviderModelPicker
                  kind="chat"
                  model={model}
                  onModelChange={setModel}
                  apiBase={apiBase}
                  onApiBaseAutoFill={setApiBase}
                  onChatPathAutoFill={setChatPath}
                  apiKey={apiKey}
                  onApiKeyAutoFill={setApiKey}
                  contextWindow={contextWindow}
                  onContextWindowChange={setContextWindow}
                  disabled={saving}
                />

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

            {/* api 模式的 ctx 由 ProviderModelPicker 内联管理（权威只读/估算提示）；其余模式保留手填 */}
            {mode !== 'api' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-bold text-text/90">{t('common.labels.contextWindow')}</label>
                <Input type="number" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} disabled={saving} />
                {/* "" = 窗口未知（R2-3）：显式警示，不静默按默认处理 */}
                {contextWindow.trim() === ''
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
                <Button tone="neutral" fill="plain" size="sm" className="text-xs text-accent" onClick={() => setApiHelpOpen(true)}>
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
                  model={embeddingModel}
                  onModelChange={setEmbeddingModel}
                  apiBase={embeddingApiBase}
                  onApiBaseAutoFill={setEmbeddingApiBase}
                  apiKey={embeddingApiKey}
                  onApiKeyAutoFill={setEmbeddingApiKey}
                  disabled={saving}
                />
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
              <label className="text-sm font-bold text-text/90">{t('settings.global.reactExtractionLabel', { defaultValue: '增强事实提取' })}</label>
              <select
                value={reactExtractionEnabled ? 'on' : 'off'}
                onChange={async (e) => {
                  const next = e.target.value === 'on';
                  setReactExtractionEnabled(next);
                  try {
                    await saveAppPreferences({ react_extraction_enabled: next });
                  } catch (err) {
                    setReactExtractionEnabled(!next);
                    showError(err, t('error_messages.unknown'));
                  }
                }}
                className="h-11 w-full rounded-sm border border-rule bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent md:h-10 md:w-48 md:text-sm"
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
            <Button tone="accent" fill="solid" onClick={handleSave} disabled={saving || !settings} className="w-24">
              {saving ? <Spinner size="md" /> : t('common.actions.save')}
            </Button>
          </div>
        </div>
      )}
      <ApiSetupHelp isOpen={apiHelpOpen} onClose={() => setApiHelpOpen(false)} />
      {/* 脏检查确认（R2-5）：仅覆盖「保存」按钮管辖的连接与模型选择字段 */}
      <ConfirmDialog
        isOpen={discardConfirmOpen}
        onClose={() => setDiscardConfirmOpen(false)}
        onConfirm={() => {
          setDiscardConfirmOpen(false);
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
