// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  saveGlobalModelParams,
  saveProjectModelParamsOverride,
  type WriterProjectContext,
  type WriterSessionConfig,
} from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';

function hasSessionLlmOverride(llm: WriterProjectContext['llm'] | null | undefined): boolean {
  return Boolean(llm?.has_override);
}

function getConfiguredLlmModel(llm: WriterProjectContext['llm'] | WriterSessionConfig['default_llm'] | null | undefined): string {
  if (!llm) return '';
  if (llm.mode === 'ollama') {
    return llm.ollama_model || llm.model || '';
  }
  if (llm.mode === 'local') {
    if (llm.model) return llm.model;
    const path = llm.local_model_path?.trim() || '';
    if (!path) return '';
    const segments = path.split(/[\\/]/).filter(Boolean);
    return segments[segments.length - 1] || path;
  }
  return llm.model || '';
}

export function useSessionParams(
  auPath: string,
  projectInfo: WriterProjectContext | null,
  settingsInfo: WriterSessionConfig | null,
  showSuccess: (msg: string) => void,
  showError: (err: unknown, fallback: string) => void,
) {
  const { t } = useTranslation();
  const activeAuPathRef = useRef(auPath);
  activeAuPathRef.current = auPath;

  const [sessionModel, setSessionModel] = useState('deepseek-chat');
  const [sessionTemp, setSessionTemp] = useState(1.0);
  const [sessionTopP, setSessionTopP] = useState(0.95);

  // AU 切换时 reset 到默认值（bootstrap 随后会通过下方 useEffect 派生正确值）
  useEffect(() => {
    setSessionModel('deepseek-chat');
    setSessionTemp(1.0);
    setSessionTopP(0.95);
  }, [auPath]);

  // 从 bootstrap 加载的 projectInfo / settingsInfo 派生 session 默认值。
  // 原来这段逻辑在 bootstrap.loadData 里，通过 setSessionModel/Temp/TopP 反注入；
  // 现在改为 sessionParams 自己 watch + 派生，消除 sessionParamsBridgeRef。
  useEffect(() => {
    if (!projectInfo && !settingsInfo) return;

    let defModel = 'deepseek-chat';
    let defTemp = 1.0;
    let defTopP = 0.95;

    const globalConfiguredModel = getConfiguredLlmModel(settingsInfo?.default_llm);
    if (globalConfiguredModel) {
      defModel = globalConfiguredModel;
      const globalParams = settingsInfo?.model_params?.[defModel];
      if (globalParams) {
        defTemp = globalParams.temperature;
        defTopP = globalParams.top_p;
      }
    }

    const projectConfiguredModel = getConfiguredLlmModel(projectInfo?.llm);
    if (projectConfiguredModel) {
      defModel = projectConfiguredModel;
    }
    if (projectInfo?.model_params_override?.[defModel]) {
      const override = projectInfo.model_params_override[defModel];
      defTemp = (override.temperature as number) ?? defTemp;
      defTopP = (override.top_p as number) ?? defTopP;
    }

    setSessionModel(defModel);
    setSessionTemp(defTemp);
    setSessionTopP(defTopP);
  }, [projectInfo, settingsInfo]);

  const handleSaveGlobalParams = useCallback(async () => {
    const requestAuPath = auPath;
    try {
      await saveGlobalModelParams(sessionModel, { temperature: sessionTemp, top_p: sessionTopP });
      if (activeAuPathRef.current !== requestAuPath) return;
      showSuccess(t('writer.saveGlobalSuccess'));
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    }
  }, [auPath, sessionModel, sessionTemp, sessionTopP, showError, showSuccess, t]);

  const handleSaveAuParams = useCallback(async () => {
    const requestAuPath = auPath;
    try {
      await saveProjectModelParamsOverride(auPath, sessionModel, { temperature: sessionTemp, top_p: sessionTopP });
      if (activeAuPathRef.current !== requestAuPath) return;
      showSuccess(t('writer.saveAuSuccess'));
    } catch (error) {
      if (activeAuPathRef.current !== requestAuPath) return;
      showError(error, t('error_messages.unknown'));
    }
  }, [auPath, sessionModel, sessionTemp, sessionTopP, showError, showSuccess, t]);

  const sessionLlmPayload = useMemo(() => {
    if (!sessionModel) return null;

    const source = hasSessionLlmOverride(projectInfo?.llm)
      ? projectInfo?.llm
      : settingsInfo?.default_llm;
    const configuredModel = getConfiguredLlmModel(source) || sessionModel;

    // 注意：不发送 api_key —— 前端只持有掩码值（如 ****9cb2），
    // 后端 resolve_llm_config 会从磁盘读取真实 key。
    return {
      mode: source?.mode || 'api',
      model: configuredModel,
      api_base: source?.api_base || '',
      local_model_path: source?.local_model_path || '',
      ollama_model: source?.ollama_model || '',
    };
  }, [projectInfo, sessionModel, settingsInfo]);

  return {
    // state
    sessionModel,
    setSessionModel,
    sessionTemp,
    setSessionTemp,
    sessionTopP,
    setSessionTopP,

    // handlers
    handleSaveGlobalParams,
    handleSaveAuParams,

    // derived
    sessionLlmPayload,

    // helpers (re-exported for consumers that need them)
    hasSessionLlmOverride,
    getConfiguredLlmModel,
  };
}
