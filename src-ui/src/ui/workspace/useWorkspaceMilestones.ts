// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from "react";
import { getState, getWorkspaceSnapshot, listFacts, type FactInfo } from "../../api/engine-client";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { useMilestoneGuide } from "../../hooks/useMilestoneGuide";
import { catchAndLog } from "../../utils/ui-logger";

export type ActiveMilestoneId = "facts_intro" | "pinned_intro" | "focus_intro";

/**
 * useWorkspaceMilestones — 里程碑引导子域（R3 低危清扫：原先 8 个 useState +
 * 数据 effect + 触发判据全部混在 AuWorkspaceLayout 里）。
 *
 * hook 铁律姿势：全部 milestone state 住在本 hook；auPath 切换的 reset 由本 hook
 * 自己的 useEffect 处理；对外只暴露派生值与语义化方法（refreshMilestones /
 * dismissMilestone），不外泄任何 raw setter。
 *
 * 有意保留的原行为：sessionDismissed **不随 auPath 重置**——useMilestoneGuide 的
 * dismiss 是全局持久化，本地 map 只是「本次会话立即消失」的乐观层，跨 AU 维持一致。
 */
export function useWorkspaceMilestones(auPath: string) {
  const loadGuard = useActiveRequestGuard(auPath);
  const { shouldShow, dismiss } = useMilestoneGuide();

  const [refreshKey, setRefreshKey] = useState(0);
  const [currentChapter, setCurrentChapter] = useState(1);
  const [factsCount, setFactsCount] = useState(0);
  const [pinnedCount, setPinnedCount] = useState(0);
  const [unresolvedFact, setUnresolvedFact] = useState<string | null>(null);
  const [chapterFocusEmpty, setChapterFocusEmpty] = useState(true);
  const [sessionDismissed, setSessionDismissed] = useState<Record<string, boolean>>({});

  // State 与 reset 同文件（hook 铁律 2）：切 AU 回到初始快照，等数据 effect 重灌。
  useEffect(() => {
    setCurrentChapter(1);
    setFactsCount(0);
    setPinnedCount(0);
    setUnresolvedFact(null);
    setChapterFocusEmpty(true);
  }, [auPath]);

  // Milestone data — auPath 变化或写路径完成（refreshMilestones）后重拉。
  useEffect(() => {
    if (!auPath) return;
    const anyMilestoneActive = shouldShow("facts_intro") || shouldShow("pinned_intro") || shouldShow("focus_intro");
    if (!anyMilestoneActive) return;

    getState(auPath)
      .then((state) => {
        if (loadGuard.isKeyStale(auPath)) return;
        setCurrentChapter(state.current_chapter || 1);
        setChapterFocusEmpty(!state.chapter_focus || state.chapter_focus.length === 0);
      })
      .catch(catchAndLog("workspace", "milestone getState failed"));

    listFacts(auPath)
      .then((facts) => {
        if (loadGuard.isKeyStale(auPath)) return;
        setFactsCount(facts.length);
        const firstUnresolved = facts.find((f: FactInfo) => f.status === "unresolved");
        setUnresolvedFact(firstUnresolved ? (firstUnresolved.content_clean || "").slice(0, 20) + "..." : null);
      })
      .catch(catchAndLog("workspace", "milestone listFacts failed"));

    getWorkspaceSnapshot(auPath)
      .then((snapshot) => {
        if (loadGuard.isKeyStale(auPath)) return;
        setPinnedCount(snapshot.pinned_count);
      })
      .catch(catchAndLog("workspace", "milestone snapshot failed"));
  }, [auPath, refreshKey, shouldShow, loadGuard]);

  /** 写路径（confirm/undo/接受等）完成后调用，重拉 milestone 数据。 */
  const refreshMilestones = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const dismissMilestone = useCallback(
    (id: string) => {
      dismiss(id);
      setSessionDismissed((prev) => ({ ...prev, [id]: true }));
    },
    [dismiss],
  );

  // 触发判据（原 milestoneElement IIFE 里的三段 if，此处只算「该显示哪个」，JSX 归 layout）。
  const pick = (id: ActiveMilestoneId, condition: boolean): boolean =>
    condition && shouldShow(id) && !sessionDismissed[id];
  let activeMilestone: ActiveMilestoneId | null = null;
  if (pick("facts_intro", currentChapter >= 4 && factsCount < 2)) {
    activeMilestone = "facts_intro";
  } else if (pick("pinned_intro", currentChapter >= 6 && pinnedCount === 0)) {
    activeMilestone = "pinned_intro";
  } else if (pick("focus_intro", Boolean(unresolvedFact) && chapterFocusEmpty)) {
    activeMilestone = "focus_intro";
  }

  return {
    /** 当前应展示的里程碑（null = 不展示）。 */
    activeMilestone,
    /** focus_intro 文案需要的未解决事实摘录。 */
    unresolvedFact,
    /** MobileLayout 的 currentChapter 契约沿用（消费端 MobileSettingsView 自行重解析，此值仅作回退）。 */
    currentChapter,
    refreshMilestones,
    dismissMilestone,
  };
}
