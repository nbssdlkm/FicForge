import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Library } from "./ui/Library";
import { FandomLoreLayout } from "./ui/library/FandomLoreLayout";
import { AuWorkspaceLayout } from "./ui/workspace/AuWorkspaceLayout";
import { setSidecarPort } from "./api/client";

function App() {
  const [currentPage, setCurrentPage] = useState<string>("library");
  const [currentAuPath, setCurrentAuPath] = useState<string>("");
  const [sidecarReady, setSidecarReady] = useState(false);
  const [sidecarError, setSidecarError] = useState<string | null>(null);
  const readyRef = useRef(false);

  const markReady = (port: number) => {
    if (readyRef.current) return;
    readyRef.current = true;
    setSidecarPort(port);
    setSidecarReady(true);
  };

  useEffect(() => {
    let unlistenReady: (() => void) | undefined;
    let unlistenExited: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pollId: ReturnType<typeof setInterval> | undefined;

    async function setup() {
      try {
        // 1. 监听未来事件
        unlistenReady = await listen<number>("sidecar-ready", (event) => {
          markReady(event.payload);
          if (timer) clearTimeout(timer);
          if (pollId) clearInterval(pollId);
        });
        unlistenExited = await listen<string>("sidecar-exited", (event) => {
          setSidecarError(`后端引擎已退出: ${event.payload}`);
        });

        // 2. 立即检查是否已就绪（防止事件在 listener 注册前触发）
        const port = await invoke<number | null>("get_sidecar_port");
        if (port) {
          markReady(port);
          return;
        }

        // 3. 轮询兜底（每 500ms 检查一次，最多 30 秒）
        let polling = false;
        pollId = setInterval(async () => {
          if (polling) return;
          polling = true;
          try {
            const p = await invoke<number | null>("get_sidecar_port");
            if (p) {
              markReady(p);
              if (timer) clearTimeout(timer);
              if (pollId) clearInterval(pollId);
            }
          } catch { /* ignore */ }
          finally { polling = false; }
        }, 500);

        // 4. 超时报错
        timer = setTimeout(() => {
          if (!readyRef.current) {
            if (pollId) clearInterval(pollId);
            setSidecarError("后端引擎启动超时（30 秒），请重启应用");
          }
        }, 30000);
      } catch {
        // Tauri API 不可用（纯浏览器开发模式）→ 使用默认端口
        setSidecarReady(true);
        return;
      }
    }
    setup();

    return () => {
      if (timer) clearTimeout(timer);
      if (pollId) clearInterval(pollId);
      unlistenReady?.();
      unlistenExited?.();
    };
  }, []);

  const handleNavigate = (page: string, contextPath?: string) => {
    if (contextPath) {
      setCurrentAuPath(contextPath);
    }
    setCurrentPage(page);
  };

  if (sidecarError) {
    return (
      <div className="min-h-screen bg-background text-text flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-red-500 text-lg mb-2">引擎异常</p>
          <p className="text-text/60 text-sm">{sidecarError}</p>
          <p className="text-text/40 text-xs mt-4">请重启应用，或检查日志文件</p>
        </div>
      </div>
    );
  }

  if (!sidecarReady) {
    return (
      <div className="min-h-screen bg-background text-text flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto mb-4" />
          <p className="text-text/60">正在初始化本地引擎…</p>
        </div>
      </div>
    );
  }

  const isAuSpace = ["writer", "facts", "au_lore", "settings"].includes(currentPage);

  return (
    <>
      {!isAuSpace && currentPage === "library" && <Library onNavigate={handleNavigate} />}
      {!isAuSpace && currentPage === "fandom_lore" && <FandomLoreLayout onNavigate={handleNavigate} />}
      
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
