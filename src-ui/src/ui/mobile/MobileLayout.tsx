// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { ChapterInfo } from "../../api/engine-client";
import { useTranslation } from "../../i18n/useAppTranslation";
import { ThemeToggle } from "../shared/ThemeToggle";
import { Button } from "../shared/Button";
import { InlineBanner } from "../shared/InlineBanner";
import { WriterLayout } from "../writer/WriterLayout";
import { BottomNavBar, type MobileWorkspaceTab } from "./BottomNavBar";
import { MobileChapterList } from "./MobileChapterList";
import { MobileManageView } from "./MobileManageView";
import { MobileSettingsView } from "./MobileSettingsView";
import { SimpleChatPanel } from "../simple/SimpleChatPanel";

type WorkspacePage = "writer" | "chat" | "facts" | "threads" | "au_lore" | "settings";

interface MobileLayoutProps {
  activePage: WorkspacePage;
  auPath: string;
  auName: string;
  chapters: ChapterInfo[];
  loadingChapters: boolean;
  currentChapter: number;
  selectedChapter: number | null;
  onNavigate: (page: string, path?: string) => void;
  onSelectChapter: (chapterNum: number) => void;
  onClearViewChapter: () => void;
  /** 写文 tab 自己发起的章节变更（confirm/undo）——只刷宿主章节列表。 */
  onChaptersChanged?: () => void;
  /** 写文 tab 之外的章节变更（对话接受 / 标题编辑 / 导入）——刷宿主列表并 bump
   * externalChaptersVersion 通知常驻挂载的 WriterLayout 重载（审计 M9）。 */
  onChaptersChangedExternal?: () => void;
  externalChaptersVersion?: number;
  milestoneElement?: React.ReactNode;
  /** embedding 索引过期（审计 M10）：桌面用 Modal，移动端用顶部 banner 对等呈现。
   * 宿主已合并 dismissed 状态，true 即应展示。 */
  embeddingStale?: boolean;
  onEmbeddingRebuild?: () => void;
  onEmbeddingDismiss?: () => void;
}

function mapPageToTab(page: WorkspacePage): MobileWorkspaceTab {
  if (page === "chat") return "chat";
  if (page === "au_lore") return "settings";
  // facts / threads / 故事设置 都落到「管理」tab，内部再用段控切 section
  if (page === "facts" || page === "threads" || page === "settings") return "manage";
  return "writer";
}

function mapPageToManageSection(page: WorkspacePage): "facts" | "threads" | "project" {
  if (page === "threads") return "threads";
  return page === "settings" ? "project" : "facts";
}

