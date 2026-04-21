// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 字体清单 — 字体系统的唯一真相源。
 *
 * 新增/下线字体只需修改本文件；下载、存储、注册、UI 展示全部派生自此。
 *
 * 每条可下载字体带 **两个源**：
 *   - priority=1 主源：自建 CF Tunnel（nbssdlkm.cn），**已子集化的 woff2**，速度最优；
 *     使用 `entry.sha256` 校验文件完整性。
 *   - priority=2 备源：fontsource CDN（jsDelivr npm 镜像）或上游 GitHub release 的 TTF，
 *     主源挂掉时兜底，体积通常更大但能保证可用。
 *     **备源字节与主源不同**（子集范围 / 格式各异），故每条备源显式 `sha256: ""`
 *     跳过该源校验（依赖 TLS 传输完整性），否则校验必然失败导致备源不可用。
 * downloader 按 priority 升序 failover（见 src-engine/fonts/downloader.ts）。
 */

import { createFontsConfig } from "../domain/settings.js";
import type { FontEntry } from "./types.js";

/**
 * 「跟随系统」字体栈。不进 manifest，单独常量导出。
 *
 * 浏览器/OS 自动挑选：Windows 用 Segoe UI + 微软雅黑，macOS 用苹方，
 * Android 用 Roboto + Noto Sans CJK，iOS 用苹方。用户在系统设置里换字体，
 * 应用自动跟随。
 */
