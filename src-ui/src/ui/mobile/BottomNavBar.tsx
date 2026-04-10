// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { BookOpenText, LibraryBig, PenSquare, SlidersHorizontal } from "lucide-react";
import { cn } from "../shared/utils";

export type MobileWorkspaceTab = "chapters" | "writer" | "settings" | "manage";

interface BottomNavBarProps {
  activeTab: MobileWorkspaceTab;
  onTabChange: (tab: MobileWorkspaceTab) => void;
}

const tabs = [
  { id: "chapters", label: "章节", Icon: BookOpenText },
  { id: "writer", label: "写作", Icon: PenSquare },
  { id: "settings", label: "设定", Icon: LibraryBig },
  { id: "manage", label: "管理", Icon: SlidersHorizontal },
] as const satisfies ReadonlyArray<{
  id: MobileWorkspaceTab;
  label: string;
  Icon: typeof BookOpenText;
}>;

export function BottomNavBar({ activeTab, onTabChange }: BottomNavBarProps) {
  return (
    <nav className="safe-area-bottom safe-area-x fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-surface/95 backdrop-blur md:hidden dark:border-white/10">
      <div className="grid grid-cols-4 gap-1 px-2 py-2">
        {tabs.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              className={cn(
                "flex min-h-[56px] flex-col items-center justify-center rounded-2xl px-2 py-2 text-xs font-medium transition-colors",
                active
                  ? "bg-accent text-white shadow-subtle"
                  : "text-text/55 hover:bg-black/5 hover:text-text dark:hover:bg-white/5"
              )}
            >
              <Icon size={18} className="mb-1" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
