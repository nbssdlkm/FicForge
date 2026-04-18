// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 字体清单 — 字体系统的唯一真相源。
 *
 * 新增/下线字体只需修改本文件；下载、存储、注册、UI 展示全部派生自此。
 *
 * 可下载字体的 `sha256` 字段在 Phase 1（基建阶段）留空，等 Phase 5 实际接入
 * 下载流程时用真实文件计算并回填。下载器遇到空字符串时会跳过校验并输出
 * warning —— 这是受控的"开发态"行为，生产环境必须填齐。
 */

import type { FontEntry } from "./types.js";

/**
 * Manifest 版本号。每次 manifest 结构发生**不向后兼容**的变化时递增：
 *
 * - 加字段、改 URL、改 sha256：不算 breaking，**不递增**；
 * - 删字段、改字段语义、改 id 或 family、改 type 枚举：breaking，必须递增。
 *
 * 未来 Phase 可结合此版本号做字体数据的迁移（如清理旧版本留下的不兼容文件）。
 */
export const MANIFEST_VERSION = 1;

/**
 * 「跟随系统」字体栈。不进 manifest，单独常量导出。
 *
 * 浏览器/OS 自动挑选：Windows 用 Segoe UI + 微软雅黑，macOS 用苹方，
 * Android 用 Roboto + Noto Sans CJK，iOS 用苹方。用户在系统设置里换字体，
 * 应用自动跟随。
 */
export const SYSTEM_FONT_STACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';

/** 默认的西文阅读字体 id（内置）。 */
export const DEFAULT_LATIN_FONT_ID = "source-serif-4";
/** 默认的中文阅读字体 id（内置）。 */
export const DEFAULT_CJK_FONT_ID = "lxgw-wenkai-screen";

export const FONT_MANIFEST: readonly FontEntry[] = [
  // ── 内置字体（随包分发） ──────────────────────────
  {
    type: "builtin",
    id: "source-serif-4",
    family: "Source Serif 4",
    displayName: { zh: "Source Serif 4", en: "Source Serif 4" },
    script: "latin",
    category: "serif",
    license: "SIL OFL 1.1",
    url: "/fonts/source-serif-4.woff2",
  },
  {
    type: "builtin",
    id: "lxgw-wenkai-screen",
    family: "LXGW WenKai Screen",
    displayName: { zh: "霞鹜文楷 屏幕版", en: "LXGW WenKai Screen" },
    script: "cjk",
    category: "serif",
    license: "SIL OFL 1.1",
    url: "/fonts/lxgw-wenkai-screen.woff2",
  },

  // ── 可下载字体（按需拉取） ──────────────────────────
  // TODO(Phase 5): 以下每条 entry 的 URL 需实地验证可下载，且下载后以真实字节计算
  //                 sha256 回填。sizeBytes 也需根据实际文件校正。当前值为占位估算。
  //                 约定：URL 必须直指 woff2/ttf 文件（FontFace API 可直接消费），
  //                 严禁指向 .tgz / .zip 等压缩包。
  {
    type: "downloadable",
    id: "lxgw-wenkai",
    family: "LXGW WenKai",
    displayName: { zh: "霞鹜文楷（原版 · 打印向）", en: "LXGW WenKai (Original)" },
    script: "cjk",
    category: "serif",
    license: "SIL OFL 1.1",
    sizeBytes: 12_500_000,
    sha256: "",
    sources: [
      // 主源：jsDelivr GitHub 镜像（国内多线加速，版本号固定避免 main 漂移）
      {
        url: "https://cdn.jsdelivr.net/gh/lxgw/LxgwWenKai@v1.520/LXGWWenKai-Regular.ttf",
        priority: 1,
      },
      // 备源：npmmirror unpkg-like 单文件 API（阿里云国内节点）
      {
        url: "https://registry.npmmirror.com/lxgw-wenkai-webfont/latest/files/fonts/LXGWWenKai-Regular.woff2",
        priority: 2,
      },
    ],
  },
  {
    type: "downloadable",
    id: "lxgw-neo-xihei",
    family: "LXGW Neo XiHei",
    displayName: { zh: "霞鹜新晰黑", en: "LXGW Neo XiHei" },
    script: "cjk",
    category: "sans",
    license: "SIL OFL 1.1",
    sizeBytes: 7_000_000,
    sha256: "",
    sources: [
      {
        url: "https://cdn.jsdelivr.net/gh/lxgw/LxgwNeoXiHei@v1.000/LXGWNeoXiHei.ttf",
        priority: 1,
      },
      // Phase 5 调研：若 npmmirror 上存在 webfont 包则追加为 priority 2。
    ],
  },
  {
    type: "downloadable",
    id: "source-han-serif-sc",
    family: "Source Han Serif SC",
    displayName: { zh: "思源宋体 简体", en: "Source Han Serif SC" },
    script: "cjk",
    category: "serif",
    license: "SIL OFL 1.1",
    sizeBytes: 15_000_000,
    sha256: "",
    sources: [
      {
        url: "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5/files/noto-serif-sc-chinese-simplified-400-normal.woff2",
        priority: 1,
      },
      {
        url: "https://registry.npmmirror.com/@fontsource/noto-serif-sc/latest/files/files/noto-serif-sc-chinese-simplified-400-normal.woff2",
        priority: 2,
      },
    ],
  },
];

