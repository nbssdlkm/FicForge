import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Library } from "./ui/Library";
import { WriterLayout } from "./ui/writer/WriterLayout";
import { setSidecarPort } from "./api/client";

function App() {
  const [currentPage, setCurrentPage] = useState<string>("library");
  const [sidecarReady, setSidecarReady] = useState(false);

  useEffect(() => {
    // 监听 sidecar 端口就绪事件
    let unlisten: (() => void) | undefined;

    async function setup() {
      try {
        unlisten = await listen<number>("sidecar-ready", (event) => {
          setSidecarPort(event.payload);
          setSidecarReady(true);
        });
      } catch {
        // 非 Tauri 环境（开发模式），使用默认端口
        setSidecarReady(true);
      }
    }

    setup();
    // 3 秒后如果还没就绪，假定开发模式
    const timer = setTimeout(() => setSidecarReady(true), 3000);

    return () => {
      clearTimeout(timer);
      unlisten?.();
    };
  }, []);

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

  return (
    <>
      {currentPage === "library" ? (
         <Library onNavigate={setCurrentPage} />
      ) : (
         <WriterLayout onNavigate={setCurrentPage} />
      )}
    </>
  );
}

export default App;
