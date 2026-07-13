// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import {
  getState,
  getWriterProjectContext,
  getWriterSessionConfig,
  type WriterProjectContext,
  type WriterSessionConfig,
} from "../../api/engine-client";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { useFeedback } from "../../hooks/useFeedback";
import { AuLoreLayout } from "../library/AuLoreLayout";
import { Button } from "../shared/Button";
import { SettingsChatPanel } from "../shared/settings-chat/SettingsChatPanel";
import { useSessionParams } from "../writer/useSessionParams";
import { swallowToNull } from "../../utils/ui-logger";
import { deriveFandomPath } from "../library/lore-utils";

interface MobileSettingsViewProps {
  auPath: string;
  currentChapter: number;
}

export function MobileSettingsView({ auPath, currentChapter }: MobileSettingsViewProps) {
  const { t } = useTranslation();
  const { showSuccess, showError, showToast } = useFeedback();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [resolvedCurrentChapter, setResolvedCurrentChapter] = useState(currentChapter);
  // 会话 LLM 透传（审计 M14）：桌面 WriterLayout 给 SettingsChatPanel 传
  // sessionLlm/disabled/onBusyChange，移动端此前全缺 → 用户在会话里选的模型对
  // 移动设定助手不生效。这里按桌面同款数据源（project context + session config →
  // useSessionParams）补齐。
  const [projectInfo, setProjectInfo] = useState<WriterProjectContext | null>(null);
  const [settingsInfo, setSettingsInfo] = useState<WriterSessionConfig | null>(null);
  const [contextReady, setContextReady] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const loadGuard = useActiveRequestGuard(auPath);
  // 独立 guard：guard.start() 是共享单调 id，与 getState 效果共用会互相打 stale
  const contextGuard = useActiveRequestGuard(auPath);
  const fandomPath = useMemo(() => deriveFandomPath(auPath), [auPath]);
  const sessionParams = useSessionParams(auPath, projectInfo, settingsInfo, showSuccess, showError);

  useEffect(() => {
    setResolvedCurrentChapter(currentChapter);
  }, [currentChapter]);

  useEffect(() => {
    setProjectInfo(null);
    setSettingsInfo(null);
    setContextReady(false);
    setAssistantBusy(false);
    const token = contextGuard.start();
    Promise.all([
      getWriterProjectContext(auPath).catch(swallowToNull("MobileSettingsView", "load project context failed")),
      getWriterSessionConfig().catch(swallowToNull("MobileSettingsView", "load session config failed")),
    ]).then(([proj, settings]) => {
      if (contextGuard.isStale(token)) return;
      setProjectInfo(proj);
      setSettingsInfo(settings);
      // 加载失败也置 ready（null 时 useSessionParams 用默认值），不永久锁死面板
      setContextReady(true);
    });
  }, [auPath, contextGuard]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: overlayOpen 是有意的重取触发键（overlay 打开时重拉当前章号），biome 判其多余不可删；loadGuard 为 useActiveRequestGuard 稳定引用（useMemo([])），省略不影响；auPath/currentChapter 为真实依赖
  useEffect(() => {
    const token = loadGuard.start();
    getState(auPath)
      .then((state) => {
        if (loadGuard.isStale(token)) return;
        setResolvedCurrentChapter(state?.current_chapter || 1);
      })
      .catch(() => {
        if (loadGuard.isStale(token)) return;
        setResolvedCurrentChapter(currentChapter || 1);
      });
  }, [auPath, currentChapter, overlayOpen]);

  const handleCloseOverlay = () => {
    // busy 关闭拦截：overlay 关闭即卸载 SettingsChatPanel，会杀掉执行中的设定操作
    // （桌面等价物是 useWriterModeController 的 busy 切回拦截）。
    if (assistantBusy) {
      showToast(t("settingsMode.busyCloseBlocked"), "warning");
      return;
    }
    setOverlayOpen(false);
  };

  return (
    <div className="relative h-full overflow-y-auto md:hidden">
      <AuLoreLayout key={`${auPath}:${refreshKey}`} auPath={auPath} />

      {/* FAB 底部偏移（审计 M12）：旧 bottom-24（96px）按 pb-24 时代的让位估的，
          iOS 全面屏下 BottomNavBar 实高 ≈ 73px + safe-area inset（34px）= 107px，
          FAB 会被 nav 盖住一截。改为 nav 实高 + 12px 间距的 calc 精确锚定。 */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.3125rem+var(--safe-area-bottom))] z-30 flex justify-end px-4 md:hidden">
        <Button
          tone="accent"
          fill="solid"
          className="pointer-events-auto h-12 rounded-full px-5 shadow-strong"
          onClick={() => setOverlayOpen(true)}
        >
          <Sparkles size={16} className="mr-2" />
          {t("settingsMode.title")}
        </Button>
      </div>

      {overlayOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-background md:hidden">
          <header className="safe-area-top flex items-center justify-between border-b border-rule bg-surface/95 px-4 py-3 backdrop-blur-sm">
            <Button tone="neutral" fill="plain" size="sm" className="h-11 px-3" onClick={handleCloseOverlay}>
              <ArrowLeft size={16} className="mr-2" />
              {t("common.actions.back")}
            </Button>
            <h2 className="font-display text-base font-semibold text-text">{t("settingsMode.title")}</h2>
            <div className="w-[68px]" />
          </header>
          <div className="flex-1 overflow-hidden">
            <SettingsChatPanel
              mode="au"
              basePath={auPath}
              fandomPath={fandomPath}
              placeholder={t("settingsMode.placeholder")}
              currentChapter={resolvedCurrentChapter}
              sessionLlm={sessionParams.sessionLlmPayload}
              disabled={!contextReady}
              onBusyChange={setAssistantBusy}
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
