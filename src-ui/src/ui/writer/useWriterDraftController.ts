// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { BudgetReport } from "@ficforge/engine";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  draftFilename,
  getDraft,
  listDrafts,
  saveDraft,
  type ContextSummary,
  type DraftDetail,
  type DraftGeneratedWith,
  type StateInfo,
} from "../../api/engine-client";
import { readSavedContextSummaries, saveContextSummaries } from "../../utils/writerStorage";

export type DraftItem = {
  label: string;
  draftId: string;
  content: string;
  generatedWith?: DraftGeneratedWith | null;
  modified: boolean;
};

function buildDraftId(chapterNum: number, label: string): string {
  return draftFilename(chapterNum, label);
}

export function createDraftItem(
  chapterNum: number,
  label: string,
  content: string,
  generatedWith?: DraftGeneratedWith | null,
): DraftItem {
  return {
    label,
    draftId: buildDraftId(chapterNum, label),
    content,
    generatedWith: generatedWith || null,
    modified: false,
  };
}

function createDraftItemFromDetail(chapterNum: number, detail: DraftDetail): DraftItem {
  return createDraftItem(chapterNum, detail.variant, detail.content, detail.generated_with || null);
}

function sortDrafts(drafts: DraftItem[]): DraftItem[] {
  return [...drafts].sort((left, right) => left.label.localeCompare(right.label));
}

type PendingDraftSave = {
  auPath: string;
  chapterNum: number;
  label: string;
  content: string;
};

type UseWriterDraftControllerOptions = {
  auPath: string;
  state: StateInfo | null; // Phase 5c: 接管 draft 加载，自主 watch state.current_chapter
  onDraftSaveError?: (error: unknown) => void;
};

/** 流式缓冲超此字节数强制同步 flush，绕过 rAF——与 useSimpleChat 的
 * BUFFER_FLUSH_THRESHOLD 同款兜底：tab 切后台时 rAF 被 throttle（低端设备后台
 * 1fps），buffer 无限增长会积压整章内存。 */
const STREAM_FLUSH_THRESHOLD = 50_000;