export const SYSTEM_FONT_STACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';

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
    // 分片加载入口：cn-font-split 拆出的 243 个 woff2 子片 + @font-face unicode-range 声明。
    // 浏览器按需抓取子片，整包体积 ~17 MB 随应用分发（src-ui/public/fonts/lxgw-wenkai-screen/）。
    url: "/fonts/lxgw-wenkai-screen/result.css",
  },

  // ── 可下载字体（按需拉取 · 主源自建 nbssdlkm.cn + fontsource CDN 备源） ──
  // 所有主源 woff2 已子集化（CJK 保留 GB2312+扩展 A 共 ~27000 字），immutable 缓存。
  // 备源用 fontsource（jsDelivr npm 镜像，自带基础子集）或 GitHub release，主源失败兜底。
  // ── 中文 ──
  {
    type: "downloadable",
    // id 与主源路径段 `/fonts/noto-serif-sc/` 对齐，并与同系列 `noto-sans-sc` 命名一致；
    // displayName 保留用户熟悉的"思源宋体"（Adobe 品牌）。
    id: "noto-serif-sc",
    family: "Noto Serif SC",
    displayName: { zh: "思源宋体", en: "Noto Serif SC" },
    script: "cjk",
    category: "serif",
    license: "SIL OFL 1.1",
    sizeBytes: 5_400_000,
    sha256: "fbf671a4bfa6421896d160f86b8a795d4221f7d5efca2aa2894ce25512ab952f",
    sources: [
      { url: "https://nbssdlkm.cn/fonts/noto-serif-sc/v1/NotoSerifSC-Regular.subset.woff2", priority: 1 },
      { url: "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@latest/files/noto-serif-sc-chinese-simplified-400-normal.woff2", priority: 2, sha256: "" },
    ],
  },
  {
    type: "downloadable",
    // id 从 `lxgw-wenkai` 改为 `lxgw-wenkai-gb`：
    // (a) 与 builtin 同族 `lxgw-wenkai-screen` 命名风格对齐；
    // (b) 明确这是 GB2312 子集版（而非打印向全字库版）。
    id: "lxgw-wenkai-gb",
    family: "LXGW WenKai GB",
    displayName: { zh: "霞鹜文楷 GB", en: "LXGW WenKai GB" },
    script: "cjk",
    category: "serif",
    license: "SIL OFL 1.1",
    sizeBytes: 6_500_000,
    sha256: "3a0f23cf6df055bd4751234dcabf0f63d7192e96cf838c1cbfb67d6e10a0665a",
    sources: [
      { url: "https://nbssdlkm.cn/fonts/lxgw-wenkai-gb/v1/LXGWWenKaiGB-Regular.subset.woff2", priority: 1 },
      // fontsource 未收录 LXGW WenKai GB；回退到上游 GitHub release 的完整 TTF（~26MB）。
      { url: "https://github.com/lxgw/LxgwWenkaiGB/releases/download/v1.522/LXGWWenKaiGB-Regular.ttf", priority: 2, sha256: "" },
    ],
  },
  {
    type: "downloadable",
    id: "noto-sans-sc",
    family: "Noto Sans SC",
    displayName: { zh: "思源黑体", en: "Noto Sans SC" },
    script: "cjk",
    category: "sans",
    license: "SIL OFL 1.1",
    sizeBytes: 3_900_000,
    sha256: "f094ea643fe850b8b293679ebf54b0583f5abf078cf09fa5110c21daca73d99d",
    sources: [
      { url: "https://nbssdlkm.cn/fonts/noto-sans-sc/v1/NotoSansSC-Regular.subset.woff2", priority: 1 },
      { url: "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@latest/files/noto-sans-sc-chinese-simplified-400-normal.woff2", priority: 2, sha256: "" },
    ],
  },
  {
    type: "downloadable",
    id: "ma-shan-zheng",
    family: "Ma Shan Zheng",
    displayName: { zh: "马善政（手写楷体）", en: "Ma Shan Zheng" },
    script: "cjk",
    category: "script",
    license: "SIL OFL 1.1",
    sizeBytes: 3_200_000,
    sha256: "22c7c596eb5d7f78976b3d2023489741c213b7c7563c991f69371c02705a39d4",
    sources: [
      { url: "https://nbssdlkm.cn/fonts/ma-shan-zheng/v1/MaShanZheng-Regular.subset.woff2", priority: 1 },
      { url: "https://cdn.jsdelivr.net/npm/@fontsource/ma-shan-zheng@latest/files/ma-shan-zheng-chinese-simplified-400-normal.woff2", priority: 2, sha256: "" },
    ],
  },
  {
    type: "downloadable",
    id: "long-cang",
    family: "Long Cang",
    displayName: { zh: "龙藏体（行书手写）", en: "Long Cang" },
    script: "cjk",
    category: "script",
    license: "SIL OFL 1.1",
    sizeBytes: 2_900_000,
    sha256: "72852b7738c2828fad984c8963f3d2d12824f97a779bd04bee74cc24ea28b71f",
    sources: [
      { url: "https://nbssdlkm.cn/fonts/long-cang/v1/LongCang-Regular.subset.woff2", priority: 1 },
      { url: "https://cdn.jsdelivr.net/npm/@fontsource/long-cang@latest/files/long-cang-chinese-simplified-400-normal.woff2", priority: 2, sha256: "" },
    ],
  },
  // ── 英文 ──
  {
    type: "downloadable",
    id: "literata",
    family: "Literata",
    displayName: { zh: "Literata（电子书专用）", en: "Literata" },
    script: "latin",
    category: "serif",
    license: "SIL OFL 1.1",
    sizeBytes: 20_000,
    sha256: "63ac1c036bd07d9bd6b4505f893b204f56e3cab570dc26c9225a2d395aaca73b",
    sources: [
      { url: "https://nbssdlkm.cn/fonts/literata/v1/Literata-Regular.subset.woff2", priority: 1 },
      { url: "https://cdn.jsdelivr.net/npm/@fontsource/literata@latest/files/literata-latin-400-normal.woff2", priority: 2, sha256: "" },
    ],
  },
  {
    type: "downloadable",
    id: "lora",
    family: "Lora",
    displayName: { zh: "Lora（经典书籍体）", en: "Lora" },
    script: "latin",
    category: "serif",
    license: "SIL OFL 1.1",
    sizeBytes: 20_000,
    sha256: "6381586b4e69f7a6bf8751469f7f068349d23f9a54534536f07b0426c0f4a5ab",
    sources: [
      { url: "https://nbssdlkm.cn/fonts/lora/v1/Lora-Regular.subset.woff2", priority: 1 },
      { url: "https://cdn.jsdelivr.net/npm/@fontsource/lora@latest/files/lora-latin-400-normal.woff2", priority: 2, sha256: "" },
    ],
  },
  {
    type: "downloadable",
    id: "merriweather",
    family: "Merriweather",
    displayName: { zh: "Merriweather（屏幕阅读体）", en: "Merriweather" },
    script: "latin",
    category: "serif",
    license: "SIL OFL 1.1",
    sizeBytes: 44_000,
    sha256: "fb6f860ca8802d43207dc04662fbb64e47be722ff80184905220c25b2d422db1",
    sources: [
      { url: "https://nbssdlkm.cn/fonts/merriweather/v1/Merriweather-Regular.subset.woff2", priority: 1 },
      { url: "https://cdn.jsdelivr.net/npm/@fontsource/merriweather@latest/files/merriweather-latin-400-normal.woff2", priority: 2, sha256: "" },
    ],
  },
  {
    type: "downloadable",
    id: "eb-garamond",
    family: "EB Garamond",
    displayName: { zh: "EB Garamond（古典 Garamond）", en: "EB Garamond" },
    script: "latin",
    category: "serif",
    license: "SIL OFL 1.1",
    sizeBytes: 22_000,
    sha256: "5a680ff2060cc83ebff22de948c9e402964937ec9cc2eb66909cf3d81270eac9",
    sources: [
      { url: "https://nbssdlkm.cn/fonts/eb-garamond/v1/EBGaramond-Regular.subset.woff2", priority: 1 },
      { url: "https://cdn.jsdelivr.net/npm/@fontsource/eb-garamond@latest/files/eb-garamond-latin-400-normal.woff2", priority: 2, sha256: "" },
    ],
  },
  {
    type: "downloadable",
    id: "crimson-pro",
    family: "Crimson Pro",
    displayName: { zh: "Crimson Pro（优雅衬线）", en: "Crimson Pro" },
    script: "latin",
    category: "serif",
    license: "SIL OFL 1.1",
    sizeBytes: 16_000,
    sha256: "28e28bcaf8bffbefd7081282b68bb1309bc43a038a0675bcf0b9ec02c4415f77",
    sources: [
      { url: "https://nbssdlkm.cn/fonts/crimson-pro/v1/CrimsonPro-Regular.subset.woff2", priority: 1 },
      { url: "https://cdn.jsdelivr.net/npm/@fontsource/crimson-pro@latest/files/crimson-pro-latin-400-normal.woff2", priority: 2, sha256: "" },
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
  // 默认字体 id 源自 createFontsConfig()（唯一真相源）—— 任何被默认指派的非 "system"
  // 字体都必须是 builtin，否则用户首启就看不到默认字体。
  const defaults = createFontsConfig();
  const defaultIds = new Set([
    defaults.ui_latin_font_id,
    defaults.ui_cjk_font_id,
    defaults.reading_latin_font_id,
    defaults.reading_cjk_font_id,
  ]);
  for (const defaultId of defaultIds) {
    if (defaultId === "system") continue; // 不是 manifest 条目
    const entry = FONT_MANIFEST.find((f) => f.id === defaultId);
    if (!entry) {
      throw new Error(`manifest.ts: DEFAULT font id "${defaultId}" not found in FONT_MANIFEST`);
    }
    if (entry.type !== "builtin") {
      throw new Error(`manifest.ts: DEFAULT font id "${defaultId}" must be builtin (got "${entry.type}")`);
    }
  }
})();
