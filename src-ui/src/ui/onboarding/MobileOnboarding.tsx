// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, Database, Download, FolderPlus, Globe2, Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '../shared/Button';
import { Card } from '../shared/Card';
import { Input } from '../shared/Input';
import { StepIndicator } from './StepIndicator';
import { useTranslation } from '../../i18n/useAppTranslation';
import { changeLanguage, type AppLanguage } from '../../i18n';
import { createAu, createFandom, getSettings, testConnection, updateSettings } from '../../api/engine-client';

export type OnboardingCompletion = {
  nextAction?: 'open-import' | 'open-settings';
  openAuPath?: string;
};

type LlmProvider = 'deepseek' | 'openai' | 'custom';
type SetupAction = 'create' | 'import-local' | 'sync-directory' | 'later';

const TOTAL_STEPS = 6;
const PROVIDER_PRESETS: Record<LlmProvider, { apiBase: string; model: string }> = {
  deepseek: {
    apiBase: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
  openai: {
    apiBase: 'https://api.openai.com/v1',
    model: 'gpt-5.4',
  },
  custom: {
    apiBase: '',
    model: '',
  },
};

function inferProvider(apiBase: string): LlmProvider {
  const normalized = apiBase.toLowerCase();
  if (normalized.includes('deepseek')) return 'deepseek';
  if (normalized.includes('openai')) return 'openai';
  return 'custom';
}

function StepCard({
  active,
  title,
  description,
  icon,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
        active
          ? 'border-accent bg-accent/8 shadow-subtle'
          : 'border-black/10 bg-surface hover:border-accent/40 dark:border-white/10'
      }`}
    >
      <div className={`mt-0.5 rounded-xl p-2 ${active ? 'bg-accent text-white' : 'bg-background text-text/70'}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text">{title}</div>
        <div className="mt-1 text-sm leading-relaxed text-text/60">{description}</div>
      </div>
    </button>
  );
}

