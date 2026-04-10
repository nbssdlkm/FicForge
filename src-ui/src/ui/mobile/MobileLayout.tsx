// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChapterInfo } from "../../api/engine-client";
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

  return (
    <div className="app-height relative flex flex-col overflow-hidden bg-background text-text md:hidden">
      <div className="flex-1 overflow-hidden pb-24">
        {activeTab === "chapters" ? (
          <MobileChapterList
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
            onOpenWriter={() => {
              onClearViewChapter();
              setActiveTab("writer");
              onNavigate("writer", auPath);
            }}
          />
        ) : null}
      </div>

      <BottomNavBar activeTab={activeTab} onTabChange={handleTabChange} />
    </div>
  );
}
