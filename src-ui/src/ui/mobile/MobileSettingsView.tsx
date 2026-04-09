// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useMemo, useState } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { AuLoreLayout } from "../library/AuLoreLayout";
import { Button } from "../shared/Button";
import { SettingsChatPanel } from "../shared/settings-chat/SettingsChatPanel";

function deriveFandomPath(auPath: string): string {
  return auPath.replace(/\/aus\/[^/]+$/, "");
}

interface MobileSettingsViewProps {
  auPath: string;
  currentChapter: number;
}

export function MobileSettingsView({ auPath, currentChapter }: MobileSettingsViewProps) {
  const { t } = useTranslation();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const fandomPath = useMemo(() => deriveFandomPath(auPath), [auPath]);

  return (
    <div className="relative min-h-full md:hidden">
      <AuLoreLayout key={`${auPath}:${refreshKey}`} auPath={auPath} />

      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-end px-4 md:hidden">
        <Button
          variant="primary"
          className="pointer-events-auto h-12 rounded-full px-5 shadow-strong"
          onClick={() => setOverlayOpen(true)}
        >
          <Sparkles size={16} className="mr-2" />
          AI 助手
        </Button>
      </div>

      {overlayOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-background md:hidden">
          <header className="safe-area-top flex items-center justify-between border-b border-black/10 bg-surface/95 px-4 py-3 backdrop-blur dark:border-white/10">
            <Button
              variant="ghost"
              size="sm"
              className="h-11 px-3"
              onClick={() => setOverlayOpen(false)}
            >
              <ArrowLeft size={16} className="mr-2" />
              返回
            </Button>
            <h2 className="text-base font-semibold text-text">{t("settingsMode.title")}</h2>
            <div className="w-[68px]" />
          </header>
          <div className="flex-1 overflow-hidden">
            <SettingsChatPanel
              mode="au"
              basePath={auPath}
              fandomPath={fandomPath}
              placeholder={t("settingsMode.placeholder")}
              currentChapter={currentChapter}
              className="h-full"
              onAfterMutation={async () => {
                setRefreshKey((current) => current + 1);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
