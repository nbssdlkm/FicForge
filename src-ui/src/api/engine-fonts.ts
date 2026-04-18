// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Fonts — FontsService 单例入口。
 *
 * Phase 4 仅用于启动时 hydrateAll（当前无可下载字体，实际为 no-op，但保留
 * 入口让 Phase 5 的下载功能无需动 App.tsx）。
 *
 * UI 组件切换字体偏好不走此处，见 `hooks/useFontSelection.ts`：那是轻量的
 * settings + localStorage 双写，不依赖 FontsService。
 */

import {
  BrowserFontRegistry,
  FontDownloader,
  FontStorage,
  FontsService,
} from "@ficforge/engine";
import { getEngine } from "./engine-instance";

let _fontsService: FontsService | null = null;

/**
 * 获取全局 FontsService 单例。必须在 `initEngine` 之后调用。
 *
 * 多次调用返回同一实例。BrowserFontRegistry 的 document.fonts 校验发生在
 * register 调用时，构造阶段不抛错，SSR / 早期调用也安全。
 */
export function getFontsService(): FontsService {
  if (_fontsService) return _fontsService;
  const adapter = getEngine().adapter;
  const storage = new FontStorage(adapter);
  const downloader = new FontDownloader();
  const registry = new BrowserFontRegistry();
  _fontsService = new FontsService(storage, downloader, registry);
  return _fontsService;
}

/**
 * 启动时恢复已下载字体到 FontFace registry。幂等。
 *
 * Phase 4 阶段：manifest 中无已下载字体 → 实际 no-op。
 * Phase 5 接入下载 UI 后：本函数会把此前 install 过的字体从本地读回并注册。
 */
export async function hydrateFontsOnStartup(): Promise<void> {
  try {
    await getFontsService().hydrateAll();
  } catch (e) {
    // 字体 hydrate 失败不阻断启动 —— 最差情况是用户看到系统字体而非应用内置字体。
    console.warn("[fonts] hydrateAll failed:", e);
  }
}
