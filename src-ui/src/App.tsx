// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect, useRef, useCallback } from "react";
import { Library } from "./ui/Library";
import { FandomLoreLayout } from "./ui/library/FandomLoreLayout";
import { MobileFandomView } from "./ui/mobile/MobileFandomView";
import { SplashScreen } from "./ui/SplashScreen";
import { AuWorkspaceLayout } from "./ui/workspace/AuWorkspaceLayout";
import { initEngine, getEngine, initLogger, getLogger } from "./api/engine-client";
import { useTranslation } from "./i18n/useAppTranslation";
import { useMediaQuery } from "./hooks/useMediaQuery";

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
  const initRef = useRef(false);
  const splashStartRef = useRef(Date.now());

  useEffect(() => {
    async function setup() {
      if (initRef.current) return;
      initRef.current = true;

      let currentStep = "detecting platform";
      try {
        // 检查是否在 Tauri 环境中
        const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

        const deviceId = getOrCreateDeviceId();

        if (isTauri) {
          // Tauri 环境：使用 TauriAdapter
          currentStep = "loading Tauri modules";
          const { TauriAdapter } = await import("@ficforge/engine");
          const { appDataDir } = await import("@tauri-apps/api/path");
          const { exists } = await import("@tauri-apps/plugin-fs");
          const adapter = new TauriAdapter(deviceId);

          // 数据目录检测：优先使用 appDataDir，如果旧路径有数据则使用旧路径（兼容迁移）
          currentStep = "resolving data directory";
          let dataDir = await appDataDir();
          const oldDataDir = "./fandoms";
          try {
            const oldExists = await exists(`${oldDataDir}/settings.yaml`);
            const newExists = await exists(`${dataDir}/settings.yaml`);
            if (oldExists && !newExists) {
              // 旧路径有数据但新路径没有 → 使用旧路径（兼容模式）
              dataDir = oldDataDir;
            }
          } catch {
            // 检测失败，使用默认 appDataDir
          }

          currentStep = "initializing logger";
          initLogger(adapter, dataDir);
          currentStep = "initializing engine";
          initEngine(adapter, dataDir);
        } else {
          // 非 Tauri 环境：检测 Capacitor 或降级 WebAdapter
          const isCapacitor = typeof (window as any).Capacitor !== "undefined"
            && (window as any).Capacitor.isNativePlatform?.();

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

        setEngineInitialized(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[FicForge] Init failed at:", currentStep, e);
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
          <p className="text-red-500 text-lg mb-2">{t('app.sidecar.error')}</p>
          <p className="text-text/60 text-sm">{initError}</p>
          <p className="text-text/40 text-xs mt-4">{t('app.sidecar.restartHint')}</p>
        </div>
      </div>
    );
  }

  if (!engineInitialized) {
    return <SplashScreen visible={splashVisible} />;
  }

  const isAuSpace = ["writer", "facts", "au_lore", "settings"].includes(currentPage);

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
          activeTab={currentPage} 
          onNavigate={handleNavigate}
          auPath={currentAuPath}
        />
      )}
    </>
  );
}

export default App;
