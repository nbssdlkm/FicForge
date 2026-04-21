// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 字体清单 — 扩展字体只需在此文件添加条目。
 * 下载器、注册器、UI 代码不需要修改。
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FontCategory = 'serif' | 'sans-serif' | 'monospace';

export interface FontManifestEntry {
  /** KV 键值，如 'noto-sans-sc' */
  id: string;
  /** 英文显示名 */
  name: string;
  /** 中文显示名 */
  nameZh: string;
  category: FontCategory;
  /** 版本号嵌入 URL，换版本换路径实现永久缓存 */
  version: string;
  /** 可用字重 */
  weights: number[];
  /** weight -> 文件名 */
  files: Record<number, string>;
  /** 服务端基础 URL，如 'https://nbssdlkm.cn/fonts/noto-sans-sc/v1' */
  baseUrl: string;
  /** CSS fallback 字体栈 */
  fallback: string[];
  /** 开源协议标识 */
  license: string;
  /** 所有字重文件的总大小（KB），给 UI 显示 */
  fileSizeKB: number;
}

export interface SystemFont {
  id: string;
  name: string;
  nameZh: string;
  category: FontCategory;
  /** CSS font-family 值 */
  stack: string;
}

// ---------------------------------------------------------------------------
// 系统字体（无需下载）
// ---------------------------------------------------------------------------

export const SYSTEM_FONTS: SystemFont[] = [
  {
    id: 'system-serif',
    name: 'System Serif',
    nameZh: '系统衬线',
    category: 'serif',
    stack: 'Charter, Georgia, "Noto Serif CJK SC", SimSun, serif',
  },
  {
    id: 'system-sans',
    name: 'System Sans',
    nameZh: '系统无衬线',
    category: 'sans-serif',
    stack: 'Inter, -apple-system, system-ui, "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
  },
];

// ---------------------------------------------------------------------------
// 字体服务器
// ---------------------------------------------------------------------------

export const FONT_SERVER_BASE = 'https://nbssdlkm.cn/fonts';

// ---------------------------------------------------------------------------
// 可下载字体清单
// ---------------------------------------------------------------------------

