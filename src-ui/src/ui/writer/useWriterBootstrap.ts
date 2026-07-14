// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getChapterContent,
  getState,
  getWriterProjectContext,
  getWriterSessionConfig,
  listFacts,
  type FactInfo,
  type StateInfo,
  type WriterProjectContext,
  type WriterSessionConfig,
} from "../../api/engine-client";
import type { ActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { swallowTo, swallowToNull } from "../../utils/ui-logger";

type UseWriterBootstrapOptions = {
  auPath: string;
  loadGuard: ActiveRequestGuard<string>;
  refreshGuard: ActiveRequestGuard<string>;
  showError: (error: unknown, fallback: string) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
};

export function useWriterBootstrap({ auPath, loadGuard, refreshGuard, showError, t }: UseWriterBootstrapOptions) {
  const [state, setState] = useState<StateInfo | null>(null);
  const [projectInfo, setProjectInfo] = useState<WriterProjectContext | null>(null);
  const [settingsInfo, setSettingsInfo] = useState<WriterSessionConfig | null>(null);
  const [currentContent, setCurrentContent] = useState("");
  const [unresolvedFacts, setUnresolvedFacts] = useState<FactInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    const token = loadGuard.start();
    setLoading(true);
    try {
      const [stateData, factsData, proj, settings] = await Promise.all([
        getState(auPath).catch(swallowToNull("useWriterBootstrap", "load state failed")),
        listFacts(auPath, "unresolved").catch(swallowTo([], "useWriterBootstrap", "load unresolved facts failed")),
        getWriterProjectContext(auPath).catch(swallowToNull("useWriterBootstrap", "load project context failed")),
        getWriterSessionConfig().catch(swallowToNull("useWriterBootstrap", "load session config failed")),
      ]);
      if (loadGuard.isStale(token)) return;

      setState(stateData);
      setProjectInfo(proj);
      setSettingsInfo(settings);
      setUnresolvedFacts(factsData);

      // 注：focus selection 的同步改由 useWriterFocusController 自己 watch state 响应；
      // session model/temp/topP 的派生由 useSessionParams 自己 watch projectInfo/settingsInfo；
      // instruction text 的 storage 加载由 useWriterInstructionInput 自己 watch currentChapterNum。
      // 下面 loadData 不再反注入这些派生动作。
      // useSessionParams 自己 watch projectInfo/settingsInfo 并派生，消除 bridge。

      if (stateData && stateData.current_chapter > 1) {
        const latestNum = stateData.current_chapter - 1;
        try {
          const content = await getChapterContent(auPath, latestNum);
          if (loadGuard.isStale(token)) return;
          // getChapterContent 恒返 string（getContentOnly: Promise<string>，缺失即抛，不返 null）
          setCurrentContent(content);
        } catch {
          if (loadGuard.isStale(token)) return;
          setCurrentContent(t("writer.contentLoadFailed"));
        }
      } else {
        setCurrentContent("");
      }

      // 注：draft 加载、instruction storage 加载、focus 同步、session params 派生
      // 都不再由 bootstrap.loadData 反注入执行。每个下游 hook 自主 watch state/projectInfo/settingsInfo 响应。
      if (!stateData) {
        setProjectInfo(null);
      }
    } catch (error) {
      if (loadGuard.isStale(token)) return;
      showError(error, t("error_messages.unknown"));
    } finally {
      if (!loadGuard.isStale(token)) {
        setLoading(false);
      }
    }
  }, [auPath, loadGuard, showError, t]);

  const refreshSettingsModeData = useCallback(async () => {
    const token = refreshGuard.start();
    try {
      const [stateData, factsData, proj, settings] = await Promise.all([
        getState(auPath).catch(swallowToNull("useWriterBootstrap", "load state failed")),
        listFacts(auPath, "unresolved").catch(swallowTo([], "useWriterBootstrap", "load unresolved facts failed")),
        getWriterProjectContext(auPath).catch(swallowToNull("useWriterBootstrap", "load project context failed")),
        getWriterSessionConfig().catch(swallowToNull("useWriterBootstrap", "load session config failed")),
      ]);
      if (refreshGuard.isStale(token)) return;

      if (stateData) {
        setState(stateData);
        // focus 同步由 useWriterFocusController 自己 watch state 响应
      }
      setProjectInfo(proj);
      // R1-1：settingsInfo 一并刷新 —— settings-chat 改写全局配置 / settings tab 改 LLM
      // 后，生成 payload 的 sessionParams 输入必须跟着新鲜。瞬时失败（null）时保留旧值：
      // 刷新是增量动作，不该把「可用但略旧」降级成「不可用」。
      if (settings) {
        setSettingsInfo(settings);
      }
      setUnresolvedFacts(factsData);
    } catch (error) {
      if (refreshGuard.isStale(token)) return;
      showError(error, t("error_messages.unknown"));
    }
  }, [auPath, refreshGuard, showError, t]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——effect 仅随 auPath 变化清空 bootstrap 数据；auPath 只作触发键、体内不读取；删除会使切 AU 后残留上一篇数据（铁律②）
  useEffect(() => {
    setState(null);
    setProjectInfo(null);
    setSettingsInfo(null);
    setCurrentContent("");
    setUnresolvedFacts([]);
    setLoading(true);
  }, [auPath]);

  // loadData 的 useCallback 有 24 个依赖；其中某个在每次 render 时引用不稳，
  // 直接 useEffect([loadData]) 会无限重触发 → loadData 跑一遍 → setState 触发 re-render
  // → loadData 重建 → useEffect 又触发，每秒 100+ 次。Android 真机肉眼可见加载圈不停。
  // 用 ref 持有最新 loadData，useEffect 仅按 auPath 触发。Phase 1 状态下沉后 deps
  // 自然减少，可重新评估是否回到 [loadData]。
  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;

  // biome-ignore lint/correctness/useExhaustiveDependencies: ref shim（铁律 4）——loadDataRef 每渲染同步最新 loadData，effect 仅随 auPath 触发；auPath 只作触发键、体内不直接读取；直接依赖 loadData 会因其不稳依赖每秒重触发（上方注释详述）
  useEffect(() => {
    void loadDataRef.current();
  }, [auPath]);

  const applyStateSnapshot = useCallback((nextState: StateInfo) => {
    setState(nextState);
  }, []);

  return {
    data: {
      state,
      projectInfo,
      settingsInfo,
      currentContent,
      unresolvedFacts,
    },
    loading,
    applyStateSnapshot,
    loadData,
    refreshSettingsModeData,
  };
}
