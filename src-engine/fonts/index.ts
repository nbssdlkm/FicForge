// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 字体系统统一导出。 */

export {
  FONT_MANIFEST,
  SYSTEM_FONT_STACK,
  filterFontsByType,
  getFontById,
} from "./manifest.js";

export { SYSTEM_FONT_ID, resolveFontStack, scriptSlotOf } from "./stacks.js";
export type { FontRole } from "./stacks.js";

export { FontDownloader, sha256Hex } from "./downloader.js";
export type { DownloaderOptions, FetchLike, ProgressCallback } from "./downloader.js";

export { BrowserFontRegistry, NoopFontRegistry } from "./registry.js";
export type { FontRegistry } from "./registry.js";

export { FontStorage } from "./storage.js";

export { FontsService } from "./service.js";
export type { InstallOptions } from "./service.js";

export {
  FontError,
} from "./types.js";
export type {
  BuiltinFont,
  DownloadProgress,
  DownloadableFont,
  FontCategory,
  FontEntry,
  FontScript,
  FontSource,
  FontStatus,
  FontType,
} from "./types.js";
