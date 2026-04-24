// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useState } from "react";
import { SlidersHorizontal, Trash2 } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { FactsLayout } from "../facts/FactsLayout";
import { AuSettingsLayout } from "../settings/AuSettingsLayout";
import { TrashPanel } from "../shared/TrashPanel";
import { cn } from "../shared/utils";

type ManageSection = "facts" | "project";

interface MobileManageViewProps {
  auPath: string;
  defaultSection?: ManageSection;
  onImportComplete?: () => void;
  onNavigateAfterImport?: (target: "writer" | "au_lore" | "facts") => void;
}

export function MobileManageView({
  auPath,
  defaultSection = "facts",
  onImportComplete: _onImportComplete,
  onNavigateAfterImport: _onNavigateAfterImport,
}: MobileManageViewProps) {
  const { t } = useTranslation();
  const [section, setSection] = useState<ManageSection>(defaultSection);
  useEffect(() => {
    setSection(defaultSection);
  }, [defaultSection]);

  return (
    <section className="flex h-full flex-col overflow-y-auto bg-background md:hidden">
      <header className="safe-area-top border-b border-rule bg-surface/85 px-4 py-4 backdrop-blur">
        <div className="mt-2 inline-flex w-full rounded-sm border border-rule bg-background/60 p-1">
          {[
            { id: "facts", label: t("facts.title"), Icon: SlidersHorizontal },
            { id: "project", label: t("workspace.projectSection"), Icon: Trash2 },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id as ManageSection)}
              className={cn(
                "flex min-h-[44px] flex-1 items-center justify-center rounded-[3px] text-sm font-medium transition-colors",
                section === id ? "bg-accent text-inv-text" : "text-text/55 hover:bg-rule-soft"
              )}
            >
              <Icon size={15} className="mr-2" />
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="mt-2 min-h-[calc(var(--app-height)-11rem)]">
        {section === "facts" ? (
          <FactsLayout auPath={auPath} />
        ) : (
          <div className="space-y-4">
            <AuSettingsLayout auPath={auPath} />
            <div className="px-4 pb-28">
              <div className="overflow-hidden rounded-sm border border-rule bg-surface">
                <TrashPanel scope="au" path={auPath} />
              </div>
            </div>
          </div>
        )}
      </div>

    </section>
  );
}
