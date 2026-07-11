// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useSimpleChatPanelConfig — 简对话面板的配置四件套（长期债②同族状态下沉）。
 *
 * projectInfo / settingsInfo / settingsSummary / extractionReady 的可重调用加载
 * （R1-1）：挂载跑一次；面板常驻挂载后，settings tab 改 LLM 配置 / 开关提取开关不会
 * 重挂本面板 —— 切回对话 tab 的 false→true 边沿也要重拉，否则 dispatch payload 与
 * canAutoExtract gate 永久用旧配置。token 防 AU 快切 / 并发刷新的旧结果倒灌。
 *
 * canAutoExtract 双 gate（审计④，与 resolveFactsProvider 同源）也住这里 —— 判据的
 * 两个输入（settingsSummary / extractionReady）都在本 hook，派生值随之一处收口。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getFactsExtractionReadiness,
  getSettingsSummary,
  getWriterProjectContext,
  getWriterSessionConfig,
  type SettingsSummary,
  type WriterProjectContext,
  type WriterSessionConfig,
} from "../../api/engine-client";

export function useSimpleChatPanelConfig(auPath: string, isActiveTab?: boolean) {
  const [projectInfo, setProjectInfo] = useState<WriterProjectContext | null>(null);
  const [settingsInfo, setSettingsInfo] = useState<WriterSessionConfig | null>(null);
  const [settingsSummary, setSettingsSummary] = useState<SettingsSummary | null>(null);
  // 自动提取就位（审计④）：与 resolveFactsProvider 同源的「有无可用连接」判断，
  // 由引擎按 project+settings 解析得出，取代 UI 侧只看全局 default_llm 的旧口径。
  const [extractionReady, setExtractionReady] = useState<{ has_usable_connection: boolean } | null>(null);

  // 切 AU reset（铁律②：state 与 reset 同文件）；加载间隙不残留上一篇配置。
  useEffect(() => {
    setProjectInfo(null);
    setSettingsInfo(null);
    setSettingsSummary(null);
    setExtractionReady(null);
  }, [auPath]);

  // token 防 AU 快切 / 并发刷新的旧结果倒灌。
  const configLoadTokenRef = useRef(0);
  const refreshPanelConfig = useCallback(async () => {
    const token = ++configLoadTokenRef.current;
    const [proj, settings, summary, readiness] = await Promise.all([
      getWriterProjectContext(auPath).catch(() => null),
      getWriterSessionConfig().catch(() => null),
      getSettingsSummary().catch(() => null),
      getFactsExtractionReadiness(auPath).catch(() => null),
    ]);
    if (configLoadTokenRef.current !== token) return;
    setProjectInfo(proj);
    setSettingsInfo(settings);
    setSettingsSummary(summary);
    setExtractionReady(readiness);
  }, [auPath]);

  useEffect(() => {
    void refreshPanelConfig();
  }, [refreshPanelConfig]);

  // 切回对话 tab 的 false→true 边沿重拉配置四件套（R1-1 / 终审 1-A）：settings tab 改
  // LLM 配置 / 开关「增强事实提取」后，dispatch payload 与 canAutoExtract 必须用新值，
  // 不能停在挂载时快照。
  const wasActiveTabRef = useRef(isActiveTab !== false);
  useEffect(() => {
    const nowActive = isActiveTab !== false;
    const wasActive = wasActiveTabRef.current;
    wasActiveTabRef.current = nowActive;
    if (nowActive && !wasActive) {
      void refreshPanelConfig();
    }
  }, [isActiveTab, refreshPanelConfig]);

  // 自动提取 gate（审计④）：① settings 已加载且「增强事实提取」未被显式关闭（默认开，
  //   对齐 `!== false`）；settingsSummary 为 null（加载失败）时 fail-closed，不擅自提取。
  // ② LLM 就位（extractFacts 内部 react/plain 都需 LLM；未配会空跑报错）。任一不满足静默跳过。
  // 注：② 用 extractionReady（引擎按 project+settings 解析，与实际提取的 resolveFactsProvider 同源），
  // 不再用只看全局 default_llm 的 settingsSummary.default_llm——否则 AU 级独立配 LLM 时会误判为不可用（审计④）。
  const canAutoExtract =
    settingsSummary != null &&
    settingsSummary.app?.react_extraction_enabled !== false &&
    Boolean(extractionReady?.has_usable_connection);

  // 返回面收窄到实际被读的字段（C1 对抗审）：settingsSummary/extractionReady 只是
  // canAutoExtract 的内部输入，refreshPanelConfig 的两条触发通道（挂载 + 边沿）都已
  // 内部化 —— 不外泄，避免被误当对外契约。
  return {
    projectInfo,
    settingsInfo,
    canAutoExtract,
  };
}

export type SimpleChatPanelConfig = ReturnType<typeof useSimpleChatPanelConfig>;
