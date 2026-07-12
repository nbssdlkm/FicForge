// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useCallback } from "react";
import { X } from "lucide-react";
import { WelcomeStep } from "./WelcomeStep";
import { ApiConfigStep, type ApiConfig } from "./ApiConfigStep";
import { CreateFandomStep } from "./CreateFandomStep";
import { CompletionStep } from "./CompletionStep";
import { MobileOnboarding, type OnboardingCompletion } from "./MobileOnboarding";
import { Button } from "../shared/Button";
import { saveDefaultLlmSettings } from "../../api/engine-client";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useTranslation } from "../../i18n/useAppTranslation";
import { buildDefaultLlmSettingsInput, formCtxToSaveInput } from "../shared/llm-config";

const ONBOARDING_KEY = "ficforge.onboarding.completed";
const ONBOARDING_DISMISSED_SESSION_KEY = "ficforge.onboarding.dismissed_session";

export function isOnboardingCompleted(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "true";
  } catch {
    return false;
  }
}

export function isOnboardingDismissedForSession(): boolean {
  try {
    return sessionStorage.getItem(ONBOARDING_DISMISSED_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

export function markOnboardingDismissedForSession() {
  try {
    sessionStorage.setItem(ONBOARDING_DISMISSED_SESSION_KEY, "true");
  } catch {
    /* ignore */
  }
}

export function clearOnboardingDismissedForSession() {
  try {
    sessionStorage.removeItem(ONBOARDING_DISMISSED_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function OnboardingFlow({ onComplete }: { onComplete: (result?: OnboardingCompletion) => void }) {
  const { t } = useTranslation();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [step, setStep] = useState(0);
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [fandomName, setFandomName] = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleApiNext = useCallback(
    async (config: ApiConfig) => {
      setApiConfig(config);
      setSaveError(null);
      // 保存配置到 settings
      try {
        // ctx / chat_path 随选择器带出（R2-7）："" → 省略（引擎按模型推断 / 默认路径）。
        await saveDefaultLlmSettings(
          buildDefaultLlmSettingsInput(
            {
              mode: config.mode,
              model: config.model,
              apiBase: config.api_base,
              apiKey: config.api_key,
              localModelPath: config.local_model_path,
              ollamaModel: config.ollama_model,
              chatPath: config.chat_path,
            },
            formCtxToSaveInput(config.context_window),
          ),
        );
        setConfigSaved(true);
        setStep(2);
      } catch (e) {
        setSaveError(e instanceof Error && e.message ? e.message : t("error_messages.unknown"));
        // 保存失败——不跳到下一步
      }
    },
    [t],
  );

  const handleFandomNext = useCallback((name: string | null) => {
    setFandomName(name);
    setStep(3);
  }, []);

  const handleComplete = useCallback(
    (result?: OnboardingCompletion) => {
      try {
        localStorage.setItem(ONBOARDING_KEY, "true");
      } catch {
        /* ignore */
      }
      clearOnboardingDismissedForSession();
      onComplete(result);
    },
    [onComplete],
  );

  const handleClose = useCallback(() => {
    // 只有配置已成功保存才标记完成
    if (configSaved) {
      try {
        localStorage.setItem(ONBOARDING_KEY, "true");
      } catch {
        /* ignore */
      }
      clearOnboardingDismissedForSession();
      onComplete();
    } else {
      // 未保存配置，弹确认
      setShowCloseConfirm(true);
    }
  }, [configSaved, onComplete]);

  const handleConfirmClose = useCallback(() => {
    // 用户确认跳过——不标记 completed，下次打开会重新检查
    markOnboardingDismissedForSession();
    setShowCloseConfirm(false);
    onComplete();
  }, [onComplete]);

  const closeConfirmDialog = showCloseConfirm && (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-sm border border-rule bg-surface shadow-strong">
        {/* Drawer-banner header, matches Modal.tsx */}
        <div
          className="flex items-center justify-between bg-drawer px-5 py-3.5 text-inv-text"
          style={{
            boxShadow:
              "inset 0 var(--gold-top-thick) 0 var(--color-gold-bright), inset 0 var(--gold-bottom-thick) 0 var(--color-gold-bright)",
          }}
        >
          <h3 className="font-display text-lg font-semibold">{t("common.actions.close")}</h3>
        </div>
        <div className="px-6 py-5">
          <p className="font-serif text-sm leading-relaxed text-text/90">{t("onboarding.closeConfirm")}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button tone="neutral" fill="plain" size="sm" onClick={() => setShowCloseConfirm(false)}>
              {t("common.actions.cancel")}
            </Button>
            <Button tone="accent" fill="solid" size="sm" onClick={handleConfirmClose}>
              {t("onboarding.closeConfirmYes")}
            </Button>
          </div>
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
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Close button */}
      <div className="absolute right-4 top-4 z-10">
        <button
          type="button"
          className="rounded-full p-2 text-text/50 transition-colors hover:bg-rule-soft hover:text-text"
          onClick={handleClose}
          aria-label={t("common.actions.close")}
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6">
        {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
        {step === 1 && (
          <>
            <ApiConfigStep onNext={handleApiNext} onPrev={() => setStep(0)} initialConfig={apiConfig || undefined} />
            {saveError && (
              <div className="mx-auto mt-3 max-w-lg rounded-sm border border-error/30 bg-error/10 px-4 py-2 font-serif text-sm text-error">
                {saveError}
              </div>
            )}
          </>
        )}
        {step === 2 && <CreateFandomStep onNext={handleFandomNext} onPrev={() => setStep(1)} />}
        {step === 3 && <CompletionStep fandomName={fandomName} onComplete={() => handleComplete()} />}
      </div>

      {closeConfirmDialog}
    </div>
  );
}
