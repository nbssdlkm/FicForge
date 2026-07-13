// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * PWA Service Worker 更新事件契约（R1-6，单一真相源）。
 *
 * main.tsx（registerSW onNeedRefresh）派发；App.tsx 监听后显示「新版本已就绪」横幅。
 * registerType 已从 autoUpdate 改为 prompt（vite.config.ts）：新 SW 不再自动接管强刷
 * 页面 —— 用户在写作/生成中被静默刷新会丢防抖窗口内的未落盘内容。
 */

export const SW_UPDATE_READY_EVENT = "ficforge:sw-update-ready";

export interface SwUpdateReadyDetail {
  /** 应用更新：激活新 SW 并刷新页面（updateSW(true)）。 */
  update: () => void;
}
