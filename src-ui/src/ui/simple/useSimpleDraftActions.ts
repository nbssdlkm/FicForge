// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useSimpleDraftActions — 简对话面板的草稿动作（接受 / 丢弃）。
 *
 * 只持有 acceptingDraftId（接受在途重入闸）；接受落章后的宿主同步（refreshChapterContext /
 * onChaptersChanged）与 M9 自动提取（canAutoExtract gate + factsExtraction）经 value /
 * 语义化方法注入，本 hook 不碰它们的内部状态。「再生成」是 cancel + 重发 dispatch，归属
 * dispatch 编排 hook（避免与它形成双向依赖需要 bridge ref）。
 */

import { useCallback, useEffect, useState } from "react";
import {
  confirmChapter,
  draftFilename,
  getChapterContent,
  getState,
  logCatch,
  markSimpleChatDraftAccepted,
} from "../../api/engine-client";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";
import type { useSimpleChat } from "./useSimpleChat";
import type { useWriterFactsExtraction } from "../writer/useWriterFactsExtraction";

interface UseSimpleDraftActionsParams {
  auPath: string;
  chat: ReturnType<typeof useSimpleChat>;
  /** M9 自动提取 gate（config hook 派生，双 gate 同源 resolveFactsProvider）。 */
  canAutoExtract: boolean;
  factsExtraction: ReturnType<typeof useWriterFactsExtraction>;
  /** 接受落章后刷新章节上下文（chapterContext hook 的语义化方法）。 */
  refreshChapterContext: () => Promise<void>;
  /** 接受落章后通知宿主刷新章节列表（桌面侧栏 / 移动「章节」tab，审计 H1）。 */
  onChaptersChanged?: () => void;
  /** 丢弃 streaming 中草稿时中断在跑 dispatch（低层 dispatch 控制器的语义化方法）。 */
  cancelDispatch: () => void;
}

