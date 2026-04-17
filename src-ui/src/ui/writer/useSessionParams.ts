// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useRef, useMemo, useCallback } from 'react';
import { getSettings, updateSettings, getProject, updateProject, type ProjectInfo, type SettingsInfo } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';

function hasSessionLlmOverride(llm: ProjectInfo['llm'] | null | undefined): boolean {
  return Boolean(
    llm && (
      llm.mode !== 'api'
      || llm.model
      || llm.api_base
      || llm.api_key
      || llm.local_model_path
      || llm.ollama_model
    )
  );
}

function getConfiguredLlmModel(llm: ProjectInfo['llm'] | null | undefined): string {
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
  projectInfo: ProjectInfo | null,
  settingsInfo: SettingsInfo | null,
  showSuccess: (msg: string) => void,
  showError: (err: unknown, fallback: string) => void,
) {
  const { t } = useTranslation();
  const activeAuPathRef = useRef(auPath);
  activeAuPathRef.current = auPath;

  const [sessionModel, setSessionModel] = useState('deepseek-chat');
  const [sessionTemp, setSessionTemp] = useState(1.0);
  const [sessionTopP, setSessionTopP] = useState(0.95);

  const handleSaveGlobalParams = useCallback(async () => {
    const requestAuPath = auPath;
    try {
      const settings = await getSettings();
      settings.model_params = settings.model_params || {};
      settings.model_params[sessionModel] = { temperature: sessionTemp, top_p: sessionTopP };
      await updateSettings(settings);
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
      const proj = await getProject(auPath);
      if (!proj.model_params_override) proj.model_params_override = {};
      proj.model_params_override[sessionModel] = { temperature: sessionTemp, top_p: sessionTopP };
      await updateProject(auPath, proj);
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
    const configuredModel = getConfiguredLlmModel(source as ProjectInfo['llm']) || sessionModel;

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