export function MobileLayout({
  activePage,
  auPath,
  auName,
  chapters,
  loadingChapters,
  currentChapter,
  selectedChapter,
  onNavigate,
  onSelectChapter,
  onClearViewChapter,
  onChaptersChanged,
  onChaptersChangedExternal,
  externalChaptersVersion,
  milestoneElement,
  embeddingStale,
  onEmbeddingRebuild,
  onEmbeddingDismiss,
}: MobileLayoutProps) {
  const [activeTab, setActiveTab] = useState<MobileWorkspaceTab>(() => mapPageToTab(activePage));
  const previousPageRef = useRef<WorkspacePage>(activePage);

  useEffect(() => {
    if (previousPageRef.current !== activePage) {
      setActiveTab(mapPageToTab(activePage));
      previousPageRef.current = activePage;
    }
  }, [activePage]);

  const manageSection = useMemo(() => mapPageToManageSection(activePage), [activePage]);

  const handleTabChange = (nextTab: MobileWorkspaceTab) => {
    setActiveTab(nextTab);

    if (nextTab === "chapters") {
      return;
    }

    if (nextTab === "chat") {
      onNavigate("chat", auPath);
      return;
    }

    if (nextTab === "settings") {
      onNavigate("au_lore", auPath);
      return;
    }

    if (nextTab === "manage") {
      onNavigate("facts", auPath);
      return;
    }

    onClearViewChapter();
    onNavigate("writer", auPath);
  };

  const { t } = useTranslation();

  return (
    <div className="app-height relative flex flex-col overflow-hidden bg-background text-text md:hidden">
      {/* Global mobile header — hairline rule + parchment backdrop. AU name
          sits in the middle as the "now-reading" badge; back button returns to
          the Library (Index of Works).
          几何（审计 M12）：safe-area-top 是 padding-top:env(safe-area-inset-top)，
          border-box 下固定 h-11 会被这份 padding 吃掉内容高度（刘海机 inset 44-59px
          > 44px → 内容被压成 0）。改为 min-height = 44px 内容 + inset，让 header
          随 inset 自然长高。 */}
      <header className="safe-area-top flex min-h-[calc(2.75rem+var(--safe-area-top))] shrink-0 items-center justify-between border-b border-rule bg-surface/85 px-3 backdrop-blur">
        <button
          type="button"
          className="flex items-center gap-1 font-sans text-[11px] font-medium tracking-[0.04em] text-accent"
          onClick={() => onNavigate("library")}
        >
          <ArrowLeft size={14} />
          <span>{t("library.title")}</span>
        </button>
        <span className="truncate px-2 font-display text-sm font-medium text-text/70">{auName}</span>
        <ThemeToggle />
      </header>

      {/* embedding stale 提醒（审计 M10）：桌面在 early-return 之后弹 Modal，移动端
          此前完全不可达 → RAG 静默降级无人知晓。这里用顶部 banner 对等呈现，复用
          桌面同一组 i18n key 与「重建/忽略」动作。 */}
      {embeddingStale ? (
        <InlineBanner
          tone="warning"
          layout="bar"
          compact
          message={`${t("embedding.staleTitle")} · ${t("embedding.staleDesc")}`}
          actions={
            <>
              <Button tone="neutral" fill="plain" size="sm" className="h-9 text-xs" onClick={onEmbeddingDismiss}>
                {t("embedding.skipRebuild")}
              </Button>
              <Button tone="accent" fill="solid" size="sm" className="h-9 text-xs" onClick={onEmbeddingRebuild}>
                {t("embedding.rebuild")}
              </Button>
            </>
          }
        />
      ) : null}

      {/* 内容区底部让位（审计 M12）：BottomNavBar 实高 = min-h-56px 内容 + py-2×2
          + border-t 1px + safe-area-bottom inset ≈ 73px + inset（iOS 全面屏 inset
          34px → ~107px）。旧 pb-24（96px）在 iOS 少了 ~11px，输入框底部被遮。
          改用 calc 精确让位：73px + inset。 */}
      <div className="flex-1 overflow-hidden pb-[calc(4.5625rem+var(--safe-area-bottom))]">
        {activeTab === "writer" && milestoneElement}
        {activeTab === "chapters" ? (
          <MobileChapterList
            auPath={auPath}
            auName={auName}
            chapters={chapters}
            loading={loadingChapters}
            selectedChapter={selectedChapter}
            onSelectChapter={(chapterNum) => {
              onSelectChapter(chapterNum);
              setActiveTab("writer");
              onNavigate("writer", auPath);
            }}
            onStartWriting={() => {
              onClearViewChapter();
              setActiveTab("writer");
              onNavigate("writer", auPath);
            }}
            onChaptersChanged={onChaptersChangedExternal ?? onChaptersChanged}
          />
        ) : null}

        {/* 对话面板常驻挂载、CSS 隐藏（审计 H2/H3）：5-tab 底栏让切 tab 成为高频动作，
            卸载会杀掉在飞的对话生成、丢提取结果、丢接受标记。hidden 时不占布局。 */}
        <div className={activeTab === "chat" ? "h-full" : "hidden"}>
          <SimpleChatPanel
            auPath={auPath}
            onChaptersChanged={onChaptersChangedExternal ?? onChaptersChanged}
            isActiveTab={activeTab === "chat"}
          />
        </div>

        {/* 写文面板同样常驻挂载、CSS 隐藏（审计 M9）：条件渲染卸载会 abort 在飞的
            写文生成流（useWriterGeneration unmount cleanup）且无 toast 无部分落地。
            外部章节变更（对话接受等）经 externalChaptersVersion 通知其重载。
            chapters/settings/manage 维持按需挂载不变。 */}
        <div className={activeTab === "writer" ? "h-full" : "hidden"}>
          <WriterLayout
            auPath={auPath}
            onNavigate={(page) => onNavigate(page, auPath)}
            viewChapter={selectedChapter}
            onClearViewChapter={onClearViewChapter}
            onChaptersChanged={onChaptersChanged}
            isActiveTab={activeTab === "writer"}
            externalChaptersVersion={externalChaptersVersion}
          />
        </div>

        {activeTab === "settings" ? (
          <MobileSettingsView auPath={auPath} currentChapter={currentChapter} />
        ) : null}

        {activeTab === "manage" ? (
          <MobileManageView
            auPath={auPath}
            defaultSection={manageSection}
            onImportComplete={onChaptersChangedExternal ?? onChaptersChanged}
            onNavigateAfterImport={(target) => {
              onClearViewChapter();
              setActiveTab("writer");
              onNavigate(target, auPath);
            }}
          />
        ) : null}
      </div>

      <BottomNavBar activeTab={activeTab} onTabChange={handleTabChange} />
    </div>
  );
}
