// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useSimpleChapterContext — 简对话面板的章节上下文（下一章号 + 已确认章数）。
 *
 * 切回对话 tab 的 false→true 边沿重拉（对抗审 F3）：常驻挂载后，写文 tab 的
 * confirm/undo 推进 current_chapter 但对话面板拿不到通知 —— 不刷新的话下一次
 * dispatch 会带过期 chapter_num 打到已确认章（接受侧另有章号 guard 兜底，这里把源头对齐）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getState } from "../../api/engine-client";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";

export function useSimpleChapterContext(auPath: string, isActiveTab?: boolean) {
  const { t } = useTranslation();
  const { showError } = useFeedback();

  const [pendingChapterNum, setPendingChapterNum] = useState<number | null>(null);
  const [chapterCount, setChapterCount] = useState(0);
  // 过期结果守卫（C1 对抗审：与 useSimpleChatPanelConfig 的 token 口径对齐）——
  // AU 快切 / 边沿与切 AU 叠加时，旧 AU 的 getState 晚 resolve 不得倒灌新 AU 的章节上下文。
  const loadTokenRef = useRef(0);

  // 切 AU reset（铁律②：state 与 reset 同文件）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——effect 仅随 auPath 变化 reset；auPath 只作触发键、体内不读取；删除会使切 AU 后不再清空章节上下文（铁律②）
  useEffect(() => {
    loadTokenRef.current += 1;
    setPendingChapterNum(null);
    setChapterCount(0);
  }, [auPath]);

  const refreshChapterContext = useCallback(async () => {
    const token = ++loadTokenRef.current;
    try {
      const st = await getState(auPath);
      if (token !== loadTokenRef.current) return; // 旧请求，丢弃
      setPendingChapterNum(st.current_chapter ?? 1);
      setChapterCount(Math.max(0, (st.current_chapter ?? 1) - 1));
    } catch (err) {
      if (token !== loadTokenRef.current) return;
      showError(err, t("error_messages.unknown"));
    }
  }, [auPath, showError, t]);

  useEffect(() => {
    void refreshChapterContext();
  }, [refreshChapterContext]);

  // 切回对话 tab 时刷新章节上下文（对抗审 F3）：常驻挂载后，写文 tab 的 confirm/undo
  // 推进 current_chapter 但对话面板拿不到通知 —— false→true 边沿一并重拉。
  const wasActiveTabRef = useRef(isActiveTab !== false);
  useEffect(() => {
    const nowActive = isActiveTab !== false;
    const wasActive = wasActiveTabRef.current;
    wasActiveTabRef.current = nowActive;
    if (nowActive && !wasActive) {
      void refreshChapterContext();
    }
  }, [isActiveTab, refreshChapterContext]);

  return { pendingChapterNum, chapterCount, refreshChapterContext };
}

export type SimpleChapterContext = ReturnType<typeof useSimpleChapterContext>;