export function MobileOnboarding({
  onComplete,
  onClose,
}: {
  onComplete: (result?: OnboardingCompletion) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const isMountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const connectionRequestIdRef = useRef(0);
  const [step, setStep] = useState(0);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [provider, setProvider] = useState<LlmProvider>('deepseek');
  const [apiBase, setApiBase] = useState(PROVIDER_PRESETS.deepseek.apiBase);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(PROVIDER_PRESETS.deepseek.model);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [useCustomEmbedding, setUseCustomEmbedding] = useState(false);
  const [embeddingModel, setEmbeddingModel] = useState('BAAI/bge-m3');
  const [embeddingApiBase, setEmbeddingApiBase] = useState('https://api.siliconflow.cn/v1');
  const [embeddingApiKey, setEmbeddingApiKey] = useState('');
  const [setupAction, setSetupAction] = useState<SetupAction>('create');
  const [fandomName, setFandomName] = useState('');
  const [auName, setAuName] = useState('');
  const [ethicsAccepted, setEthicsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    isMountedRef.current = true;
    setLoadingSettings(true);
    getSettings().then(settings => {
      if (requestId !== requestIdRef.current) return;
      const llm = settings?.default_llm;
      if (llm?.api_base || llm?.model || llm?.api_key) {
        const nextBase = llm.api_base || PROVIDER_PRESETS.deepseek.apiBase;
        setProvider(inferProvider(nextBase));
        setApiBase(nextBase);
        setApiKey(llm.api_key || '');
        setModel(llm.model || PROVIDER_PRESETS.deepseek.model);
      }

      const embedding = settings?.embedding;
      const hasCustomEmbedding = Boolean(embedding?.model || embedding?.api_key || embedding?.api_base);
      setUseCustomEmbedding(hasCustomEmbedding);
      if (embedding?.model) setEmbeddingModel(embedding.model);
      if (embedding?.api_base) setEmbeddingApiBase(embedding.api_base);
      if (embedding?.api_key) setEmbeddingApiKey(embedding.api_key);
    }).catch(() => {
      // 引导页默认配置足够继续
    }).finally(() => {
      if (requestId === requestIdRef.current) {
        setLoadingSettings(false);
      }
    });

    return () => {
      isMountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    connectionRequestIdRef.current += 1;
    setConnectionStatus('idle');
    setConnectionMessage('');
  }, [apiBase, apiKey, model, provider]);

  const language = (i18n.resolvedLanguage === 'en' ? 'en' : 'zh') as AppLanguage;
  const currentStep = step + 1;

  const canAdvance = useMemo(() => {
    if (step === 0) return true;
    if (step === 1) return connectionStatus === 'success';
    if (step === 2) {
      return !useCustomEmbedding || Boolean(embeddingModel.trim() && embeddingApiBase.trim() && embeddingApiKey.trim());
    }
    if (step === 3) {
      return setupAction !== 'create' || Boolean(fandomName.trim() && auName.trim());
    }
    if (step === 4) return ethicsAccepted;
    return true;
  }, [auName, connectionStatus, embeddingApiBase, embeddingApiKey, embeddingModel, ethicsAccepted, fandomName, setupAction, step, useCustomEmbedding]);

  const applyProviderPreset = (nextProvider: LlmProvider) => {
    setProvider(nextProvider);
    const preset = PROVIDER_PRESETS[nextProvider];
    if (nextProvider !== 'custom') {
      setApiBase(preset.apiBase);
      setModel(preset.model);
    } else if (!apiBase.trim() && !model.trim()) {
      setApiBase(preset.apiBase);
      setModel(preset.model);
    }
  };

  const handleLanguageChange = async (nextLanguage: AppLanguage) => {
    await changeLanguage(nextLanguage);
  };

  const handleTestConnection = async () => {
    const requestId = ++connectionRequestIdRef.current;
    setConnectionStatus('testing');
    setConnectionMessage('');
    try {
      const result = await testConnection({
        mode: 'api',
        model,
        api_base: apiBase,
        api_key: apiKey,
      });
      if (requestId !== connectionRequestIdRef.current) return;
      if (result.success) {
        setConnectionStatus('success');
        setConnectionMessage(t('onboarding.apiConfig.testSuccess', { model: result.model || model }));
      } else {
        setConnectionStatus('error');
        setConnectionMessage(result.message || t('error_messages.unknown'));
      }
    } catch (error: any) {
      if (requestId !== connectionRequestIdRef.current) return;
      setConnectionStatus('error');
      setConnectionMessage(error?.message || t('error_messages.unknown'));
    }
  };

  const handleFinish = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const settings = await getSettings().catch(() => null);
      await updateSettings({
        default_llm: {
          ...settings?.default_llm,
          mode: 'api',
          model: model.trim(),
          api_base: apiBase.trim(),
          api_key: apiKey.trim(),
          local_model_path: '',
          ollama_model: '',
          context_window: settings?.default_llm?.context_window || 128000,
        },
        embedding: {
          ...settings?.embedding,
          mode: useCustomEmbedding ? 'api' : 'local',
          model: useCustomEmbedding ? embeddingModel.trim() : '',
          api_base: useCustomEmbedding ? embeddingApiBase.trim() : '',
          api_key: useCustomEmbedding ? embeddingApiKey.trim() : '',
          ollama_model: '',
        },
      });

      let openAuPath: string | undefined;

      if (setupAction === 'create' && fandomName.trim() && auName.trim()) {
        const fandom = await createFandom(fandomName.trim());
        const au = await createAu(fandom.name, auName.trim(), fandom.path);
        openAuPath = au.path;
      }

      if (!isMountedRef.current) return;

      onComplete({
        openAuPath,
        nextAction:
          setupAction === 'import-local'
            ? 'open-import'
            : setupAction === 'sync-directory'
              ? 'open-settings'
              : undefined,
      });
    } catch (error: any) {
      if (!isMountedRef.current) return;
      setSubmitError(error?.message || t('error_messages.unknown'));
    } finally {
      if (isMountedRef.current) {
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex min-app-height flex-col bg-background text-text">
      <header className="safe-area-top flex items-center justify-between border-b border-black/10 bg-background px-4 py-3 dark:border-white/10">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text">{t('common.appName')}</div>
          <div className="text-xs text-text/45">{t('onboarding.mobile.header')}</div>
        </div>
        <div className="flex items-center gap-3">
          <StepIndicator current={currentStep} total={TOTAL_STEPS} />
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-text/50 hover:bg-black/5 hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text/50 dark:hover:bg-white/5"
            onClick={() => {
              if (!submitting) {
                onClose();
              }
            }}
            disabled={submitting}
            aria-label={t('common.actions.close')}
          >
            <X size={20} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-5">
        {loadingSettings ? (
          <div className="flex h-full min-h-[40vh] items-center justify-center">
            <Loader2 className="animate-spin text-accent" size={28} />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-xl flex-col gap-4 pb-8">
            {step === 0 && (
              <>
                <div className="space-y-2">
                  <h1 className="text-3xl font-serif font-bold">{t('onboarding.mobile.language.title')}</h1>
                  <p className="text-base leading-relaxed text-text/60">{t('onboarding.mobile.language.subtitle')}</p>
                </div>

                <StepCard
                  active={language === 'zh'}
                  title={t('onboarding.mobile.language.zhTitle')}
                  description={t('onboarding.mobile.language.zhDescription')}
                  icon={<Globe2 size={18} />}
                  onClick={() => { void handleLanguageChange('zh'); }}
                />
                <StepCard
                  active={language === 'en'}
                  title={t('onboarding.mobile.language.enTitle')}
                  description={t('onboarding.mobile.language.enDescription')}
                  icon={<Globe2 size={18} />}
                  onClick={() => { void handleLanguageChange('en'); }}
                />
              </>
            )}

            {step === 1 && (
              <>
                <div className="space-y-2">
                  <h1 className="text-3xl font-serif font-bold">{t('onboarding.mobile.llm.title')}</h1>
                  <p className="text-base leading-relaxed text-text/60">{t('onboarding.mobile.llm.subtitle')}</p>
                </div>

                <div className="grid gap-3">
                  <StepCard
                    active={provider === 'deepseek'}
                    title={t('onboarding.mobile.llm.deepseekTitle')}
                    description={t('onboarding.mobile.llm.deepseekDescription')}
                    icon={<Sparkles size={18} />}
                    onClick={() => applyProviderPreset('deepseek')}
                  />
                  <StepCard
                    active={provider === 'openai'}
                    title={t('onboarding.mobile.llm.openaiTitle')}
                    description={t('onboarding.mobile.llm.openaiDescription')}
                    icon={<Sparkles size={18} />}
                    onClick={() => applyProviderPreset('openai')}
                  />
                  <StepCard
                    active={provider === 'custom'}
                    title={t('onboarding.mobile.llm.customTitle')}
                    description={t('onboarding.mobile.llm.customDescription')}
                    icon={<Sparkles size={18} />}
                    onClick={() => applyProviderPreset('custom')}
                  />
                </div>

                <Card className="space-y-4 rounded-2xl p-4">
                  <Input
                    label={t('onboarding.apiConfig.apiBase')}
                    value={apiBase}
                    onChange={event => setApiBase(event.target.value)}
                    placeholder="https://api.deepseek.com"
                  />
                  <Input
                    label={t('onboarding.apiConfig.apiKey')}
                    type="password"
                    value={apiKey}
                    onChange={event => setApiKey(event.target.value)}
                    placeholder="sk-..."
                  />
                  <Input
                    label={t('onboarding.apiConfig.model')}
                    value={model}
                    onChange={event => setModel(event.target.value)}
                    placeholder="deepseek-chat"
                  />

                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={handleTestConnection}
                    disabled={connectionStatus === 'testing' || !apiKey.trim() || !apiBase.trim() || !model.trim()}
                  >
                    {connectionStatus === 'testing' ? <><Loader2 size={16} className="mr-2 animate-spin" />{t('onboarding.apiConfig.testing')}</> : t('onboarding.apiConfig.testConnection')}
                  </Button>

                  {connectionStatus !== 'idle' && (
                    <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                      connectionStatus === 'success'
                        ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                        : connectionStatus === 'error'
                          ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                          : 'bg-surface text-text/60'
                    }`}
                    >
                      {connectionMessage}
                    </div>
                  )}
                </Card>
              </>
            )}

            {step === 2 && (
              <>
                <div className="space-y-2">
                  <h1 className="text-3xl font-serif font-bold">{t('onboarding.mobile.embedding.title')}</h1>
                  <p className="text-base leading-relaxed text-text/60">{t('onboarding.mobile.embedding.subtitle')}</p>
                </div>

                <StepCard
                  active={useCustomEmbedding}
                  title={t('onboarding.mobile.embedding.recommendedTitle')}
                  description={t('onboarding.mobile.embedding.recommendedDescription')}
                  icon={<Database size={18} />}
                  onClick={() => setUseCustomEmbedding(true)}
                />
                <StepCard
                  active={!useCustomEmbedding}
                  title={t('onboarding.mobile.embedding.skipTitle')}
                  description={t('onboarding.mobile.embedding.skipDescription')}
                  icon={<ArrowRight size={18} />}
                  onClick={() => setUseCustomEmbedding(false)}
                />

                {useCustomEmbedding && (
                  <Card className="space-y-4 rounded-2xl p-4">
                    <Input
                      label={t('common.labels.model')}
                      value={embeddingModel}
                      onChange={event => setEmbeddingModel(event.target.value)}
                      placeholder="BAAI/bge-m3"
                    />
                    <Input
                      label={t('common.labels.apiBase')}
                      value={embeddingApiBase}
                      onChange={event => setEmbeddingApiBase(event.target.value)}
                      placeholder="https://api.siliconflow.cn/v1"
                    />
                    <Input
                      label={t('common.labels.apiKey')}
                      type="password"
                      value={embeddingApiKey}
                      onChange={event => setEmbeddingApiKey(event.target.value)}
                      placeholder="sk-..."
                    />
                    <p className="text-sm leading-relaxed text-text/55">{t('onboarding.mobile.embedding.recommendedHint')}</p>
                  </Card>
                )}
              </>
            )}

            {step === 3 && (
              <>
                <div className="space-y-2">
                  <h1 className="text-3xl font-serif font-bold">{t('onboarding.mobile.setup.title')}</h1>
                  <p className="text-base leading-relaxed text-text/60">{t('onboarding.mobile.setup.subtitle')}</p>
                </div>

                <div className="grid gap-3">
                  <StepCard
                    active={setupAction === 'create'}
                    title={t('onboarding.mobile.setup.createTitle')}
                    description={t('onboarding.mobile.setup.createDescription')}
                    icon={<FolderPlus size={18} />}
                    onClick={() => setSetupAction('create')}
                  />
                  <StepCard
                    active={setupAction === 'import-local'}
                    title={t('onboarding.mobile.setup.importTitle')}
                    description={t('onboarding.mobile.setup.importDescription')}
                    icon={<Download size={18} />}
                    onClick={() => setSetupAction('import-local')}
                  />
                  <StepCard
                    active={setupAction === 'sync-directory'}
                    title={t('onboarding.mobile.setup.syncTitle')}
                    description={t('onboarding.mobile.setup.syncDescription')}
                    icon={<Globe2 size={18} />}
                    onClick={() => setSetupAction('sync-directory')}
                  />
                  <StepCard
                    active={setupAction === 'later'}
                    title={t('onboarding.mobile.setup.laterTitle')}
                    description={t('onboarding.mobile.setup.laterDescription')}
                    icon={<ArrowRight size={18} />}
                    onClick={() => setSetupAction('later')}
                  />
                </div>

                {setupAction === 'create' && (
                  <Card className="rounded-2xl p-4">
                    <div className="space-y-4">
                      <Input
                        label={t('onboarding.createFandom.nameLabel')}
                        value={fandomName}
                        onChange={event => setFandomName(event.target.value)}
                        placeholder={t('onboarding.mobile.setup.fandomPlaceholder')}
                      />
                      <Input
                        label={t('onboarding.mobile.setup.auLabel')}
                        value={auName}
                        onChange={event => setAuName(event.target.value)}
                        placeholder={t('onboarding.mobile.setup.auPlaceholder')}
                      />
                    </div>
                  </Card>
                )}
              </>
            )}

            {step === 4 && (
              <>
                <div className="space-y-2">
                  <h1 className="text-3xl font-serif font-bold">{t('ethics.onboardingTitle')}</h1>
                  <p className="text-base leading-relaxed text-text/60">{t('onboarding.mobile.ethics.subtitle')}</p>
                </div>

                <Card className="space-y-4 rounded-2xl p-5">
                  <p className="whitespace-pre-line text-sm leading-relaxed text-text/70">{t('ethics.onboardingBody')}</p>
                  <label className="flex items-start gap-3 rounded-xl border border-black/10 bg-background px-4 py-3 text-sm text-text/75 dark:border-white/10">
                    <input
                      type="checkbox"
                      className="mt-1 accent-accent"
                      checked={ethicsAccepted}
                      onChange={event => setEthicsAccepted(event.target.checked)}
                    />
                    <span>{t('onboarding.mobile.ethics.confirm')}</span>
                  </label>
                </Card>
              </>
            )}

            {step === 5 && (
              <>
                <div className="space-y-2">
                  <h1 className="text-3xl font-serif font-bold">{t('onboarding.mobile.complete.title')}</h1>
                  <p className="text-base leading-relaxed text-text/60">{t('onboarding.mobile.complete.subtitle')}</p>
                </div>

                <Card className="space-y-3 rounded-2xl p-5">
                  <div className="flex items-start gap-3 text-sm text-text/80">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-500" />
                    <span>{t('onboarding.mobile.complete.languageSummary', { language: language === 'zh' ? '中文' : 'English' })}</span>
                  </div>
                  <div className="flex items-start gap-3 text-sm text-text/80">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-500" />
                    <span>{t('onboarding.mobile.complete.llmSummary', { model })}</span>
                  </div>
                  <div className="flex items-start gap-3 text-sm text-text/80">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-500" />
                    <span>
                      {useCustomEmbedding
                        ? t('onboarding.mobile.complete.embeddingSummary', { model: embeddingModel })
                        : t('onboarding.mobile.complete.embeddingSkipped')}
                    </span>
                  </div>
                  <div className="flex items-start gap-3 text-sm text-text/80">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-500" />
                    <span>
                      {setupAction === 'create'
                        ? t('onboarding.mobile.complete.createSummary', { fandomName, auName })
                        : setupAction === 'import-local'
                          ? t('onboarding.mobile.complete.importSummary')
                          : setupAction === 'sync-directory'
                            ? t('onboarding.mobile.complete.syncSummary')
                            : t('onboarding.mobile.complete.laterSummary')}
                    </span>
                  </div>
                </Card>

                {submitError && (
                  <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                    {submitError}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {!loadingSettings && (
        <footer className="safe-area-bottom border-t border-black/10 bg-background px-4 py-3 dark:border-white/10">
          <div className="mx-auto flex w-full max-w-xl gap-3">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => {
                setSubmitError('');
                setStep(prev => Math.max(0, prev - 1));
              }}
              disabled={step === 0 || submitting}
            >
              {t('onboarding.common.prev')}
            </Button>
            {step < TOTAL_STEPS - 1 ? (
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => {
                  setSubmitError('');
                  setStep(prev => Math.min(TOTAL_STEPS - 1, prev + 1));
                }}
                disabled={!canAdvance || submitting}
              >
                {t('onboarding.common.next')}
              </Button>
            ) : (
              <Button variant="primary" className="flex-1" onClick={handleFinish} disabled={submitting}>
                {submitting ? <><Loader2 size={16} className="mr-2 animate-spin" />{t('common.status.saving')}</> : t('ethics.onboardingAcknowledge')}
              </Button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
