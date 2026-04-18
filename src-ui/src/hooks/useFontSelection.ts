// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useFontSelection — 字体偏好双层存储 hook。
 *
 * 字体选择分 4 档（两维度正交）：
 *   - 角色：界面（ui） / 阅读（reading）
 *   - 书写：西文（latin） / 中文（cjk）
 *
 * 各档 id 独立存储；CSS 层把同角色的 latin + cjk 两个 id 合成 font-family stack，
 * 浏览器按 unicode-range 自动把英文路由到 Latin 字体、中文路由到 CJK 字体。
 *
 * 双层存储：
 * - `localStorage`：启动时同步读、模块加载即时应用 CSS 变量，避免 FOUC；
 * - `engine settings`：异步读写、跨设备同步（WebDAV sync 生效）。
 */

import { useCallback, useEffect, useState } from "react";
import {
  FONT_MANIFEST,
  SYSTEM_FONT_ID,
  getFontById,
  resolveFontStack,
  type FontEntry,
  type FontRole,
  type FontScript,
} from "@ficforge/engine";
import { getSettings, updateSettings } from "../api/engine-client";

const LS_KEYS = {
  ui_latin: "ficforge_font_ui_latin",
  ui_cjk: "ficforge_font_ui_cjk",
  reading_latin: "ficforge_font_reading_latin",
  reading_cjk: "ficforge_font_reading_cjk",
} as const;

/** 默认值须与 engine createFontsConfig 保持同步。 */
const DEFAULTS = {
  ui_latin: SYSTEM_FONT_ID,
  ui_cjk: SYSTEM_FONT_ID,
  reading_latin: "source-serif-4",
  reading_cjk: "lxgw-wenkai-screen",
} as const;

function readLocal(key: string, fallback: string): string {
  try {
    const v = localStorage.getItem(key);
    if (v) return v;
  } catch { /* localStorage 不可用 */ }
  return fallback;
}

function writeLocal(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* best effort */ }
}

function applyCSS(role: FontRole, latinId: string, cjkId: string): void {
  const cssVar = role === "ui" ? "--font-ui" : "--font-reading";
  document.documentElement.style.setProperty(cssVar, resolveFontStack(latinId, cjkId, role));
}

// 模块顶层执行：页面首帧就读 localStorage 设 CSS var，避免 React mount 前的 FOUC。
applyCSS(
  "ui",
  readLocal(LS_KEYS.ui_latin, DEFAULTS.ui_latin),
  readLocal(LS_KEYS.ui_cjk, DEFAULTS.ui_cjk),
);
applyCSS(
  "reading",
  readLocal(LS_KEYS.reading_latin, DEFAULTS.reading_latin),
  readLocal(LS_KEYS.reading_cjk, DEFAULTS.reading_cjk),
);

export interface FontOption {
  id: string;
  label: { zh: string; en: string };
}

/**
 * 按书写体系列出可选字体：`"system"` + 匹配 script 的内置 + 已下载 + alwaysInclude。
 *
 * `script === "latin"` 时只列 entry.script === "latin"；
 * `script === "cjk"` 时只列 entry.script === "cjk"。
 * `"both"` 类型的字体（manifest 未来可能出现）在任何 script 列表都出现。
 *
 * `alwaysIncludeIds` 传当前选中的 id，保证 `<select>` 的 value 能找到匹配 option
 * （见 fix commit 5600829）。
 */
export function listFontOptions(
  script: FontScript,
  installedDownloadableIds: readonly string[] = [],
  alwaysIncludeIds: readonly string[] = [],
): FontOption[] {
  const matchesScript = (entry: FontEntry): boolean =>
    entry.script === script || entry.script === "both";

  const options: FontOption[] = [
    { id: SYSTEM_FONT_ID, label: { zh: "跟随系统", en: "Follow system" } },
  ];
  const addedIds = new Set<string>([SYSTEM_FONT_ID]);

  for (const entry of FONT_MANIFEST) {
    if (entry.type === "builtin" && matchesScript(entry)) {
      options.push({ id: entry.id, label: entry.displayName });
      addedIds.add(entry.id);
    }
  }
  for (const id of installedDownloadableIds) {
    if (addedIds.has(id)) continue;
    const entry = getFontById(id);
    if (entry && entry.type === "downloadable" && matchesScript(entry)) {
      options.push({ id: entry.id, label: entry.displayName });
      addedIds.add(id);
    }
  }
  for (const id of alwaysIncludeIds) {
    if (addedIds.has(id)) continue;
    const entry = getFontById(id);
    if (entry) {
      // 跨 script 的"强制保留"场景：用户把历史选中的 cjk id 留着即便 list 已切 latin。
      // 标签直接用 entry.displayName。
      options.push({ id, label: entry.displayName });
    } else {
      options.push({ id, label: { zh: `未知字体 (${id})`, en: `Unknown (${id})` } });
    }
    addedIds.add(id);
  }
  return options;
}

export interface FontSelectionState {
  uiLatinFontId: string;
  uiCjkFontId: string;
  readingLatinFontId: string;
  readingCjkFontId: string;
  setUiLatinFontId: (id: string) => void;
  setUiCjkFontId: (id: string) => void;
  setReadingLatinFontId: (id: string) => void;
  setReadingCjkFontId: (id: string) => void;
}

