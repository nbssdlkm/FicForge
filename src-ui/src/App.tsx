// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect, useRef } from "react";
import { Library } from "./ui/Library";
import { FandomLoreLayout } from "./ui/library/FandomLoreLayout";
import { AuWorkspaceLayout } from "./ui/workspace/AuWorkspaceLayout";
import { initEngine } from "./api/engine-client";
import { useTranslation } from "./i18n/useAppTranslation";

function App() {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState<string>("library");
  const [currentAuPath, setCurrentAuPath] = useState<string>("");
  const [engineInitialized, setEngineInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    async function setup() {
      if (initRef.current) return;
      initRef.current = true;

      try {
        // 检查是否在 Tauri 环境中
        const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

        if (isTauri) {
          // Tauri 环境：使用 TauriAdapter
          const { TauriAdapter } = await import("@ficforge/engine");
          const { appDataDir } = await import("@tauri-apps/api/path");
          const { exists } = await import("@tauri-apps/plugin-fs");
          const adapter = new TauriAdapter();

          // 数据目录检测：优先使用 appDataDir，如果旧路径有数据则使用旧路径（兼容迁移）
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

          initEngine(adapter, dataDir);
        } else {
          // 浏览器开发模式：引擎不可用，显示提示
          setInitError("请使用 tauri dev 启动开发环境（浏览器模式不支持文件系统操作）");
          return;
        }

        setEngineInitialized(true);
      } catch (e) {
        setInitError(String(e));
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
    return (
      <div className="min-h-screen bg-background text-text flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto mb-4" />
          <p className="text-text/60">{t('app.sidecar.initializing')}</p>
        </div>
      </div>
    );
  }

  const isAuSpace = ["writer", "facts", "au_lore", "settings"].includes(currentPage);

  return (
    <>
      {!isAuSpace && currentPage === "library" && <Library onNavigate={handleNavigate} />}
      {!isAuSpace && currentPage === "fandom_lore" && <FandomLoreLayout fandomPath={currentAuPath} onNavigate={handleNavigate} />}
      
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
