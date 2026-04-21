// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 字体系统类型定义。
 *
 * 字体分两种：
 * - `builtin` — 随应用包一同分发（public/fonts/*.woff2），首启即用、离线可用。
 * - `downloadable` — 按需下载到本地存储，失败可多源降级。
 *
 * 「系统字体」不在此类型体系内：它不是一条可被独立管理的字体文件，而是一个
 * 交给浏览器/OS 决定的 CSS stack（见 manifest.ts 的 SYSTEM_FONT_STACK）。
 */

export type FontType = "builtin" | "downloadable";

/** 字体覆盖的书写体系。决定 fallback 分组与 UI 分类。 */
export type FontScript = "latin" | "cjk" | "both";

/** 字体分类，用于 UI 筛选与 Tailwind fontFamily 分档。 */
export type FontCategory = "serif" | "sans" | "mono" | "script";

/**
 * 字体分发源。多源 failover：按 priority 升序尝试，任一源成功即通过。
 *
 * 当前项目的源策略：
 * - priority=1 主源：自建 CF Tunnel（nbssdlkm.cn），子集化 woff2，最优速度；
 * - priority=2 备源：fontsource 的 jsDelivr npm 镜像 或 上游 GitHub release，
 *   主源挂掉时兜底（体积通常更大但保证可用）。
 * 可按需追加更多 priority 级别，downloader 按升序遍历直到成功或全部耗尽。
 */
export interface FontSource {
  url: string;
  priority: number;
}

interface FontEntryBase {
  /** 稳定标识符，全局唯一。变更会破坏已安装字体的关联，禁止修改。 */
  id: string;
  /** CSS font-family 值，同一字体在三端注册时共享该 family 名。 */
  family: string;
  /** UI 显示名（中英双语）。 */
  displayName: { zh: string; en: string };
  script: FontScript;
  category: FontCategory;
  /** 许可证标识，如 "SIL OFL 1.1"；打包时用于生成 LICENSE 清单。 */
  license: string;
}

/** 内置字体：随应用打包，通过相对 URL 加载。 */
export interface BuiltinFont extends FontEntryBase {
  type: "builtin";
  /**
   * 相对于前端静态根的加载入口 URL。两种形态：
   * - 单文件 woff2/ttf，如 `/fonts/source-serif-4.woff2`；
   * - CSS 分片入口（按 unicode-range 懒加载子片），如 `/fonts/lxgw-wenkai-screen/result.css`,
   *   适用于中文等大字库。
   *
   * 当前仅作信息字段：内置字体由 index.html 的 `<link>` 直接加载，service / downloader /
   * registry 均不消费此字段。未来若要统一走 manifest 驱动加载，需按扩展名分派处理。
   */
  url: string;
}

/** 可下载字体：按需从多源下载并校验。 */
export interface DownloadableFont extends FontEntryBase {
  type: "downloadable";
  /** 预期文件字节数，用于 UI 展示与 Content-Length 校验。 */
  sizeBytes: number;
  /** 小写十六进制 SHA-256 校验和，防止 CDN 污染或下载中断。 */
  sha256: string;
  /** 多源列表（至少一项）。downloader 按 priority 升序尝试。 */
  sources: readonly FontSource[];
}

export type FontEntry = BuiltinFont | DownloadableFont;

/** 下载进度回调的载荷。 */
export interface DownloadProgress {
  /** 已接收字节数。 */
  loaded: number;
  /** 预期总字节数；服务端未提供 Content-Length 时为 -1。 */
  total: number;
}

/** 字体运行时状态。 */
export type FontStatus = "not-installed" | "downloading" | "installed" | "error";

/** 字体系统错误的结构化表示。 */
export class FontError extends Error {
  constructor(
    public readonly code:
      | "network"
      | "checksum"
      | "aborted"
      | "not-found"
      | "storage"
      | "registry"
      | "invalid-manifest"
      | "unsupported",
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FontError";
  }
}
