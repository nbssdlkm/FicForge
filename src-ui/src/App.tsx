import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";

type SidecarStatus = "connecting" | "connected" | "error";

function App() {
  const [status, setStatus] = useState<SidecarStatus>("connecting");
  const [port, setPort] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const checkHealth = useCallback(async (p: number) => {
    try {
      const resp = await fetch(`http://127.0.0.1:${p}/health`);
      const data = await resp.json();
      if (data.status === "ok") {
        setStatus("connected");
      } else {
        setStatus("error");
        setErrorMsg("Health check 返回异常");
      }
    } catch {
      setStatus("error");
      setErrorMsg("无法连接到本地引擎");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlistenReady: (() => void) | undefined;
    let unlistenExited: (() => void) | undefined;

    async function setup() {
      unlistenReady = await listen<number>("sidecar-ready", (event) => {
        if (cancelled) return;
        const p = event.payload;
        setPort(p);
        checkHealth(p);
      });

      unlistenExited = await listen<string>("sidecar-exited", () => {
        if (cancelled) return;
        setStatus("error");
        setPort(null);
        setErrorMsg("本地引擎进程已退出");
      });
    }

    setup();

    return () => {
      cancelled = true;
      unlistenReady?.();
      unlistenExited?.();
    };
  }, [checkHealth]);

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>同人写作辅助系统</h1>
      <div
        style={{
          padding: "0.75rem 1rem",
          borderRadius: "6px",
          marginTop: "1rem",
          background:
            status === "connecting"
              ? "#fff8e1"
              : status === "connected"
                ? "#e8f5e9"
                : "#ffebee",
          color:
            status === "connecting"
              ? "#f57f17"
              : status === "connected"
                ? "#2e7d32"
                : "#c62828",
        }}
      >
        {status === "connecting" && "正在初始化本地引擎…"}
        {status === "connected" && `本地引擎已就绪 (端口 ${port})`}
        {status === "error" && `连接失败: ${errorMsg}`}
      </div>
      <p style={{ marginTop: "1rem", color: "#666" }}>
        后续任务将逐步构建 UI。
      </p>
    </main>
  );
}

export default App;
