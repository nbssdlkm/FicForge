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
import { updateSettings } from '../../api/engine-client';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useTranslation } from '../../i18n/useAppTranslation';

const ONBOARDING_KEY = 'ficforge.onboarding.completed';

export function isOnboardingCompleted(): boolean {
  return localStorage.getItem(ONBOARDING_KEY) === 'true';
}

export function OnboardingFlow({ onComplete }: { onComplete: (result?: OnboardingCompletion) => void }) {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [step, setStep] = useState(0);
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [fandomName, setFandomName] = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const handleApiNext = useCallback(async (config: ApiConfig) => {
    setApiConfig(config);
    // 保存配置到 settings
    try {
      await updateSettings({
        default_llm: {
          mode: config.mode,
          model: config.mode === 'api' ? config.model : '',
          api_base: config.api_base,
          api_key: config.api_key,
          local_model_path: config.local_model_path,
          ollama_model: config.ollama_model,
          context_window: 0,
        },
      });
    } catch {
      // 保存失败不阻塞引导流程
    }
    setStep(2);
  }, []);

  const handleFandomNext = useCallback((name: string | null) => {
    setFandomName(name);
    setStep(3);
  }, []);

  const handleComplete = useCallback((result?: OnboardingCompletion) => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    onComplete(result);
  }, [onComplete]);

  const handleClose = useCallback(() => {
    // 如果已配置 API，关闭时标记完成
    if (apiConfig) {
      localStorage.setItem(ONBOARDING_KEY, 'true');
      onComplete();
    } else {
      // 未配置 API，弹确认
      setShowCloseConfirm(true);
    }
  }, [apiConfig, onComplete]);

  const handleConfirmClose = useCallback(() => {
    // 用户确认跳过——不标记 completed，下次打开会重新检查
    setShowCloseConfirm(false);
    onComplete();
  }, [onComplete]);

  const closeConfirmDialog = showCloseConfirm && (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="mx-4 max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
        <p className="text-sm text-text/80 leading-relaxed">{t('onboarding.closeConfirm')}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-lg px-4 py-2 text-sm text-text/60 hover:bg-black/5 dark:hover:bg-white/5" onClick={() => setShowCloseConfirm(false)}>{t('common.actions.cancel')}</button>
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
          className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 text-text/40 hover:text-text/70 transition-colors"
          onClick={handleClose}
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6">
        {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
        {step === 1 && (
          <ApiConfigStep
            onNext={handleApiNext}
            onPrev={() => setStep(0)}
            initialConfig={apiConfig || undefined}
          />
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