export function useSimpleDraftActions({
  auPath,
  chat,
  canAutoExtract,
  factsExtraction,
  refreshChapterContext,
  onChaptersChanged,
  cancelDispatch,
}: UseSimpleDraftActionsParams) {
  const { t } = useTranslation();
  const { showError, showSuccess, showToast } = useFeedback();

  const [acceptingDraftId, setAcceptingDraftId] = useState<string | null>(null);

  // 切 AU reset（铁律②：state 与 reset 同文件）
  useEffect(() => {
    setAcceptingDraftId(null);
  }, [auPath]);

  const handleAcceptDraft = useCallback(
    async (messageId: string) => {
      const target = chat.messages.find((m) => m.id === messageId);
      if (!target || target.kind !== "writing-draft") return;
      if (target.status !== "pending" && target.status !== "error") return;
      // 防重入（对抗审 A-1）：confirm 是数秒~数十秒的多 LLM 串行调用，期间内存状态
      // 未变，双击同一按钮或给同章的另一条 pending 草稿点接受都能二次进入 ——
      // 下面的章号 guard 是 TOCTOU（两次都读到旧 current_chapter），拦不住并发形态。
      if (acceptingDraftId) return;
      setAcceptingDraftId(messageId);
      const draftLabel = target.draftLabel && target.draftLabel !== "?" ? target.draftLabel : "A";
      const draftFileId = draftFilename(target.chapterNum, draftLabel);
      try {
        // 防重复接受（审计 H3）：接受只对「下一章」合法。三种到得了这里的非法状态 ——
        // 接受标记落盘失败后的残留 pending、连点、陈旧会话里的旧草稿 —— 都会覆写
        // 已确认章节 + 重复触发提取，必须在 confirm 之前拦下。
        const st = await getState(auPath);
        const expectedChapter = st.current_chapter ?? 1;
        if (target.chapterNum !== expectedChapter) {
          const existing = await getChapterContent(auPath, target.chapterNum).catch(() => null);
          if (existing !== null && existing.trim() === target.content.trim()) {
            // 章节内容与草稿逐字一致 → 此前已接受过、只是标记没落盘（切 tab 竞态遗留），
            // 补回标记而不是再确认一次。
            await markSimpleChatDraftAccepted(auPath, messageId, null).catch((e) =>
              logCatch("simple", "restore accepted marker failed", e),
            );
            chat.markDraftAccepted(messageId, null);
            showToast(
              t("simple.draftCard.alreadyAccepted", {
                defaultValue: "该草稿此前已接受为第 {{num}} 章，已恢复标记",
                num: target.chapterNum,
              }),
              "info",
            );
          } else {
            // 覆盖三种场景（对抗审 A-6，避免误导性断言）：章已被其他内容确认、
            // 草稿超前于当前进度（undo 后遗留）、章内容读取瞬时失败 —— 统一用
            // 「与当前进度不符」的中性表述，不声称「已确认过其他内容」。
            showToast(
              t("simple.draftCard.chapterTaken", {
                defaultValue: "第 {{num}} 章与当前写作进度不符（下一章应为第 {{expected}} 章），未执行接受",
                num: target.chapterNum,
                expected: expectedChapter,
              }),
              "warning",
            );
          }
          return;
        }

        // R1-8（终审鲜眼）：num === expected 但该章已有**不同**内容 —— undo/confirm 半成功
        // 残留、回收站恢复等会造成「进度指针在 N、ch{N} 文件却已存在」。直接 confirm 会静默
        // 覆盖那份内容（用户资产）。旧文案复用 chapterTaken 会产出「第 3 章与当前进度不符
        //（下一章应为第 3 章）」的自相矛盾句 —— 拆专用 key，指路写文页处理。
        // 内容逐字一致（同章重接、confirm 半成功后重试）→ 放行 confirm：引擎带备份覆盖 +
        // 推进 state，正是修复半成功所需。
        const existingCurrent = await getChapterContent(auPath, target.chapterNum).catch(() => null);
        if (existingCurrent !== null && existingCurrent.trim() !== target.content.trim()) {
          showToast(
            t("simple.draftCard.chapterTakenSameNum", {
              defaultValue: "第 {{num}} 章当前已有不同内容，未覆盖；如需替换请先在写文页处理该章",
              num: target.chapterNum,
            }),
            "warning",
          );
          return;
        }

        const result = await confirmChapter(
          auPath,
          target.chapterNum,
          draftFileId,
          target.generatedWith,
          target.content,
        );
        // 立即把 accepted 终态直写 chat.yaml（锁内 read-modify-write，不依赖组件存活）。
        // confirm 要串行跑多个 LLM 调用，期间用户完全可能已离开工作区 —— 只靠下面的
        // 内存标记 + 防抖保存，标记会静默丢失（审计 H3 根因）。
        await markSimpleChatDraftAccepted(auPath, messageId, result.revision).catch((e) =>
          logCatch("simple", "persist accepted marker failed", e),
        );
        chat.markDraftAccepted(messageId, result.revision);
        chat.appendChapterPreviewMessage(target.chapterNum);
        showSuccess(
          t("simple.draftCard.acceptedToast", {
            defaultValue: "已接受为第 {{num}} 章",
            num: target.chapterNum,
          }),
        );
        await refreshChapterContext();
        // 通知宿主刷新章节列表（桌面侧栏 / 移动「章节」tab），否则对话里接受的新章
        // 在另一个 tab 看不见（审计 H1）。
        onChaptersChanged?.();
        // M9：接受落章后自动跑事实提取（异步、不阻塞接受收尾）。gate 满足才弹 review；
        // 否则静默跳过（增强提取关 / LLM 未配）。extractFacts 内部再按 react_extraction_enabled
        // 决定 react vs plain，这里只 gate「是否自动触发」。目标章号由 hook 内部记录。
        if (canAutoExtract) {
          void factsExtraction.handleOpenExtractReview(target.chapterNum);
        }
      } catch (err) {
        chat.markDraftStatus(messageId, "error", {
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        showError(err, t("error_messages.unknown"));
      } finally {
        setAcceptingDraftId(null);
      }
    },
    [
      acceptingDraftId,
      auPath,
      canAutoExtract,
      chat,
      factsExtraction.handleOpenExtractReview,
      onChaptersChanged,
      refreshChapterContext,
      showError,
      showSuccess,
      showToast,
      t,
    ],
  );

  const handleAcceptDraftSync = useCallback(
    (messageId: string) => {
      void handleAcceptDraft(messageId);
    },
    [handleAcceptDraft],
  );

  const handleDiscardDraft = useCallback(
    (draftId: string) => {
      const target = chat.messages.find((m) => m.id === draftId);
      if (!target || target.kind !== "writing-draft") return;
      if (target.status === "streaming") {
        cancelDispatch();
      }
      chat.markDraftStatus(draftId, "discarded");
    },
    [chat, cancelDispatch],
  );

  return { acceptingDraftId, handleAcceptDraft, handleAcceptDraftSync, handleDiscardDraft };
}