export function useFontSelection(): FontSelectionState {
  const [uiLatinFontId, setUiLatinFontIdState] = useState(
    () => readLocal(LS_KEYS.ui_latin, DEFAULTS.ui_latin),
  );
  const [uiCjkFontId, setUiCjkFontIdState] = useState(
    () => readLocal(LS_KEYS.ui_cjk, DEFAULTS.ui_cjk),
  );
  const [readingLatinFontId, setReadingLatinFontIdState] = useState(
    () => readLocal(LS_KEYS.reading_latin, DEFAULTS.reading_latin),
  );
  const [readingCjkFontId, setReadingCjkFontIdState] = useState(
    () => readLocal(LS_KEYS.reading_cjk, DEFAULTS.reading_cjk),
  );

  // 启动时从 engine settings 同步（跨设备恢复）。失败静默，localStorage 兜底。
  useEffect(() => {
    getSettings()
      .then((s) => {
        const f = s?.app?.fonts;
        if (!f) return;
        const updates: { role: FontRole; latinId: string; cjkId: string }[] = [];
        if (f.ui_latin_font_id && f.ui_latin_font_id !== uiLatinFontId) {
          setUiLatinFontIdState(f.ui_latin_font_id);
          writeLocal(LS_KEYS.ui_latin, f.ui_latin_font_id);
          updates.push({ role: "ui", latinId: f.ui_latin_font_id, cjkId: f.ui_cjk_font_id ?? uiCjkFontId });
        }
        if (f.ui_cjk_font_id && f.ui_cjk_font_id !== uiCjkFontId) {
          setUiCjkFontIdState(f.ui_cjk_font_id);
          writeLocal(LS_KEYS.ui_cjk, f.ui_cjk_font_id);
          updates.push({ role: "ui", latinId: f.ui_latin_font_id ?? uiLatinFontId, cjkId: f.ui_cjk_font_id });
        }
        if (f.reading_latin_font_id && f.reading_latin_font_id !== readingLatinFontId) {
          setReadingLatinFontIdState(f.reading_latin_font_id);
          writeLocal(LS_KEYS.reading_latin, f.reading_latin_font_id);
          updates.push({ role: "reading", latinId: f.reading_latin_font_id, cjkId: f.reading_cjk_font_id ?? readingCjkFontId });
        }
        if (f.reading_cjk_font_id && f.reading_cjk_font_id !== readingCjkFontId) {
          setReadingCjkFontIdState(f.reading_cjk_font_id);
          writeLocal(LS_KEYS.reading_cjk, f.reading_cjk_font_id);
          updates.push({ role: "reading", latinId: f.reading_latin_font_id ?? uiLatinFontId, cjkId: f.reading_cjk_font_id });
        }
        // 合并 per-role 的最后一次 update 去执行 applyCSS（避免同 role 多次 setProperty）
        const lastByRole = new Map<FontRole, { latinId: string; cjkId: string }>();
        for (const u of updates) lastByRole.set(u.role, { latinId: u.latinId, cjkId: u.cjkId });
        for (const [role, { latinId, cjkId }] of lastByRole) {
          applyCSS(role, latinId, cjkId);
        }
      })
      .catch(() => { /* engine 未 ready 或读取失败，localStorage 已兜底 */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 统一的 setter 工厂：每个 setter 都做 state + localStorage + CSS + engine settings 四同步。
  // engine 侧写的是"当前四个字段的最新值快照"，避免 merge 漏字段。
  const persist = useCallback(
    (latin: string, cjk: string, readingLatin: string, readingCjk: string) => {
      updateSettings({
        app: {
          fonts: {
            ui_latin_font_id: latin,
            ui_cjk_font_id: cjk,
            reading_latin_font_id: readingLatin,
            reading_cjk_font_id: readingCjk,
          },
        },
      }).catch(() => { /* engine 同步失败静默 */ });
    },
    [],
  );

  const setUiLatinFontId = useCallback(
    (id: string) => {
      setUiLatinFontIdState(id);
      writeLocal(LS_KEYS.ui_latin, id);
      applyCSS("ui", id, uiCjkFontId);
      persist(id, uiCjkFontId, readingLatinFontId, readingCjkFontId);
    },
    [uiCjkFontId, readingLatinFontId, readingCjkFontId, persist],
  );

  const setUiCjkFontId = useCallback(
    (id: string) => {
      setUiCjkFontIdState(id);
      writeLocal(LS_KEYS.ui_cjk, id);
      applyCSS("ui", uiLatinFontId, id);
      persist(uiLatinFontId, id, readingLatinFontId, readingCjkFontId);
    },
    [uiLatinFontId, readingLatinFontId, readingCjkFontId, persist],
  );

  const setReadingLatinFontId = useCallback(
    (id: string) => {
      setReadingLatinFontIdState(id);
      writeLocal(LS_KEYS.reading_latin, id);
      applyCSS("reading", id, readingCjkFontId);
      persist(uiLatinFontId, uiCjkFontId, id, readingCjkFontId);
    },
    [uiLatinFontId, uiCjkFontId, readingCjkFontId, persist],
  );

  const setReadingCjkFontId = useCallback(
    (id: string) => {
      setReadingCjkFontIdState(id);
      writeLocal(LS_KEYS.reading_cjk, id);
      applyCSS("reading", readingLatinFontId, id);
      persist(uiLatinFontId, uiCjkFontId, readingLatinFontId, id);
    },
    [uiLatinFontId, uiCjkFontId, readingLatinFontId, persist],
  );

  return {
    uiLatinFontId,
    uiCjkFontId,
    readingLatinFontId,
    readingCjkFontId,
    setUiLatinFontId,
    setUiCjkFontId,
    setReadingLatinFontId,
    setReadingCjkFontId,
  };
}
