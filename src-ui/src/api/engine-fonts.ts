// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Fonts — FontsService 单例入口。
 *
 * 启动时 hydrateAll 把已下载安装的字体（FONT_MANIFEST 的 downloadable 条目）
 * 从本地存储读回并注册进 FontFace registry。
 *
 * UI 组件切换字体偏好不走此处，见 `hooks/useFontSelection.ts`：那是轻量的
 * settings + localStorage 双写，不依赖 FontsService。
 */

import { BrowserFontRegistry, FontDownloader, FontStorage, FontsService } from "@ficforge/engine";
import { warnUi } from "../utils/ui-logger";
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
 * 启动时恢复已下载字体到 FontFace registry。幂等；
 * 用户从未下载过字体时自然为 no-op。
 */
export async function hydrateFontsOnStartup(): Promise<void> {
  try {
    await getFontsService().hydrateAll();
  } catch (e) {
    // 字体 hydrate 失败不阻断启动 —— 最差情况是用户看到系统字体而非应用内置字体。
    warnUi("fonts", "hydrateAll failed", e);
  }
}
