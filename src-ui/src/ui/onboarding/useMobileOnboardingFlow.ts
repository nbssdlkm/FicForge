// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useRef, useState } from "react";
import { createAu, createFandom, saveOnboardingSettings } from "../../api/engine-client";
import { useTranslation } from "../../i18n/useAppTranslation";
import { buildOnboardingSettingsSaveInput, type MobileOnboardingSettingsState } from "./form-mappers";

export type OnboardingCompletion = {
  nextAction?: "open-import" | "open-settings";
  openAuPath?: string;
};

export type SetupAction = "create" | "import-local" | "later";

export const TOTAL_STEPS = 6;

/**
 * useMobileOnboardingFlow — 引导页流程编排：步进、首篇作品选择、提交收尾。
 *
 * 设置表单的值在 finish 调用时以参数传入（hook 规则 3：跨 hook 只传 value），
 * 本 hook 不持有也不重复设置表单状态。
 */
export function useMobileOnboardingFlow(onComplete: (result?: OnboardingCompletion) => void) {
  const { t } = useTranslation();
  const isMountedRef = useRef(true);

  const [step, setStep] = useState(0);
  const [setupAction, setSetupAction] = useState<SetupAction>("create");
  const [fandomName, setFandomName] = useState("");
  const [auName, setAuName] = useState("");
  const [ethicsAccepted, setEthicsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // 步进时清掉上一次提交失败的残留提示
  const goPrev = useCallback(() => {
    setSubmitError("");
    setStep((prev) => Math.max(0, prev - 1));
  }, []);
  const goNext = useCallback(() => {
    setSubmitError("");
    setStep((prev) => Math.min(TOTAL_STEPS - 1, prev + 1));
  }, []);

  const chooseSetupAction = useCallback((action: SetupAction) => setSetupAction(action), []);

  const finish = async (settings: MobileOnboardingSettingsState) => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await saveOnboardingSettings(buildOnboardingSettingsSaveInput(settings));

      let openAuPath: string | undefined;
      if (setupAction === "create" && fandomName.trim() && auName.trim()) {
        const fandom = await createFandom(fandomName.trim());
        const au = await createAu(fandom.name, auName.trim(), fandom.path);
        openAuPath = au.path;
      }

      if (!isMountedRef.current) return;

      onComplete({
        openAuPath,
        nextAction: setupAction === "import-local" ? "open-import" : undefined,
      });
    } catch (error) {
      if (!isMountedRef.current) return;
      setSubmitError((error as { message?: string } | null)?.message || t("error_messages.unknown"));
    } finally {
      if (isMountedRef.current) {
        setSubmitting(false);
      }
    }
  };

  return {
    step,
    setupAction,
    chooseSetupAction,
    // 受控绑定 setter（hook 规则 5 例外①：Input / checkbox 双向绑定）
    fandomName,
    setFandomName,
    auName,
    setAuName,
    ethicsAccepted,
    setEthicsAccepted,
    submitting,
    submitError,
    goPrev,
    goNext,
    finish,
  };
}
