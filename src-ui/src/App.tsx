// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect, useRef, useCallback } from "react";
import { Library } from "./ui/Library";
import { FandomLoreLayout } from "./ui/library/FandomLoreLayout";
import { MobileFandomView } from "./ui/mobile/MobileFandomView";
import { SplashScreen } from "./ui/SplashScreen";
import { AuWorkspaceLayout } from "./ui/workspace/AuWorkspaceLayout";
import { initEngine, getEngine, initLogger, getLogger, migrateLegacySecureStorage } from "./api/engine-client";
import { hydrateFontsOnStartup } from "./api/engine-fonts";
import { useTranslation } from "./i18n/useAppTranslation";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { isTauri as detectTauri, isCapacitor as detectCapacitor } from "./utils/platform";
import { SW_UPDATE_READY_EVENT, type SwUpdateReadyDetail } from "./utils/swUpdate";
import { logUiError } from "./utils/ui-logger";

/** 获取或创建持久化设备 ID（同步，用于 adapter 构造前）。 */
function getOrCreateDeviceId(): string {
  const key = "ficforge_device_id";
  try {
    const stored = localStorage.getItem(key);
    if (stored) return stored;
  } catch { /* localStorage 不可用 */ }
  const id = crypto.randomUUID();
  try { localStorage.setItem(key, id); } catch { /* noop */ }
  // 注：受限环境下每次生成新 ID，在 initEngine 后会通过 adapter.kvSet 补写持久化
  return id;
}

