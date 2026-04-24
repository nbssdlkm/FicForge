// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { ChapterInfo } from "../../api/engine-client";
import { useTranslation } from "../../i18n/useAppTranslation";
import { ThemeToggle } from "../shared/ThemeToggle";
import { WriterLayout } from "../writer/WriterLayout";
import { BottomNavBar, type MobileWorkspaceTab } from "./BottomNavBar";
import { MobileChapterList } from "./MobileChapterList";
import { MobileManageView } from "./MobileManageView";
import { MobileSettingsView } from "./MobileSettingsView";

type WorkspacePage = "writer" | "facts" | "au_lore" | "settings";

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
  onChaptersChanged?: () => void;
  milestoneElement?: React.ReactNode;
}

function mapPageToTab(page: WorkspacePage): MobileWorkspaceTab {
  if (page === "au_lore") return "settings";
  if (page === "facts" || page === "settings") return "manage";
  return "writer";
}

function mapPageToManageSection(page: WorkspacePage): "facts" | "project" {
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
  milestoneElement,
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
          the Library (Index of Works). */}
      <header className="safe-area-top flex h-11 shrink-0 items-center justify-between border-b border-rule bg-surface/85 px-3 backdrop-blur">
        <button
          type="button"
          className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-accent"
          onClick={() => onNavigate("library")}
        >
          <ArrowLeft size={14} />
          <span>{t("library.title")}</span>
        </button>
        <span className="truncate px-2 font-display text-sm font-medium text-text/70">{auName}</span>
        <ThemeToggle />
      </header>

      <div className="flex-1 overflow-hidden pb-24">
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
            onChaptersChanged={onChaptersChanged}
          />
        ) : null}

        {activeTab === "writer" ? (
          <WriterLayout
            auPath={auPath}
            onNavigate={(page) => onNavigate(page, auPath)}
            viewChapter={selectedChapter}
            onClearViewChapter={onClearViewChapter}
            onChaptersChanged={onChaptersChanged}
          />
        ) : null}

        {activeTab === "settings" ? (
          <MobileSettingsView auPath={auPath} currentChapter={currentChapter} />
        ) : null}

        {activeTab === "manage" ? (
          <MobileManageView
            auPath={auPath}
            defaultSection={manageSection}
            onImportComplete={onChaptersChanged}
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
