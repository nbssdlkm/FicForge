// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect, useRef, useCallback } from "react";
import { Spinner } from "../shared/Spinner";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { Sidebar } from "../shared/Sidebar";
import { Button } from "../shared/Button";
import { EmptyState } from "../shared/EmptyState";
import { MilestoneGuide } from "../shared/MilestoneGuide";
import { Modal } from "../shared/Modal";
import { LogOut, BookOpen } from "lucide-react";
import { WriterLayout } from "../writer/WriterLayout";
import { FactsLayout } from "../facts/FactsLayout";
import { ThreadsLayout } from "../threads/ThreadsLayout";
import { AuLoreLayout } from "../library/AuLoreLayout";
import { AuSettingsLayout } from "../settings/AuSettingsLayout";
import { SimpleChatPanel } from "../simple/SimpleChatPanel";
import { AnimatePresence, motion } from "framer-motion";
import { rebuildIndex } from "../../api/engine-client";
import { listChapters, updateChapterTitle, type ChapterInfo } from "../../api/engine-client";
import { getState, logCatch } from "../../api/engine-client";
import { getWorkspaceSnapshot } from "../../api/engine-client";
import { useTranslation } from "../../i18n/useAppTranslation";
import { FeedbackProvider, useFeedback } from "../../hooks/useFeedback";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { MobileLayout } from "../mobile/MobileLayout";
import { catchAndLog } from "../../utils/ui-logger";
import { useWorkspaceMilestones } from "./useWorkspaceMilestones";

type Props = {
  activeTab: string;
  auPath: string;
  onNavigate: (page: string, path?: string) => void;
};

