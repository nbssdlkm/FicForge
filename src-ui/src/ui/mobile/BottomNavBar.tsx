// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { BookOpenText, LibraryBig, MessageSquare, PenSquare, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { cn } from "../shared/utils";

export type MobileWorkspaceTab = "chapters" | "writer" | "chat" | "settings" | "manage";

interface BottomNavBarProps {
  activeTab: MobileWorkspaceTab;
  onTabChange: (tab: MobileWorkspaceTab) => void;
}

const TAB_ICONS = {
  chapters: BookOpenText,
  writer: PenSquare,
  chat: MessageSquare,
  settings: LibraryBig,
  manage: SlidersHorizontal,
} as const;

// 融合后单一主力版：底栏恒为统一 5-tab 集合（对话 + 写文/阅读并列，共用同一记忆栈）。
const TAB_IDS: MobileWorkspaceTab[] = ["chapters", "writer", "chat", "settings", "manage"];

// Ex Libris bottom nav — parchment body with a gold hairline across the top
// and a 2px gold "cursor" that hangs down over the active tab icon
// (design-system-exlibris-v2.html §08 / library-mobile-exlibris-v13.html
// .tab-item.active::after). Active tab uses accent color, not filled bg —
// matches the sidebar treatment in AuWorkspaceLayout.
export function BottomNavBar({ activeTab, onTabChange }: BottomNavBarProps) {
  const { t } = useTranslation();

  const tabLabels: Record<MobileWorkspaceTab, string> = {
    chapters: t("navigation.chapters"),
    writer: t("navigation.mobileWriter"),
    chat: t("simple.tabs.chat", { defaultValue: "对话" }),
    settings: t("navigation.mobileSettings"),
    manage: t("navigation.manage"),
  };

  return (
    <nav className="safe-area-bottom safe-area-x fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-surface/95 backdrop-blur-sm md:hidden">
      <div className="grid grid-cols-5 gap-1 px-2 py-2">
        {TAB_IDS.map((id) => {
          const Icon = TAB_ICONS[id];
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              className={cn(
                "relative flex min-h-[56px] flex-col items-center justify-center rounded-sm px-2 py-2 font-sans text-[11px] font-medium tracking-[0.04em] transition-colors",
                active
                  ? "text-accent"
                  : "text-ink-faint hover:bg-rule-soft hover:text-text/70"
              )}
              aria-current={active ? "page" : undefined}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-0.5 left-1/2 h-[2px] w-6 -translate-x-1/2 bg-gold"
                />
              )}
              <Icon size={18} className="mb-1" />
              <span>{tabLabels[id]}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
