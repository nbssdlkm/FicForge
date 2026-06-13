// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — useContextTokenCount
 *
 * 顶栏实时 token 估算 hook。采集时机：
 * - auPath 切换 → 重算
 * - 调用方传入 refreshKey（例如 chapter accept counter）变化 → 重算
 * - 每 30 秒兜底自动重算 → 覆盖 refreshKey 漏的场景：用户切其他 tab 改设定 /
 *   undo 章节后切回对话面板时 token 应该更新但 chapterCount 没变（v4 盲审 P1-5）
 *
 * 防抖 500ms 合并连续触发；hook 内 mountedRef + tokenRef 防止 stale 设置。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  estimateSimpleContextTokens,
  type SimpleContextTokenEstimate,
} from "../../api/engine-client";
import { chatToOpenAIMessages } from "./chat-to-llm";
import type { SimpleChatMessage } from "./types";

const DEBOUNCE_MS = 500;
const AUTO_REFRESH_MS = 30_000;

export interface UseContextTokenCountResult {
  estimate: SimpleContextTokenEstimate | null;
  loading: boolean;
  error: string | null;
}

export function useContextTokenCount(
  auPath: string,
  refreshKey?: number | string,
  messages?: SimpleChatMessage[],
): UseContextTokenCountResult {
  const [estimate, setEstimate] = useState<SimpleContextTokenEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoTick, setAutoTick] = useState(0);
  const mountedRef = useRef(true);
  const tokenRef = useRef(0);

  // messages 用 useMemo + chatToOpenAIMessages 转换，避免每次 render 重新算 token API；
  // 仅当 messages 引用变化时触发重算（caller 用 chat.messages 已有稳定引用）。
  const historyForLLM = useMemo(
    () => (messages ? chatToOpenAIMessages(messages) : undefined),
    [messages],
  );

  useEffect(() => {
    // strict-mode 下 mount → unmount → remount 序列：
    // 第一次 cleanup 把 mountedRef 设 false，第二次 mount 必须显式重置 true，
    // 否则后续 setState 全被 mountedRef.current=false 早返回掉，UI 永远不更新。
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // 30s autoTick：兜底覆盖 refreshKey 漏掉的 state 变化（外部 tab 改设定 / undo 等）
  useEffect(() => {
    const id = setInterval(() => {
      if (mountedRef.current) setAutoTick((n) => n + 1);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!auPath) return;
    setLoading(true);
    setError(null);
    const myToken = ++tokenRef.current;

    const timer = setTimeout(() => {
      void estimateSimpleContextTokens(auPath, historyForLLM)
        .then((data) => {
          if (!mountedRef.current) return;
          if (tokenRef.current !== myToken) return;
          setEstimate(data);
          setLoading(false);
        })
        .catch((err) => {
          if (!mountedRef.current) return;
          if (tokenRef.current !== myToken) return;
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [auPath, refreshKey, autoTick, historyForLLM]);

  return { estimate, loading, error };
}
