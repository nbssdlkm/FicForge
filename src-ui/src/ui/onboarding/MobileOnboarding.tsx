// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useMemo } from 'react';
import { ArrowRight, CheckCircle2, Database, Download, FolderPlus, Globe2, X } from 'lucide-react';
import { Spinner } from "../shared/Spinner";
import { Button } from '../shared/Button';
import { Card } from '../shared/Card';
import { Input } from '../shared/Input';
import { HelpTooltip } from '../shared/HelpTooltip';
import { StepIndicator } from './StepIndicator';
import { ApiSetupHelp } from '../help/ApiSetupHelp';
import { ProviderModelPicker } from '../settings/model-picker/ProviderModelPicker';
import { useTranslation } from '../../i18n/useAppTranslation';
import { changeLanguage, type AppLanguage } from '../../i18n';
import { SecretStorageNotice } from '../shared/SecretStorageNotice';
import { useMobileOnboardingSettingsForm } from './useMobileOnboardingSettingsForm';
import { TOTAL_STEPS, useMobileOnboardingFlow, type OnboardingCompletion } from './useMobileOnboardingFlow';

// 完成回调契约随流程 hook 走，此处 re-export 保持既有 import 路径不变
export type { OnboardingCompletion } from './useMobileOnboardingFlow';

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
      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
        active
          ? 'border-accent bg-accent/8 shadow-subtle'
          : 'border-black/10 bg-surface hover:border-accent/40 dark:border-white/10'
      }`}
    >
      <div className={`mt-0.5 rounded-xl p-2 ${active ? 'bg-accent text-inv-text' : 'bg-background text-text/70'}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text">{title}</div>
        <div className="mt-1 text-sm leading-relaxed text-text/70">{description}</div>
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

  const {
    form, loading: loadingSettings,
    connectionStatus, connectionMessage, canTestConnection, testConnection,
    helpOpen, openHelp, closeHelp,
    setApiBase, setApiKey, setModel, setContextWindow, setChatPath,
    chooseCustomEmbedding, setEmbeddingModel, setEmbeddingApiBase, setEmbeddingApiKey,
  } = useMobileOnboardingSettingsForm();

  const {
    step, setupAction, chooseSetupAction,
    fandomName, setFandomName, auName, setAuName,
    ethicsAccepted, setEthicsAccepted,
    submitting, submitError,
    goPrev, goNext, finish,
  } = useMobileOnboardingFlow(onComplete);

  const language = (i18n.resolvedLanguage === 'en' ? 'en' : 'zh') as AppLanguage;
  const currentStep = step + 1;

  const canAdvance = useMemo(() => {
    if (step === 0) return true;
    if (step === 1) return connectionStatus === 'success';
    if (step === 2) {
      return !form.useCustomEmbedding || Boolean(form.embeddingModel.trim() && form.embeddingApiBase.trim() && form.embeddingApiKey.trim());
    }
    if (step === 3) {
      return setupAction !== 'create' || Boolean(fandomName.trim() && auName.trim());
    }
    if (step === 4) return ethicsAccepted;
    return true;
  }, [auName, connectionStatus, form.embeddingApiBase, form.embeddingApiKey, form.embeddingModel, ethicsAccepted, fandomName, setupAction, step, form.useCustomEmbedding]);

  const handleLanguageChange = async (nextLanguage: AppLanguage) => {
    await changeLanguage(nextLanguage);
  };

  return (
    <div className="fixed inset-0 z-50 flex min-app-height flex-col bg-background text-text">
      <header className="safe-area-top flex items-center justify-between border-b border-black/10 bg-background px-4 py-3 dark:border-white/10">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text">{t('common.appName')}</div>
          <div className="text-xs text-text/50">{t('onboarding.mobile.header')}</div>
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
            <Spinner size="lg" className="text-accent" />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-xl flex-col gap-4 pb-8">
            {step === 0 && (
              <>
                <div className="space-y-2">
                  <h1 className="text-3xl font-serif font-bold">{t('onboarding.mobile.language.title')}</h1>
                  <p className="text-base leading-relaxed text-text/70">{t('onboarding.mobile.language.subtitle')}</p>
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
                  <p className="text-base leading-relaxed text-text/70">{t('onboarding.mobile.llm.subtitle')}</p>
                  <details className="text-xs text-text/50 mt-2">
                    <summary className="cursor-pointer hover:text-text/70">{t('onboarding.techDetailsLabel')}</summary>
                    <p className="mt-1 pl-3 border-l-2 border-text/10">{t('onboarding.mobile.llm.techDetails')}</p>
                  </details>
                </div>

                <SecretStorageNotice />

                <Card className="space-y-4 rounded-xl p-4">
                  {/* 服务商主导选择器（与全局设置同一组件，R2-7）：服务商 → 模型 → ctx 三态 */}
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
                  />
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-medium text-text">{t('onboarding.apiConfig.apiBase')}</span>
                    <HelpTooltip text={t('onboarding.apiConfig.apiBaseTooltip')} />
                  </div>
                  <Input
                    value={form.apiBase}
                    onChange={event => setApiBase(event.target.value)}
                    placeholder="https://api.deepseek.com"
                  />
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-medium text-text">{t('onboarding.apiConfig.apiKey')}</span>
                    <HelpTooltip text={t('onboarding.apiConfig.apiKeyTooltip')} />
                  </div>
                  <Input
                    type="password"
                    value={form.apiKey}
                    onChange={event => setApiKey(event.target.value)}
                    placeholder="sk-..."
                  />
                  <p className="text-xs text-text/50">
                    <button type="button" className="text-accent hover:underline" onClick={openHelp}>{t('help.apiSetup.howToGet')}</button>
                  </p>

                  <Button
                    tone="neutral" fill="outline"
                    className="w-full"
                    onClick={testConnection}
                    disabled={!canTestConnection || connectionStatus === 'testing'}
                  >
                    {connectionStatus === 'testing' ? <><Spinner size="md" className="mr-2" />{t('onboarding.apiConfig.testing')}</> : t('onboarding.apiConfig.testConnection')}
                  </Button>

                  {connectionStatus !== 'idle' && (
                    <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                      connectionStatus === 'success'
                        ? 'bg-success/10 text-success'
                        : connectionStatus === 'error'
                          ? 'bg-error/10 text-error'
                          : 'bg-surface text-text/70'
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
                  <p className="text-base leading-relaxed text-text/70">{t('onboarding.mobile.embedding.subtitle')}</p>
                  <details className="text-xs text-text/50 mt-2">
                    <summary className="cursor-pointer hover:text-text/70">{t('onboarding.techDetailsLabel')}</summary>
                    <p className="mt-1 pl-3 border-l-2 border-text/10">{t('onboarding.mobile.embedding.techDetails')}</p>
                  </details>
                </div>

                <StepCard
                  active={form.useCustomEmbedding}
                  title={t('onboarding.mobile.embedding.recommendedTitle')}
                  description={t('onboarding.mobile.embedding.recommendedDescription')}
                  icon={<Database size={18} />}
                  onClick={() => chooseCustomEmbedding(true)}
                />
                <StepCard
                  active={!form.useCustomEmbedding}
                  title={t('onboarding.mobile.embedding.skipTitle')}
                  description={t('onboarding.mobile.embedding.skipDescription')}
                  icon={<ArrowRight size={18} />}
                  onClick={() => chooseCustomEmbedding(false)}
                />

                {form.useCustomEmbedding && (
                  <Card className="space-y-4 rounded-xl p-4">
                    {/* embedding 槽位复用同一选择器（kind=embedding：只显示向量模型 + 手填，R2-7） */}
                    <ProviderModelPicker
                      kind="embedding"
                      model={form.embeddingModel}
                      onModelChange={setEmbeddingModel}
                      apiBase={form.embeddingApiBase}
                      onApiBaseAutoFill={setEmbeddingApiBase}
                      apiKey={form.embeddingApiKey}
                      onApiKeyAutoFill={setEmbeddingApiKey}
                    />
                    <Input
                      label={t('common.labels.apiBase')}
                      value={form.embeddingApiBase}
                      onChange={event => setEmbeddingApiBase(event.target.value)}
                      placeholder={t('settings.global.embeddingApiBasePlaceholder')}
                    />
                    <Input
                      label={t('common.labels.apiKey')}
                      type="password"
                      value={form.embeddingApiKey}
                      onChange={event => setEmbeddingApiKey(event.target.value)}
                      placeholder="sk-..."
                    />
                    <p className="text-xs text-text/50">
                      <button type="button" className="text-accent hover:underline" onClick={openHelp}>{t('help.apiSetup.howToGet')}</button>
                    </p>
                    <p className="text-sm leading-relaxed text-text/50">{t('onboarding.mobile.embedding.recommendedHint')}</p>
                  </Card>
                )}
              </>
            )}

            {step === 3 && (
              <>
                <div className="space-y-2">
                  <h1 className="text-3xl font-serif font-bold">{t('onboarding.mobile.setup.title')}</h1>
                  <p className="text-base leading-relaxed text-text/70">{t('onboarding.mobile.setup.subtitle')}</p>
                  <details className="text-xs text-text/50 mt-2">
                    <summary className="cursor-pointer hover:text-text/70">{t('onboarding.techDetailsLabel')}</summary>
                    <p className="mt-1 pl-3 border-l-2 border-text/10">{t('onboarding.mobile.setup.techDetails')}</p>
                  </details>
                </div>

                <div className="grid gap-3">
                  <StepCard
                    active={setupAction === 'create'}
                    title={t('onboarding.mobile.setup.createTitle')}
                    description={t('onboarding.mobile.setup.createDescription')}
                    icon={<FolderPlus size={18} />}
                    onClick={() => chooseSetupAction('create')}
                  />
                  <StepCard
                    active={setupAction === 'import-local'}
                    title={t('onboarding.mobile.setup.importTitle')}
                    description={t('onboarding.mobile.setup.importDescription')}
                    icon={<Download size={18} />}
                    onClick={() => chooseSetupAction('import-local')}
                  />
                  <StepCard
                    active={setupAction === 'later'}
                    title={t('onboarding.mobile.setup.laterTitle')}
                    description={t('onboarding.mobile.setup.laterDescription')}
                    icon={<ArrowRight size={18} />}
                    onClick={() => chooseSetupAction('later')}
                  />
                </div>

                {setupAction === 'create' && (
                  <Card className="rounded-xl p-4">
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
                  <p className="text-base leading-relaxed text-text/70">{t('onboarding.mobile.ethics.subtitle')}</p>
                </div>

                <Card className="space-y-4 rounded-xl p-5">
                  <div className="space-y-3 text-sm text-text/70">
                    <p>📱 {t('onboarding.mobile.ethics.privacyNote')}</p>
                    <p>✍️ {t('onboarding.mobile.ethics.aiNote')}</p>
                    <p>📖 {t('onboarding.mobile.ethics.respectNote')}</p>
                  </div>
                  <label className="flex items-start gap-3 rounded-xl border border-black/10 bg-background px-4 py-3 text-sm text-text/70 dark:border-white/10">
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
                  <p className="text-base leading-relaxed text-text/70">{t('onboarding.mobile.complete.subtitle')}</p>
                </div>

                <Card className="space-y-3 rounded-xl p-5">
                  <div className="flex items-start gap-3 text-sm text-text/90">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
                    <span>{t('onboarding.mobile.complete.languageSummary', { language: language === 'zh' ? '中文' : 'English' })}</span>
                  </div>
                  <div className="flex items-start gap-3 text-sm text-text/90">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
                    <span>{t('onboarding.mobile.complete.llmSummary', { model: form.model })}</span>
                  </div>
                  <div className="flex items-start gap-3 text-sm text-text/90">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
                    <span>
                      {form.useCustomEmbedding
                        ? t('onboarding.mobile.complete.embeddingSummary', { model: form.embeddingModel })
                        : t('onboarding.mobile.complete.embeddingSkipped')}
                    </span>
                  </div>
                  <div className="flex items-start gap-3 text-sm text-text/90">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
                    <span>
                      {setupAction === 'create'
                        ? t('onboarding.mobile.complete.createSummary', { fandomName, auName })
                        : setupAction === 'import-local'
                          ? t('onboarding.mobile.complete.importSummary')
                          : t('onboarding.mobile.complete.laterSummary')}
                    </span>
                  </div>
                </Card>

                {submitError && (
                  <div className="rounded-xl bg-error/10 px-4 py-3 text-sm text-error">
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
              tone="neutral" fill="plain"
              className="flex-1"
              onClick={goPrev}
              disabled={step === 0 || submitting}
            >
              {t('onboarding.common.prev')}
            </Button>
            {step < TOTAL_STEPS - 1 ? (
              <Button
                tone="accent" fill="solid"
                className="flex-1"
                onClick={goNext}
                disabled={!canAdvance || submitting}
              >
                {t('onboarding.common.next')}
              </Button>
            ) : (
              <Button tone="accent" fill="solid" className="flex-1" onClick={() => { void finish(form); }} disabled={submitting}>
                {submitting ? <><Spinner size="md" className="mr-2" />{t('common.status.saving')}</> : t('ethics.onboardingAcknowledge')}
              </Button>
            )}
          </div>
        </footer>
      )}
      <ApiSetupHelp isOpen={helpOpen} onClose={closeHelp} />
    </div>
  );
}