export function useWriterDraftController({ auPath, state, onDraftSaveError }: UseWriterDraftControllerOptions) {
  const currentChapterNum = state?.current_chapter ?? 0;
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [activeDraftIndex, setActiveDraftIndex] = useState(0);
  const [streamText, setStreamText] = useState("");
  const [generatedWith, setGeneratedWith] = useState<DraftGeneratedWith | null>(null);
  const [budgetReport, setBudgetReport] = useState<BudgetReport | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState(false);
  const [draftSummaries, setDraftSummaries] = useState<Record<string, ContextSummary>>({});
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftSaveRef = useRef<PendingDraftSave | null>(null);
  const pendingContextSummaryRef = useRef<ContextSummary | null>(null);
  const draftSaveErrorShownRef = useRef(false);
  const onDraftSaveErrorRef = useRef(onDraftSaveError);
  onDraftSaveErrorRef.current = onDraftSaveError;

  const persistDraft = useCallback(async (pending: PendingDraftSave) => {
    try {
      await saveDraft(pending.auPath, pending.chapterNum, pending.label, pending.content);
      draftSaveErrorShownRef.current = false;
    } catch (error) {
      if (!draftSaveErrorShownRef.current) {
        draftSaveErrorShownRef.current = true;
        onDraftSaveErrorRef.current?.(error);
      }
    }
  }, []);

  const flushPendingDraftSave = useCallback(
    (discard = false) => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }

      const pending = pendingDraftSaveRef.current;
      if (pending && !discard) {
        void persistDraft(pending);
      }

      pendingDraftSaveRef.current = null;
    },
    [persistDraft],
  );

  // 流式渲染 rAF 缓冲（审计 M11）：原版每 chunk 一次 setStreamText → ChapterContentArea
  // 每 token 全量重渲染累积全文，低端 Android 真机流式 3000 字肉眼卡顿——与简版
  // useSimpleChat 已修掉的模式同源。chunks 先积到 ref buffer，rAF 回调时一次
  // setState 批量应用；终态前调 flushStream 保证 buffer 落地。
  const pendingStreamRef = useRef("");
  const streamRafRef = useRef<number | null>(null);

  const flushStreamBuffer = useCallback(() => {
    streamRafRef.current = null;
    const pending = pendingStreamRef.current;
    if (!pending) return;
    pendingStreamRef.current = "";
    setStreamText((current) => current + pending);
  }, []);

  const appendStream = useCallback(
    (text: string) => {
      pendingStreamRef.current += text;
      if (pendingStreamRef.current.length > STREAM_FLUSH_THRESHOLD) {
        if (streamRafRef.current !== null) {
          cancelAnimationFrame(streamRafRef.current);
        }
        flushStreamBuffer();
        return;
      }
      if (streamRafRef.current === null) {
        streamRafRef.current = requestAnimationFrame(flushStreamBuffer);
      }
    },
    [flushStreamBuffer],
  );

  /** 强制立即把缓冲 chunks 应用到 streamText。生成终态（done / error-partial）前
   * 必须调用一次，否则 rAF 未跑的尾部 chunks 会在流式视图上短暂缺失。 */
  const flushStream = useCallback(() => {
    if (streamRafRef.current !== null) {
      cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    }
    flushStreamBuffer();
  }, [flushStreamBuffer]);

  const resetStream = useCallback(() => {
    // 丢弃未 flush 的缓冲：reset 语义是「这轮流式显示作废」，缓冲残余不该泄漏到下一轮
    pendingStreamRef.current = "";
    if (streamRafRef.current !== null) {
      cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    }
    setStreamText("");
  }, []);

  // AU 切换 / unmount：取消挂着的 rAF 并清空缓冲，防旧 AU 的 chunks 错位灌进新 AU
  useEffect(() => {
    return () => {
      pendingStreamRef.current = "";
      if (streamRafRef.current !== null) {
        cancelAnimationFrame(streamRafRef.current);
        streamRafRef.current = null;
      }
    };
  }, [auPath]);

  const markGeneratedWith = useCallback((value: DraftGeneratedWith | null) => {
    setGeneratedWith(value);
  }, []);

  const markBudgetReport = useCallback((report: BudgetReport | null) => {
    setBudgetReport(report);
  }, []);

  const markRecoveryNotice = useCallback((show: boolean) => {
    setRecoveryNotice(show);
  }, []);

  const attachPendingContextSummary = useCallback((summary: ContextSummary | null) => {
    pendingContextSummaryRef.current = summary;
  }, []);

  const getPendingContextSummary = useCallback(() => pendingContextSummaryRef.current, []);

  const selectDraft = useCallback(
    (index: number) => {
      if (drafts.length === 0) {
        setActiveDraftIndex(0);
        return;
      }
      setActiveDraftIndex(Math.max(0, Math.min(drafts.length - 1, index)));
    },
    [drafts.length],
  );

  const clearDraftState = useCallback(
    (discard = false) => {
      setDrafts([]);
      setActiveDraftIndex(0);
      resetStream();
      markGeneratedWith(null);
      markBudgetReport(null);
      markRecoveryNotice(false);
      setDraftSummaries({});
      pendingContextSummaryRef.current = null;
      flushPendingDraftSave(discard);
    },
    [flushPendingDraftSave, markBudgetReport, markGeneratedWith, markRecoveryNotice, resetStream],
  );

  const replaceDraftSummaries = useCallback(
    (chapterNum: number, summaries: Record<string, ContextSummary>) => {
      setDraftSummaries(summaries);
      saveContextSummaries(auPath, chapterNum, summaries);
    },
    [auPath, setDraftSummaries],
  );

  const attachDraftSummary = useCallback(
    (chapterNum: number, label: string, summary: ContextSummary) => {
      setDraftSummaries((current) => {
        const next = {
          ...current,
          [label]: summary,
        };
        saveContextSummaries(auPath, chapterNum, next);
        return next;
      });
    },
    [auPath, setDraftSummaries],
  );

  const mergeDraftIntoState = useCallback(
    (draft: DraftItem) => {
      setDrafts((current) => {
        const merged = sortDrafts([...current.filter((item) => item.label !== draft.label), draft]);
        const nextIndex = merged.findIndex((item) => item.label === draft.label);
        setActiveDraftIndex(nextIndex >= 0 ? nextIndex : Math.max(merged.length - 1, 0));
        return merged;
      });
    },
    [setActiveDraftIndex, setDrafts],
  );

  const loadDraftByLabel = useCallback(
    async (
      chapterNum: number,
      label: string,
      fallbackContent = "",
      fallbackGeneratedWith?: DraftGeneratedWith | null,
    ): Promise<DraftItem> => {
      try {
        const detail = await getDraft(auPath, chapterNum, label);
        // 草稿缺失（get 契约返回 null）与读取失败同走 fallback（占位草稿）
        if (detail) return createDraftItemFromDetail(chapterNum, detail);
      } catch {
        // 读取失败 → fallback
      }
      return createDraftItem(chapterNum, label, fallbackContent, fallbackGeneratedWith || null);
    },
    [auPath],
  );

  // Phase 6.3: 删掉 loadDraftsForChapter 对外导出。Phase 5c 后所有 draft 加载
  // 由内部 state-watch useEffect 驱动，该方法无外部消费者。

  const handleCurrentDraftChange = useCallback(
    (content: string) => {
      setDrafts((current) =>
        current.map((draft, index) =>
          index === activeDraftIndex
            ? {
                ...draft,
                content,
                modified: true,
              }
            : draft,
        ),
      );

      const label = drafts[activeDraftIndex]?.label;
      if (!label) return;

      const chapterNum = currentChapterNum || 1;
      pendingDraftSaveRef.current = { auPath, chapterNum, label, content };
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
      }
      draftSaveTimerRef.current = setTimeout(() => {
        void persistDraft({ auPath, chapterNum, label, content });
        pendingDraftSaveRef.current = null;
        draftSaveTimerRef.current = null;
      }, 1500);
    },
    [activeDraftIndex, auPath, currentChapterNum, drafts, persistDraft, setDrafts],
  );

  // Phase 5c: 消除 draftControllerBridgeRef。draftCtrl 自主 watch state，
  // 当 state 为 null（切 AU 或重置）→ 清空；当 state.current_chapter 变化 → 加载该章节 drafts + summaries。
  // 原来这段编排在 bootstrap.loadData 里通过 bridge 反注入 draftCtrl 的 setters。
  useEffect(() => {
    // 切 AU 或 state 为 null（bootstrap 正在 reset）→ 清空所有 draft 状态
    if (!state) {
      setDrafts([]);
      setActiveDraftIndex(0);
      resetStream();
      setGeneratedWith(null);
      setBudgetReport(null);
      setRecoveryNotice(false);
      setDraftSummaries({});
      pendingContextSummaryRef.current = null;
      flushPendingDraftSave(true);
      return;
    }

    // Phase 6.1: 首帧 stale-state guard。
    // auPath 变化后，bootstrap 的 reset useEffect 在此 effect 之后执行；本 effect 在同帧拿到的
    // state 可能还是旧 AU 的。通过 state.au_id 与 auPath 的尾部匹配检测：不匹配就 skip 这次 load，
    // 等 bootstrap reset 把 state 置 null → 下一轮 effect 清空 → 新 state 到位后才 load。
    if (state.au_id && !auPath.endsWith(state.au_id)) {
      return;
    }

    // state 可用 → 加载当前章节的 drafts + summaries
    const chapterNum = state.current_chapter;
    let cancelled = false;
    (async () => {
      try {
        const list = await listDrafts(auPath, chapterNum);
        if (cancelled) return;
        const details = await Promise.all(list.map((draft) => getDraft(auPath, chapterNum, draft.draft_label)));
        if (cancelled) return;

        const loadedDrafts = sortDrafts(
          details
            // list 与 get 之间被并发删除（confirm/discard）的窄窗 → null，跳过
            .filter((detail): detail is NonNullable<typeof detail> => detail !== null)
            .map((detail) => createDraftItemFromDetail(chapterNum, detail)),
        );
        const storedSummaries = readSavedContextSummaries(auPath, chapterNum);
        const activeLabels = new Set(loadedDrafts.map((draft) => draft.label));
        const filteredSummaries = Object.entries(storedSummaries).reduce<Record<string, ContextSummary>>(
          (accumulator, [label, summary]) => {
            if (activeLabels.has(label)) {
              accumulator[label] = summary;
            }
            return accumulator;
          },
          {},
        );

        // 重置然后 populate（顺序：先清、再设）
        resetStream();
        setGeneratedWith(null);
        setBudgetReport(null);
        pendingContextSummaryRef.current = null;
        setDrafts(loadedDrafts);
        setActiveDraftIndex(loadedDrafts.length > 0 ? loadedDrafts.length - 1 : 0);
        setRecoveryNotice(loadedDrafts.length > 0);
        setDraftSummaries(filteredSummaries);
        saveContextSummaries(auPath, chapterNum, filteredSummaries);
        flushPendingDraftSave(true);
      } catch {
        // listDrafts / getDraft 失败时静默 —— drafts 保持空
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auPath, state?.current_chapter, flushPendingDraftSave, resetStream]);

  useEffect(() => () => flushPendingDraftSave(), [flushPendingDraftSave]);

  // pagehide flush（R1-6）：关标签页 / PWA 进后台被回收 / SW 更新强刷时 unmount cleanup
  // 不保证执行，1.5s 防抖窗口内的草稿手改会静默丢。与离场 flush 同一逻辑：
  // flushPendingDraftSave 只在 pendingDraftSaveRef 有未落盘内容时才写。
  useEffect(() => {
    const flushOnPageHide = () => flushPendingDraftSave();
    window.addEventListener("pagehide", flushOnPageHide);
    return () => window.removeEventListener("pagehide", flushOnPageHide);
  }, [flushPendingDraftSave]);

  return {
    drafts,
    activeDraftIndex,
    streamText,
    generatedWith,
    budgetReport,
    recoveryNotice,
    draftSummaries,
    appendStream,
    flushStream,
    resetStream,
    markGeneratedWith,
    markBudgetReport,
    markRecoveryNotice,
    attachPendingContextSummary,
    getPendingContextSummary,
    selectDraft,
    clearDraftState,
    replaceDraftSummaries,
    attachDraftSummary,
    mergeDraftIntoState,
    loadDraftByLabel,
    handleCurrentDraftChange,
  };
}
