// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

//! Sidecar 生命周期管理。
//!
//! PRD §2.6.7: Tauri 通过 Command API 拉起 Python sidecar，
//! 监听 stdout 解析端口号，检测进程退出。
//!
//! 开发模式：直接运行 `python3 src-python/main.py`
//! 生产模式：运行打包后的 `sidecar/main` (Linux) 或 `sidecar/main.exe` (Windows)

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

/// 解析 sidecar 可执行文件路径。
///
/// 生产模式：`{app_resource_dir}/sidecar/main[.exe]`
/// 开发模式：`python3 {project_root}/src-python/main.py`
fn resolve_sidecar_command(handle: &AppHandle) -> (String, Vec<String>, Vec<(String, String)>) {
    // 尝试生产模式路径
    if let Ok(resource_dir) = handle.path().resource_dir() {
        let sidecar_dir = resource_dir.join("sidecar");
        let exe_name = if cfg!(windows) { "fanfic-sidecar.exe" } else { "fanfic-sidecar" };
        let sidecar_exe = sidecar_dir.join(exe_name);

        if sidecar_exe.exists() {
            eprintln!("[sidecar] production mode: {}", sidecar_exe.display());
            return (
                sidecar_exe.to_string_lossy().to_string(),
                vec![],
                vec![("PYTHONUNBUFFERED".into(), "1".into())],
            );
        }
    }

    // 开发模式 fallback
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let project_root = std::path::Path::new(manifest_dir)
        .parent()
        .expect("cannot resolve src-ui")
        .parent()
        .expect("cannot resolve project root");
    let script_path = project_root.join("src-python").join("main_embedding.py");
    let python_path = project_root.join("src-python");

    // Windows: python, Linux/macOS: python3
    let python_cmd = if cfg!(windows) { "python" } else { "python3" };
    eprintln!("[sidecar] dev mode: {} {}", python_cmd, script_path.display());

    (
        python_cmd.into(),
        vec![script_path.to_string_lossy().to_string()],
        vec![
            ("PYTHONUNBUFFERED".into(), "1".into()),
            ("PYTHONPATH".into(), python_path.to_string_lossy().to_string()),
        ],
    )
}

/// 启动 Python sidecar 进程。
///
/// - 环境变量注入 PYTHONUNBUFFERED=1（PRD §2.6.7 双保险）
/// - 监听 stdout 解析 [SIDECAR_PORT_READY:{port}]
/// - 进程退出时发送 sidecar-exited 事件
fn spawn_sidecar(handle: &AppHandle) {
    let handle = handle.clone();

    tauri::async_runtime::spawn(async move {
        let (program, args, envs) = resolve_sidecar_command(&handle);

        let mut cmd = Command::new(&program);
        for arg in &args {
            cmd.arg(arg);
        }
        for (k, v) in &envs {
            cmd.env(k, v);
        }
        // 清除代理环境变量：sidecar 直连 LLM API，不走系统代理
        for proxy_var in &[
            "ALL_PROXY", "all_proxy",
            "HTTP_PROXY", "http_proxy",
            "HTTPS_PROXY", "https_proxy",
            "NO_PROXY", "no_proxy",
        ] {
            cmd.env_remove(proxy_var);
        }

        cmd.stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Failed to spawn sidecar ({program}): {e}");
                let _ = handle.emit("sidecar-exited", format!("spawn error: {e}"));
                return;
            }
        };

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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
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
