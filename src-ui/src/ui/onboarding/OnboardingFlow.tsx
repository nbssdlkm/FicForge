// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { WelcomeStep } from './WelcomeStep';
import { ApiConfigStep, type ApiConfig } from './ApiConfigStep';
import { CreateFandomStep } from './CreateFandomStep';
import { CompletionStep } from './CompletionStep';
import { MobileOnboarding, type OnboardingCompletion } from './MobileOnboarding';
import { saveDefaultLlmSettings } from '../../api/engine-client';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useTranslation } from '../../i18n/useAppTranslation';
import { buildDefaultLlmSettingsInput } from '../shared/llm-config';

const ONBOARDING_KEY = 'ficforge.onboarding.completed';

export function isOnboardingCompleted(): boolean {
  try { return localStorage.getItem(ONBOARDING_KEY) === 'true'; }
  catch { return false; }
}

export function OnboardingFlow({ onComplete }: { onComplete: (result?: OnboardingCompletion) => void }) {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [step, setStep] = useState(0);
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [fandomName, setFandomName] = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleApiNext = useCallback(async (config: ApiConfig) => {
    setApiConfig(config);
    setSaveError(null);
    // 保存配置到 settings
    try {
      await saveDefaultLlmSettings(buildDefaultLlmSettingsInput({
        mode: config.mode,
        model: config.model,
        apiBase: config.api_base,
        apiKey: config.api_key,
        localModelPath: config.local_model_path,
        ollamaModel: config.ollama_model,
      }, 0));
      setConfigSaved(true);
      setStep(2);
    } catch (e: any) {
      setSaveError(e?.message || t('error_messages.unknown'));
      // 保存失败——不跳到下一步
    }
  }, [t]);

  const handleFandomNext = useCallback((name: string | null) => {
    setFandomName(name);
    setStep(3);
  }, []);

  const handleComplete = useCallback((result?: OnboardingCompletion) => {
    try { localStorage.setItem(ONBOARDING_KEY, 'true'); } catch { /* ignore */ }
    onComplete(result);
  }, [onComplete]);

  const handleClose = useCallback(() => {
    // 只有配置已成功保存才标记完成
    if (configSaved) {
      try { localStorage.setItem(ONBOARDING_KEY, 'true'); } catch { /* ignore */ }
      onComplete();
    } else {
      // 未保存配置，弹确认
      setShowCloseConfirm(true);
    }
  }, [configSaved, onComplete]);

  const handleConfirmClose = useCallback(() => {
    // 用户确认跳过——不标记 completed，下次打开会重新检查
    setShowCloseConfirm(false);
    onComplete();
  }, [onComplete]);

  const closeConfirmDialog = showCloseConfirm && (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="mx-4 max-w-sm rounded-xl bg-surface p-6 shadow-xl">
        <p className="text-sm text-text/90 leading-relaxed">{t('onboarding.closeConfirm')}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-lg px-4 py-2 text-sm text-text/70 hover:bg-black/5 dark:hover:bg-white/5" onClick={() => setShowCloseConfirm(false)}>{t('common.actions.cancel')}</button>
          <button className="rounded-lg bg-accent px-4 py-2 text-sm text-white" onClick={handleConfirmClose}>{t('onboarding.closeConfirmYes')}</button>
        </div>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <>
        <MobileOnboarding onComplete={handleComplete} onClose={handleClose} />
        {closeConfirmDialog}
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Close button */}
      <div className="absolute top-4 right-4">
        <button
          className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 text-text/50 hover:text-text/70 transition-colors"
          onClick={handleClose}
          aria-label={t('common.actions.close')}
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6">
        {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
        {step === 1 && (
          <>
            <ApiConfigStep
              onNext={handleApiNext}
              onPrev={() => setStep(0)}
              initialConfig={apiConfig || undefined}
            />
            {saveError && (
              <div className="mx-auto mt-3 max-w-lg rounded-lg border border-error/30 bg-error/5 px-4 py-2 text-sm text-error">
                {saveError}
              </div>
            )}
          </>
        )}
        {step === 2 && (
          <CreateFandomStep
            onNext={handleFandomNext}
            onPrev={() => setStep(1)}
          />
        )}
        {step === 3 && (
          <CompletionStep
            fandomName={fandomName}
            onComplete={() => handleComplete()}
          />
        )}
      </div>

      {closeConfirmDialog}
    </div>
  );
}
