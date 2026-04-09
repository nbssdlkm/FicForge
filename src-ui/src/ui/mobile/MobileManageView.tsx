// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useState } from "react";
import { Download, Settings2, SlidersHorizontal, Trash2 } from "lucide-react";
import { FactsLayout } from "../facts/FactsLayout";
import { AuSettingsLayout } from "../settings/AuSettingsLayout";
import { Button } from "../shared/Button";
import { ExportModal } from "../writer/ExportModal";
import { GlobalSettingsModal } from "../settings/GlobalSettingsModal";
import { TrashPanel } from "../shared/TrashPanel";
import { cn } from "../shared/utils";

type ManageSection = "facts" | "project";

interface MobileManageViewProps {
  auPath: string;
  defaultSection?: ManageSection;
}

export function MobileManageView({
  auPath,
  defaultSection = "facts",
}: MobileManageViewProps) {
  const [section, setSection] = useState<ManageSection>(defaultSection);
  const [exportOpen, setExportOpen] = useState(false);
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);

  useEffect(() => {
    setSection(defaultSection);
  }, [defaultSection]);

  return (
    <section className="min-h-full bg-background md:hidden">
      <header className="safe-area-top border-b border-black/10 bg-surface/80 px-4 py-4 backdrop-blur dark:border-white/10">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-text/40">管理</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" className="h-11" onClick={() => setGlobalSettingsOpen(true)}>
            <Settings2 size={16} className="mr-2" />
            全局设置
          </Button>
          <Button variant="secondary" size="sm" className="h-11" onClick={() => setExportOpen(true)}>
            <Download size={16} className="mr-2" />
            导出
          </Button>
        </div>
        <div className="mt-4 inline-flex w-full rounded-2xl border border-black/10 bg-background/70 p-1 dark:border-white/10">
          {[
            { id: "facts", label: "Facts", Icon: SlidersHorizontal },
            { id: "project", label: "项目", Icon: Trash2 },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id as ManageSection)}
              className={cn(
                "flex min-h-[44px] flex-1 items-center justify-center rounded-xl text-sm font-medium transition-colors",
                section === id ? "bg-accent text-white" : "text-text/55"
              )}
            >
              <Icon size={15} className="mr-2" />
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-[calc(var(--app-height)-11rem)]">
        {section === "facts" ? (
          <FactsLayout auPath={auPath} />
        ) : (
          <div className="space-y-4">
            <AuSettingsLayout auPath={auPath} />
            <div className="px-4 pb-28">
              <div className="overflow-hidden rounded-2xl border border-black/10 bg-surface/35 dark:border-white/10">
                <TrashPanel scope="au" path={auPath} />
              </div>
            </div>
          </div>
        )}
      </div>

      <ExportModal isOpen={exportOpen} onClose={() => setExportOpen(false)} auPath={auPath} />
      <GlobalSettingsModal isOpen={globalSettingsOpen} onClose={() => setGlobalSettingsOpen(false)} />
    </section>
  );
}