function AuWorkspaceLayoutInner({ activeTab, auPath, onNavigate }: Props) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const loadGuard = useActiveRequestGuard(auPath);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(false);

  // 里程碑引导子域整体下沉 useWorkspaceMilestones（R3 低危清扫）：状态、数据拉取、
  // 触发判据都在 hook 内；layout 只负责按 activeMilestone 渲染 JSX 与接线导航动作。
  const milestones = useWorkspaceMilestones(auPath);
  const fallbackAuName = auPath.split("/").pop() || t("common.unknownAu");
  const [auName, setAuName] = useState(fallbackAuName);

  // 命名即约束（C7 硬化）：本函数**仅限写文面板自发变更**（confirm/undo，其内部状态已
  // 同步不需自通知）。写文之外的任何改章入口（对话接受/导入/标题编辑/未来新入口）必须用
  // 下方 refreshChaptersExternal —— 否则常驻挂载的 WriterLayout 收不到版本号、显示过期列表。
  const refreshChaptersWriterSelf = useCallback(() => {
    listChapters(auPath)
      .then((chs) => {
        if (!loadGuard.isKeyStale(auPath)) setChapters(chs);
      })
      .catch((err) => logCatch("workspace", "refreshChapters failed", err));
    milestones.refreshMilestones();
  }, [auPath, loadGuard, milestones.refreshMilestones]);
  // 写文面板常驻挂载（审计 M9）后，WriterLayout 不再靠重挂拿新数据。写文 tab 之外的
  // 章节变更（对话接受 / 标题编辑 / 导入完成）必须走这个带版本号的通道通知它重载；
  // 写文自己发起的 confirm/undo 仍走裸 refreshChapters（其内部状态已同步，不需自通知）。
  const [externalChaptersVersion, setExternalChaptersVersion] = useState(0);
  const refreshChaptersExternal = useCallback(() => {
    refreshChaptersWriterSelf();
    setExternalChaptersVersion((v) => v + 1);
  }, [refreshChaptersWriterSelf]);
  const [embeddingStale, setEmbeddingStale] = useState(false);
  const [embeddingDismissed, setEmbeddingDismissed] = useState(false);
  const [viewingChapter, setViewingChapter] = useState<number | null>(null);
  const [editingTitleNum, setEditingTitleNum] = useState<number | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const editingRef = useRef<{ num: number; original: string } | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingTitleInputRef = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    },
    [],
  );

  // 非 Modal 内联改名（双击章节行触发）——不用 autoFocus 属性（noAutofocus），
  // 改走 ref + effect 达到双击即聚焦同等行为。
  useEffect(() => {
    if (editingTitleNum !== null) editingTitleInputRef.current?.focus();
  }, [editingTitleNum]);

  useEffect(() => {
    if (!auPath) return;
    const token = loadGuard.start();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    setLoadingChapters(true);
    setChapters([]);
    setEmbeddingStale(false);
    setEmbeddingDismissed(false);
    setAuName(fallbackAuName);
    setViewingChapter(null);
    editingRef.current = null;
    setEditingTitleNum(null);
    setEditingTitleValue("");
    listChapters(auPath)
      .then((res) => {
        if (loadGuard.isStale(token)) return;
        setChapters(res);
      })
      .catch(catchAndLog("workspace", "listChapters failed"))
      .finally(() => {
        if (!loadGuard.isStale(token)) {
          setLoadingChapters(false);
        }
      });

    // Embedding check (sub-task 5): check index_status
    getState(auPath)
      .then((s) => {
        if (loadGuard.isStale(token)) return;
        if (s.index_status === "stale" || s.index_status === "interrupted") {
          setEmbeddingStale(true);
        }
      })
      .catch(catchAndLog("workspace", "embedding check getState failed"));

    getWorkspaceSnapshot(auPath)
      .then((snapshot) => {
        if (loadGuard.isStale(token)) return;
        setAuName(snapshot.au_name || fallbackAuName);
      })
      .catch(catchAndLog("workspace", "getWorkspaceSnapshot failed"));
  }, [auPath, fallbackAuName, loadGuard]);

  // 里程碑 banner 在 mobile early return 之前计算，供 MobileLayout 渲染。
  // 「显示哪个」由 useWorkspaceMilestones 派生；此处只做 JSX + 导航接线。
  const { activeMilestone, unresolvedFact, dismissMilestone } = milestones;
  const milestoneElement =
    activeTab === "writer"
      ? (() => {
          if (activeMilestone === "facts_intro") {
            return (
              <MilestoneGuide
                title={t("milestones.factsIntro.title")}
                description={t("milestones.factsIntro.desc")}
                primaryAction={{
                  label: t("milestones.factsIntro.extract"),
                  onClick: () => {
                    dismissMilestone("facts_intro");
                    onNavigate("facts", auPath);
                  },
                }}
                secondaryAction={{
                  label: t("milestones.factsIntro.later"),
                  onClick: () => dismissMilestone("facts_intro"),
                }}
                onDismiss={() => dismissMilestone("facts_intro")}
              />
            );
          }
          if (activeMilestone === "pinned_intro") {
            return (
              <MilestoneGuide
                title={t("milestones.pinnedIntro.title")}
                description={t("milestones.pinnedIntro.desc")}
                primaryAction={{
                  label: t("milestones.pinnedIntro.addPinned"),
                  onClick: () => {
                    dismissMilestone("pinned_intro");
                    onNavigate("settings", auPath);
                  },
                }}
                secondaryAction={{
                  label: t("milestones.pinnedIntro.notNeeded"),
                  onClick: () => dismissMilestone("pinned_intro"),
                }}
                onDismiss={() => dismissMilestone("pinned_intro")}
              />
            );
          }
          if (activeMilestone === "focus_intro") {
            return (
              <MilestoneGuide
                title={t("milestones.focusIntro.title", { content: unresolvedFact ?? "" })}
                description={t("milestones.focusIntro.desc")}
                primaryAction={{
                  label: t("milestones.focusIntro.setFocus"),
                  onClick: () => dismissMilestone("focus_intro"),
                }}
                secondaryAction={{
                  label: t("milestones.focusIntro.freeStyle"),
                  onClick: () => dismissMilestone("focus_intro"),
                }}
                onDismiss={() => dismissMilestone("focus_intro")}
              />
            );
          }
          return null;
        })()
      : null;

  if (isMobile) {
    return (
      <MobileLayout
        activePage={activeTab as "writer" | "chat" | "facts" | "threads" | "au_lore" | "settings"}
        auPath={auPath}
        auName={auName}
        chapters={chapters}
        loadingChapters={loadingChapters}
        currentChapter={milestones.currentChapter}
        selectedChapter={viewingChapter}
        onNavigate={onNavigate}
        onSelectChapter={setViewingChapter}
        onClearViewChapter={() => setViewingChapter(null)}
        onChaptersChanged={refreshChaptersWriterSelf}
        onChaptersChangedExternal={refreshChaptersExternal}
        externalChaptersVersion={externalChaptersVersion}
        milestoneElement={milestoneElement}
        embeddingStale={embeddingStale && !embeddingDismissed}
        onEmbeddingRebuild={() => {
          setEmbeddingDismissed(true);
          rebuildIndex(auPath).catch((e) => showError(e, t("error_messages.unknown")));
        }}
        onEmbeddingDismiss={() => setEmbeddingDismissed(true)}
      />
    );
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-background text-text font-sans transition-colors duration-200">
      <Sidebar
        position="left"
        width="260px"
        isCollapsed={leftCollapsed}
        onToggle={() => setLeftCollapsed(!leftCollapsed)}
        className="flex flex-col shrink-0 z-20 border-r border-rule"
      >
        {/* Brand seal + AU name header — mirrors the Library topbar so the two
            surfaces read as parts of the same catalog */}
        <div className="flex flex-col gap-1 border-b border-rule bg-surface px-4 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                aria-hidden="true"
                className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border-[1.5px] border-accent"
              >
                <span className="font-display italic text-base font-semibold leading-none text-accent">F</span>
                <span className="pointer-events-none absolute inset-[2.5px] rounded-[2px] border border-accent/50 opacity-60" />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="truncate font-display text-base font-semibold text-text" title={auName}>
                  {auName}
                </div>
                <div className="font-sans text-[10px] font-medium uppercase tracking-[0.18em] text-gold">
                  {t("navigation.workspace")}
                </div>
              </div>
            </div>
            <Button
              tone="neutral"
              fill="plain"
              size="sm"
              onClick={() => onNavigate("library")}
              className="h-8 w-8 shrink-0 rounded-full p-0 text-text/60 hover:text-text"
              title={t("common.actions.back")}
            >
              <LogOut size={16} />
            </Button>
          </div>
        </div>

        <div className="flex-1 flex flex-col pt-2 bg-surface/30 min-h-0">
          {/* 4 workspace tabs — gold left-bar marks the active one */}
          <div className="border-b border-rule px-2 pb-3 pt-1 shrink-0 space-y-0.5">
            {[
              { key: "chat" as const, label: t("simple.tabs.chat", { defaultValue: "对话" }) },
              { key: "writer" as const, label: t("writer.modeWrite") },
              { key: "facts" as const, label: t("navigation.facts") },
              { key: "threads" as const, label: t("navigation.threads") },
              { key: "au_lore" as const, label: t("navigation.auLore") },
              { key: "settings" as const, label: t("navigation.settings") },
            ].map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <div key={tab.key} className="relative">
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-0 top-1.5 bottom-1.5 z-10 w-[2px] rounded-r bg-gold"
                    />
                  )}
                  <Button
                    tone="neutral"
                    fill="plain"
                    size="sm"
                    onClick={() => onNavigate(tab.key, auPath)}
                    className={`w-full justify-start font-medium transition-colors ${
                      isActive
                        ? "bg-accent/10 text-accent hover:bg-accent/10 hover:text-accent"
                        : "text-text/75 hover:bg-rule-soft hover:text-text"
                    }`}
                  >
                    {tab.label}
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2 px-4 pb-2 shrink-0 font-sans text-[10px] font-medium uppercase tracking-[0.18em] text-ink-faint">
            <span className="text-gold">◆</span>
            {t("workspace.chaptersTitle")}
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
            {loadingChapters ? (
              <div className="flex items-center justify-center py-4 text-text/50">
                <Spinner size="md" />
              </div>
            ) : chapters.length === 0 ? (
              <EmptyState
                compact
                icon={<BookOpen size={28} />}
                title={t("emptyState.chapters.title")}
                description={t("emptyState.chapters.description")}
                actions={[
                  {
                    key: "start-writing",
                    element: (
                      <Button tone="accent" fill="solid" size="sm" onClick={() => onNavigate("writer", auPath)}>
                        {t("common.actions.startWriting")}
                      </Button>
                    ),
                  },
                ]}
              />
            ) : (
              chapters.map((ch) => {
                const isActive = activeTab === "writer" && viewingChapter === ch.chapter_num;
                const activateChapterRow = () => {
                  if (editingTitleNum === ch.chapter_num) return;
                  // Delay single click to distinguish from double click
                  if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
                  clickTimerRef.current = setTimeout(() => {
                    setViewingChapter(ch.chapter_num);
                    onNavigate("writer", auPath);
                  }, 250);
                };
                return (
                  <div key={ch.chapter_num} className="relative">
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-0 top-1.5 bottom-1.5 z-10 w-[2px] rounded-r bg-gold"
                      />
                    )}
                    {/* biome-ignore lint/a11y/useSemanticElements: 编辑态内含真 <input>（改标题），交互元素不可嵌交互元素，只能保留 div+role */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={activateChapterRow}
                      onKeyDown={(e) => {
                        // 只认自身获焦的按键（F3 对抗审 HIGH）：编辑态行内 <input> 的空格会冒泡到这里，
                        // 无条件 preventDefault 会吞掉标题里的空格输入。
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          activateChapterRow();
                        }
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (clickTimerRef.current) {
                          clearTimeout(clickTimerRef.current);
                          clickTimerRef.current = null;
                        }
                        editingRef.current = { num: ch.chapter_num, original: ch.title || "" };
                        setEditingTitleNum(ch.chapter_num);
                        setEditingTitleValue(ch.title || "");
                      }}
                      className={`cursor-pointer rounded-sm px-3 py-2 text-sm transition-colors ${
                        isActive ? "bg-accent/10 text-accent font-medium" : "text-text/85 hover:bg-rule-soft"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`shrink-0 font-mono text-[10px] tracking-[0.04em] ${isActive ? "text-gold" : "text-text/40"}`}
                        >
                          № {String(ch.chapter_num).padStart(2, "0")}
                        </span>
                        {editingTitleNum === ch.chapter_num ? (
                          <input
                            ref={editingTitleInputRef}
                            value={editingTitleValue}
                            onChange={(e) => setEditingTitleValue(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const ref = editingRef.current;
                                if (!ref) return;
                                const trimmed = editingTitleValue.trim();
                                try {
                                  await updateChapterTitle(auPath, ref.num, trimmed);
                                  // external：常驻挂载的写文面板标题（state.chapter_titles）要跟着刷（审计 M9）
                                  refreshChaptersExternal();
                                } catch (err) {
                                  showError(err, t("error_messages.unknown"));
                                  return;
                                }
                                editingRef.current = null;
                                setEditingTitleNum(null);
                              } else if (e.key === "Escape") {
                                editingRef.current = null;
                                setEditingTitleNum(null);
                              }
                            }}
                            onBlur={async () => {
                              const ref = editingRef.current;
                              if (!ref) {
                                setEditingTitleNum(null);
                                return;
                              }
                              const trimmed = editingTitleValue.trim();
                              if (trimmed !== ref.original) {
                                try {
                                  await updateChapterTitle(auPath, ref.num, trimmed);
                                  refreshChaptersExternal();
                                } catch (err) {
                                  showError(err, t("error_messages.unknown"));
                                }
                              }
                              editingRef.current = null;
                              setEditingTitleNum(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.stopPropagation()}
                            className="min-w-0 flex-1 border-b border-accent/50 bg-transparent px-0 py-0 text-sm outline-hidden"
                          />
                        ) : (
                          <span className="truncate">
                            {ch.title || t("workspace.chapterItem", { num: ch.chapter_num })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Sidebar>

      <div className="flex-1 flex flex-col overflow-hidden relative z-10 bg-background">
        {milestoneElement}
        {/* 对话面板常驻挂载、CSS 隐藏（审计 H2/H3）：接受→confirm→提取这条多秒异步链的
            状态全住在面板里，跟随 AnimatePresence 卸载会静默丢提取结果、丢接受标记。
            其余 tab 保持按需挂载 + 过渡动画不变。 */}
        <div className={activeTab === "chat" ? "flex-1 flex w-full h-full overflow-hidden" : "hidden"}>
          <SimpleChatPanel
            auPath={auPath}
            onChaptersChanged={refreshChaptersExternal}
            isActiveTab={activeTab === "chat"}
          />
        </div>
        {/* 写文面板同样常驻挂载、CSS 隐藏（审计 M9）：卸载会 abort 在飞的写文生成流
            （useWriterGeneration unmount cleanup）+ 丢草稿防抖保存，双 tab 并列后切
            tab 是高频动作，不能再当作「离开写作」处理。外部章节变更经
            externalChaptersVersion 通知其重载。facts/threads/au_lore/settings
            维持按需挂载 + 过渡动画不变。 */}
        <div className={activeTab === "writer" ? "flex-1 flex w-full h-full overflow-hidden" : "hidden"}>
          <WriterLayout
            auPath={auPath}
            onNavigate={onNavigate}
            viewChapter={viewingChapter}
            onClearViewChapter={() => setViewingChapter(null)}
            onChaptersChanged={refreshChaptersWriterSelf}
            isActiveTab={activeTab === "writer"}
            externalChaptersVersion={externalChaptersVersion}
          />
        </div>
        {/* 外层 hidden 门（对抗审 A-2）：切到常驻 tab（chat/writer）时旧 tab 的 exit
            动画（0.18s）仍占 flex-1，与常驻 div 双双平分高度造成半高闪跳 —— 立即
            display:none 掉整个动画容器（exit 在隐藏中无声完成），其余 tab 间的切换
            动画不受影响。 */}
        <div
          className={
            activeTab === "chat" || activeTab === "writer" ? "hidden" : "flex-1 flex w-full h-full overflow-hidden"
          }
        >
          <AnimatePresence mode="wait">
            {activeTab !== "chat" && activeTab !== "writer" && (
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 15, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -15, filter: "blur(4px)" }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex-1 flex w-full h-full overflow-hidden"
              >
                {activeTab === "facts" && <FactsLayout auPath={auPath} />}
                {activeTab === "threads" && <ThreadsLayout auPath={auPath} />}
                {activeTab === "au_lore" && (
                  <AuLoreLayout auPath={auPath} onChaptersChanged={refreshChaptersExternal} />
                )}
                {activeTab === "settings" && <AuSettingsLayout auPath={auPath} />}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Embedding stale modal (sub-task 5) */}
      <Modal
        isOpen={embeddingStale && !embeddingDismissed}
        onClose={() => setEmbeddingDismissed(true)}
        title={t("embedding.staleTitle")}
      >
        <div className="space-y-4">
          <p className="text-sm text-text/90">{t("embedding.staleDesc")}</p>
          <div className="flex justify-end gap-2">
            <Button tone="neutral" fill="plain" onClick={() => setEmbeddingDismissed(true)}>
              {t("embedding.skipRebuild")}
            </Button>
            <Button
              tone="accent"
              fill="solid"
              onClick={() => {
                setEmbeddingDismissed(true);
                rebuildIndex(auPath).catch((e) => showError(e, t("error_messages.unknown")));
              }}
            >
              {t("embedding.rebuild")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function AuWorkspaceLayout(props: Props) {
  return (
    <FeedbackProvider>
      <AuWorkspaceLayoutInner {...props} />
    </FeedbackProvider>
  );
}
