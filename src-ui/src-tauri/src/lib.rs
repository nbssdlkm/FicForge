//! Sidecar 生命周期管理。
//!
//! PRD §2.6.7: Tauri 通过 Command API 拉起 Python sidecar，
//! 监听 stdout 解析端口号，检测进程退出。

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

// ---------------------------------------------------------------------------
// Sidecar 状态
// ---------------------------------------------------------------------------
struct SidecarState {
    port: Mutex<Option<u16>>,
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

/// 获取 sidecar 端口号（前端调用）。
#[tauri::command]
fn get_sidecar_port(state: tauri::State<SidecarState>) -> Option<u16> {
    *state.port.lock().unwrap()
}

// ---------------------------------------------------------------------------
// Sidecar 进程管理
// ---------------------------------------------------------------------------

/// 启动 Python sidecar 进程。
///
/// - 环境变量注入 PYTHONUNBUFFERED=1（PRD §2.6.7 双保险）
/// - 监听 stdout 解析 [SIDECAR_PORT_READY:{port}]
/// - 进程退出时发送 sidecar-exited 事件
fn spawn_sidecar(handle: &AppHandle) {
    let handle = handle.clone();

    tokio::spawn(async move {
        // 定位 Python 脚本路径
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let project_root = std::path::Path::new(manifest_dir)
            .parent()
            .expect("cannot resolve src-ui")
            .parent()
            .expect("cannot resolve project root");
        let script_path = project_root.join("src-python").join("main.py");
        let python_path = project_root.join("src-python");

        let mut child = Command::new("python3")
            .arg(&script_path)
            .env("PYTHONUNBUFFERED", "1")
            .env("PYTHONPATH", &python_path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .expect("Failed to spawn Python sidecar");

        let stdout = child.stdout.take().expect("Failed to capture sidecar stdout");
        let mut lines = BufReader::new(stdout).lines();

        // 解析端口号
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(port_str) = line
                .strip_prefix("[SIDECAR_PORT_READY:")
                .and_then(|s| s.strip_suffix(']'))
            {
                if let Ok(port) = port_str.parse::<u16>() {
                    let state = handle.state::<SidecarState>();
                    *state.port.lock().unwrap() = Some(port);
                    let _ = handle.emit("sidecar-ready", port);
                    break;
                }
            }
        }

        // 持续读取 stdout（防止管道缓冲区满阻塞 sidecar）
        while let Ok(Some(_)) = lines.next_line().await {}

        // stdout 关闭 → 进程已退出或即将退出
        let status = child.wait().await;
        let state = handle.state::<SidecarState>();
        *state.port.lock().unwrap() = None;
        let _ = handle.emit(
            "sidecar-exited",
            format!("{:?}", status),
        );
    });
}

// ---------------------------------------------------------------------------
// App 入口
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SidecarState {
            port: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![get_sidecar_port])
        .setup(|app| {
            spawn_sidecar(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