/** 按 id 查询字体条目。未找到返回 undefined。 */
export function getFontById(id: string): FontEntry | undefined {
  return FONT_MANIFEST.find((f) => f.id === id);
}

/** 按类型筛选字体。 */
export function filterFontsByType(type: FontEntry["type"]): FontEntry[] {
  return FONT_MANIFEST.filter((f) => f.type === type);
}

// ── 模块加载时自检 ───────────────────────────────────
// 在 manifest 字段修改时立即暴露漂移，而非等到运行时静默失效。
const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

(function validateManifest(): void {
  const seenIds = new Set<string>();
  const seenFamilies = new Set<string>();
  for (const entry of FONT_MANIFEST) {
    if (seenIds.has(entry.id)) {
      throw new Error(`manifest.ts: duplicate font id "${entry.id}"`);
    }
    seenIds.add(entry.id);
    if (seenFamilies.has(entry.family)) {
      // family 决定 CSS font-family 值；重复会导致 FontFace 注册冲突、
      // 卸载时漏删 document.fonts 中的其他同名条目。
      throw new Error(`manifest.ts: duplicate font family "${entry.family}"`);
    }
    seenFamilies.add(entry.family);
    if (entry.type === "downloadable") {
      if (entry.sources.length === 0) {
        throw new Error(`manifest.ts: downloadable font "${entry.id}" has no sources`);
      }
      // sha256 可以为空（Phase 1 占位态 → 运行时 warn 跳过校验），
      // 但一旦给出就必须是合法的 64 位十六进制，否则 downloader 会每次都 checksum 失败。
      if (entry.sha256 !== "" && !SHA256_HEX_RE.test(entry.sha256)) {
        throw new Error(
          `manifest.ts: invalid sha256 for "${entry.id}": "${entry.sha256}" (must be 64 hex chars or empty)`,
        );
      }
    }
  }
  for (const defaultId of [DEFAULT_LATIN_FONT_ID, DEFAULT_CJK_FONT_ID]) {
    const entry = FONT_MANIFEST.find((f) => f.id === defaultId);
    if (!entry) {
      throw new Error(`manifest.ts: DEFAULT font id "${defaultId}" not found in FONT_MANIFEST`);
    }
    if (entry.type !== "builtin") {
      throw new Error(`manifest.ts: DEFAULT font id "${defaultId}" must be builtin (got "${entry.type}")`);
    }
  }
})();