function App() {
  const { t } = useTranslation();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [currentPage, setCurrentPage] = useState<string>("library");
  const [currentAuPath, setCurrentAuPath] = useState<string>("");
  const [engineInitialized, setEngineInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [splashVisible, setSplashVisible] = useState(true);
  // PWA 新版本就绪（R1-6）：registerType=prompt 后新 SW 不自动接管，等用户点横幅再更新。
  const [swUpdate, setSwUpdate] = useState<SwUpdateReadyDetail | null>(null);
  const initRef = useRef(false);
  const splashStartRef = useRef(Date.now());

  useEffect(() => {
    async function setup() {
      if (initRef.current) return;
      initRef.current = true;

      let currentStep = "detecting platform";
      try {
        // 检查是否在 Tauri 环境中
        const isTauri = detectTauri();

        const deviceId = getOrCreateDeviceId();

        if (isTauri) {
          // Tauri 环境：使用 TauriAdapter
          currentStep = "loading Tauri modules";
          const { TauriAdapter } = await import("@ficforge/engine");
          const { appDataDir } = await import("@tauri-apps/api/path");
          const adapter = new TauriAdapter(deviceId);

          // 数据目录 = appDataDir（收权后的唯一根）。
          // 旧「./fandoms 兼容迁移」分支已物理清退（盲审 2026-07-11 功能维）：fs 收权后
          // cwd 相对路径的 exists() 必然被 scope 拒绝进 catch —— 该分支在所有收权构建上
          // 是不可达死代码，且会让极早期 cwd 数据用户误以为兼容仍生效（实际数据静默不可见）。
          // 极早期用户如有 ./fandoms 数据：手动拷贝到 %APPDATA% 数据目录即可（真机清单有验证项）。
          currentStep = "resolving data directory";
          const dataDir = await appDataDir();

          currentStep = "initializing logger";
          initLogger(adapter, dataDir);
          currentStep = "initializing engine";
          initEngine(adapter, dataDir);
        } else {
          // 非 Tauri 环境：检测 Capacitor 或降级 WebAdapter
          const isCapacitor = detectCapacitor();

          if (isCapacitor) {
            // Capacitor 环境（Android/iOS）：使用 CapacitorAdapter
            // 文件操作用相对路径（""），file:// URI 仅用于 UI 显示
            currentStep = "loading Capacitor adapter";
            const { CapacitorAdapter } = await import("@ficforge/engine");
            const adapter = new CapacitorAdapter(deviceId);
            currentStep = "initializing logger";
            initLogger(adapter, "");
            currentStep = "initializing engine";
            initEngine(adapter, "");
          } else {
            // PWA / 浏览器：使用 WebAdapter（IndexedDB）
            currentStep = "loading Web adapter";
            const { WebAdapter } = await import("@ficforge/engine");
            const adapter = new WebAdapter(deviceId);
            await adapter.init();
            currentStep = "initializing logger";
            initLogger(adapter, "");
            currentStep = "initializing engine";
            initEngine(adapter, "");
            // 请求持久化存储，防止浏览器自动回收 IndexedDB 数据
            try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
          }
        }

        // 确保 device_id 持久化到 adapter KV（覆盖 localStorage 不可用的场景）
        try {
          const { getEngine } = await import("./api/engine-client");
          const eng = getEngine();
          const kvStored = await eng.adapter.kvGet("ficforge_device_id");
          if (!kvStored) {
            await eng.adapter.kvSet("ficforge_device_id", deviceId);
          } else if (kvStored !== deviceId) {
            // L14：受限环境（localStorage 不可用）下 getOrCreateDeviceId 每次生成新随机 ID，但 KV
            // 里已有旧 ID。采用已存值，让 ops device_id 归属稳定，不再每次重开漂移。
            eng.adapter.setDeviceId(kvStored);
          }
        } catch { /* best effort */ }

        // 检查是否有上次中断的后台任务（仅 log，后续可接恢复 UI）
        try {
          const eng = getEngine();
          const interrupted = await eng.taskRunner.getInterruptedTasks();
          if (interrupted.length > 0) {
            getLogger().info("task_runner", `${interrupted.length} interrupted task(s) from previous session`);
          }
        } catch { /* best effort */ }

        try {
          currentStep = "migrating secure storage";
          const migration = await migrateLegacySecureStorage();
          if (migration.attempted && (migration.settingsMigrated || migration.migratedProjects > 0 || migration.failedProjects.length > 0)) {
            getLogger().info("security", "migrated legacy secure storage", {
              attempted: migration.attempted,
              settingsMigrated: migration.settingsMigrated,
              scannedProjects: migration.scannedProjects,
              migratedProjects: migration.migratedProjects,
              failedProjects: migration.failedProjects,
            });
          }
        } catch (e) {
          logUiError("app", "Legacy secure storage migration failed", e);
        }

        // 启动时恢复已下载字体到 FontFace registry（Phase 5 有下载功能后才有实际作用）。
        // 失败内部已 console.warn，不阻断启动。
        await hydrateFontsOnStartup();

        setEngineInitialized(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logUiError("app", `Init failed at: ${currentStep}`, e);
        setInitError(`[${currentStep}] ${msg}`);
      }
    }
    setup();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateViewportHeight = () => {
      document.documentElement.style.setProperty(
        "--app-height",
        `${window.visualViewport?.height ?? window.innerHeight}px`
      );
    };

    updateViewportHeight();
    window.visualViewport?.addEventListener("resize", updateViewportHeight);
    window.addEventListener("resize", updateViewportHeight);

    return () => {
      window.visualViewport?.removeEventListener("resize", updateViewportHeight);
      window.removeEventListener("resize", updateViewportHeight);
    };
  }, []);

  // PWA SW 更新就绪事件（R1-6）：main.tsx 的 onNeedRefresh 派发，这里落成低调可关横幅。
  useEffect(() => {
    const onUpdateReady = (event: Event) => {
      // detail 来自跨模块 CustomEvent，运行时可能缺失 → 显式验形，不信任 cast
      const detail = (event as CustomEvent<Partial<SwUpdateReadyDetail> | undefined>).detail;
      if (typeof detail?.update === "function") setSwUpdate({ update: detail.update });
    };
    window.addEventListener(SW_UPDATE_READY_EVENT, onUpdateReady);
    return () => window.removeEventListener(SW_UPDATE_READY_EVENT, onUpdateReady);
  }, []);

  // Splash fade-out: ensure minimum 1s display, then fade
  const dismissSplash = useCallback(() => {
    const elapsed = Date.now() - splashStartRef.current;
    const remaining = Math.max(0, 1000 - elapsed);
    setTimeout(() => setSplashVisible(false), remaining);
  }, []);

  useEffect(() => {
    if (engineInitialized || initError) {
      dismissSplash();
    }
  }, [engineInitialized, initError, dismissSplash]);

  const handleNavigate = (page: string, contextPath?: string) => {
    if (contextPath) {
      setCurrentAuPath(contextPath);
    }
    setCurrentPage(page);
  };

  if (initError) {
    return (
      <div className="min-h-screen bg-background text-text flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-error text-lg mb-2">{t('app.initError.title')}</p>
          <p className="text-text/70 text-sm">{initError}</p>
          <p className="text-text/50 text-xs mt-4">{t('app.initError.restartHint')}</p>
        </div>
      </div>
    );
  }

  if (!engineInitialized) {
    return <SplashScreen visible={splashVisible} />;
  }

  const isAuSpace = ["writer", "chat", "facts", "threads", "au_lore", "settings"].includes(currentPage);

  return (
    <>
      <SplashScreen visible={splashVisible} />
      {!isAuSpace && currentPage === "library" && <Library onNavigate={handleNavigate} />}
      {!isAuSpace && currentPage === "fandom_lore" && (
        isMobile
          ? <MobileFandomView fandomPath={currentAuPath} onNavigate={handleNavigate} />
          : <FandomLoreLayout fandomPath={currentAuPath} onNavigate={handleNavigate} />
      )}

      {isAuSpace && (
        <AuWorkspaceLayout
          key={currentAuPath}
          activeTab={currentPage}
          onNavigate={handleNavigate}
          auPath={currentAuPath}
        />
      )}

      {/* PWA 新版本横幅（R1-6）：低调、可关，点「立即更新」才激活新 SW 并刷新。 */}
      {swUpdate && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-sm border border-rule bg-surface px-4 py-2 text-sm text-text shadow-subtle"
        >
          <span>{t("app.swUpdate.ready")}</span>
          <button
            type="button"
            className="shrink-0 font-medium text-accent underline-offset-2 hover:underline"
            onClick={() => swUpdate.update()}
          >
            {t("app.swUpdate.update")}
          </button>
          <button
            type="button"
            aria-label={t("app.swUpdate.dismiss")}
            className="shrink-0 text-text/50 hover:text-text"
            onClick={() => setSwUpdate(null)}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}

export default App;