export const FONT_MANIFEST: FontManifestEntry[] = [
  // ── 中文字体 ─────────────────────────────────────────────
  {
    id: 'noto-serif-sc',
    name: 'Noto Serif SC',
    nameZh: '思源宋体',
    category: 'serif',
    version: 'v1',
    weights: [400, 700],
    files: { 400: 'NotoSerifSC-Regular.subset.woff2', 700: 'NotoSerifSC-Bold.subset.woff2' },
    baseUrl: `${FONT_SERVER_BASE}/noto-serif-sc/v1`,
    fallback: ['"Noto Serif CJK SC"', 'SimSun', 'serif'],
    license: 'OFL-1.1',
    fileSizeKB: 10600,
  },
  {
    id: 'lxgw-wenkai-gb',
    name: 'LXGW WenKai GB',
    nameZh: '霞鹜文楷',
    category: 'serif',
    version: 'v1',
    weights: [300, 400],
    files: { 300: 'LXGWWenKaiGB-Light.subset.woff2', 400: 'LXGWWenKaiGB-Regular.subset.woff2' },
    baseUrl: `${FONT_SERVER_BASE}/lxgw-wenkai-gb/v1`,
    fallback: ['KaiTi', 'STKaiti', 'serif'],
    license: 'OFL-1.1',
    fileSizeKB: 14000,
  },
  {
    id: 'ma-shan-zheng',
    name: 'Ma Shan Zheng',
    nameZh: '马善政（手写楷体）',
    category: 'serif',
    version: 'v1',
    weights: [400],
    files: { 400: 'MaShanZheng-Regular.subset.woff2' },
    baseUrl: `${FONT_SERVER_BASE}/ma-shan-zheng/v1`,
    fallback: ['KaiTi', 'STKaiti', 'serif'],
    license: 'OFL-1.1',
    fileSizeKB: 3100,
  },
  {
    id: 'long-cang',
    name: 'Long Cang',
    nameZh: '龙藏体（行书手写）',
    category: 'serif',
    version: 'v1',
    weights: [400],
    files: { 400: 'LongCang-Regular.subset.woff2' },
    baseUrl: `${FONT_SERVER_BASE}/long-cang/v1`,
    fallback: ['STXingkai', 'KaiTi', 'serif'],
    license: 'OFL-1.1',
    fileSizeKB: 2800,
  },
  {
    id: 'noto-sans-sc',
    name: 'Noto Sans SC',
    nameZh: '思源黑体',
    category: 'sans-serif',
    version: 'v1',
    weights: [400, 700],
    files: { 400: 'NotoSansSC-Regular.subset.woff2', 700: 'NotoSansSC-Bold.subset.woff2' },
    baseUrl: `${FONT_SERVER_BASE}/noto-sans-sc/v1`,
    fallback: ['"Noto Sans CJK SC"', 'sans-serif'],
    license: 'OFL-1.1',
    fileSizeKB: 7800,
  },
  // ── 英文字体 ─────────────────────────────────────────────
  {
    id: 'literata',
    name: 'Literata',
    nameZh: 'Literata（电子书专用）',
    category: 'serif',
    version: 'v1',
    weights: [400, 700],
    files: { 400: 'Literata-Regular.subset.woff2', 700: 'Literata-Bold.subset.woff2' },
    baseUrl: `${FONT_SERVER_BASE}/literata/v1`,
    fallback: ['Georgia', 'serif'],
    license: 'OFL-1.1',
    fileSizeKB: 40,
  },
  {
    id: 'source-serif-4',
    name: 'Source Serif 4',
    nameZh: 'Source Serif（Adobe 宋体）',
    category: 'serif',
    version: 'v1',
    weights: [400, 700],
    files: { 400: 'SourceSerif4-Regular.subset.woff2', 700: 'SourceSerif4-Bold.subset.woff2' },
    baseUrl: `${FONT_SERVER_BASE}/source-serif-4/v1`,
    fallback: ['Georgia', 'serif'],
    license: 'OFL-1.1',
    fileSizeKB: 40,
  },
  {
    id: 'lora',
    name: 'Lora',
    nameZh: 'Lora（经典书籍体）',
    category: 'serif',
    version: 'v1',
    weights: [400, 700],
    files: { 400: 'Lora-Regular.subset.woff2', 700: 'Lora-Bold.subset.woff2' },
    baseUrl: `${FONT_SERVER_BASE}/lora/v1`,
    fallback: ['Georgia', 'serif'],
    license: 'OFL-1.1',
    fileSizeKB: 40,
  },
  {
    id: 'merriweather',
    name: 'Merriweather',
    nameZh: 'Merriweather（屏幕阅读体）',
    category: 'serif',
    version: 'v1',
    weights: [400, 700],
    files: { 400: 'Merriweather-Regular.subset.woff2', 700: 'Merriweather-Bold.subset.woff2' },
    baseUrl: `${FONT_SERVER_BASE}/merriweather/v1`,
    fallback: ['Georgia', 'serif'],
    license: 'OFL-1.1',
    fileSizeKB: 88,
  },
  {
    id: 'eb-garamond',
    name: 'EB Garamond',
    nameZh: 'EB Garamond（古典 Garamond）',
    category: 'serif',
    version: 'v1',
    weights: [400, 700],
    files: { 400: 'EBGaramond-Regular.subset.woff2', 700: 'EBGaramond-Bold.subset.woff2' },
    baseUrl: `${FONT_SERVER_BASE}/eb-garamond/v1`,
    fallback: ['"Palatino Linotype"', 'Palatino', 'serif'],
    license: 'OFL-1.1',
    fileSizeKB: 42,
  },
  {
    id: 'crimson-pro',
    name: 'Crimson Pro',
    nameZh: 'Crimson Pro（优雅衬线）',
    category: 'serif',
    version: 'v1',
    weights: [400, 700],
    files: { 400: 'CrimsonPro-Regular.subset.woff2', 700: 'CrimsonPro-Bold.subset.woff2' },
    baseUrl: `${FONT_SERVER_BASE}/crimson-pro/v1`,
    fallback: ['Georgia', 'serif'],
    license: 'OFL-1.1',
    fileSizeKB: 32,
  },
];
