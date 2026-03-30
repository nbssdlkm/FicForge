import { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { WelcomeStep } from './WelcomeStep';
import { ApiConfigStep, type ApiConfig } from './ApiConfigStep';
import { CreateFandomStep } from './CreateFandomStep';
import { CompletionStep } from './CompletionStep';
import { updateSettings } from '../../api/settings';

const ONBOARDING_KEY = 'ficforge.onboarding.completed';

export function isOnboardingCompleted(): boolean {
  return localStorage.getItem(ONBOARDING_KEY) === 'true';
}

export function OnboardingFlow({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [fandomName, setFandomName] = useState<string | null>(null);

  const handleApiNext = useCallback(async (config: ApiConfig) => {
    setApiConfig(config);
    // 保存配置到 settings
    try {
      await updateSettings('./fandoms', {
        default_llm: {
          mode: config.mode,
          model: config.mode === 'ollama' ? '' : config.model,
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

  const handleComplete = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    onComplete();
  }, [onComplete]);

  const handleClose = useCallback(() => {
    // 关闭不标记完成
    onComplete();
  }, [onComplete]);

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
            onComplete={handleComplete}
          />
        )}
      </div>
    </div>
  );
}
