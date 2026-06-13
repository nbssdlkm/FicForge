// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

//! FicForge Tauri 壳。
//!
//! 仅负责：插件注册 + 安全存储 Command（系统钥匙串）。
//! 多设备同步引擎与 Python embedding sidecar 均已退役（D-0040 / M7）；
//! 桌面端 embedding 统一走云端 API（见 src-engine/llm/capabilities.ts）。

mod secure_store;

use secure_store::{secure_store_get, secure_store_remove, secure_store_set};

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
        .invoke_handler(tauri::generate_handler![
            secure_store_get,
            secure_store_set,
            secure_store_remove
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
