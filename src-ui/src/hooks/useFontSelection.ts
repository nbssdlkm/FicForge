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

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FONT_MANIFEST,
  SYSTEM_FONT_ID,
  createFontsConfig,
  getFontById,
  resolveFontStack,
  scriptSlotOf,
  type FontEntry,
  type FontRole,
  type FontScript,
} from "@ficforge/engine";
import { getFontPreferences, updateSettings } from "../api/engine-client";

const LS_KEYS = {
  ui_latin: "ficforge_font_ui_latin",
  ui_cjk: "ficforge_font_ui_cjk",
  reading_latin: "ficforge_font_reading_latin",
  reading_cjk: "ficforge_font_reading_cjk",
} as const;

/**
 * 默认值的唯一真相源 = engine `createFontsConfig()`。
 * UI 层不再硬编码默认 id，避免双处维护不一致。
 */
const ENGINE_DEFAULTS = createFontsConfig();

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

/**
 * 一次性迁移：把 Phase 4 的旧 localStorage 单字段值（`ficforge_font_ui` /
 * `ficforge_font_reading`）映射到 Phase 7 的 4 字段新 keys。
 *
 * 分派规则复用 engine 的 `scriptSlotOf` —— 和 settings.yaml 迁移（见 file_settings.ts
 * 的 dictToFontsConfig）共享同一判据，避免两处逻辑漂移。
 * 新 key 已有值时不覆盖。迁移完删除旧 key，避免重复触发。
 */
function migrateLegacyLocalStorage(): void {
  const LEGACY = { ui: "ficforge_font_ui", reading: "ficforge_font_reading" };
  try {
    const legacyUi = localStorage.getItem(LEGACY.ui);
    const legacyReading = localStorage.getItem(LEGACY.reading);
    if (!legacyUi && !legacyReading) return;

    if (legacyUi) {
      const targetKey = scriptSlotOf(legacyUi) === "latin" ? LS_KEYS.ui_latin : LS_KEYS.ui_cjk;
      if (!localStorage.getItem(targetKey)) localStorage.setItem(targetKey, legacyUi);
      localStorage.removeItem(LEGACY.ui);
    }
    if (legacyReading) {
      const slot = scriptSlotOf(legacyReading);
      const targetKey = slot === "latin" ? LS_KEYS.reading_latin : LS_KEYS.reading_cjk;
      if (!localStorage.getItem(targetKey)) localStorage.setItem(targetKey, legacyReading);
      localStorage.removeItem(LEGACY.reading);
    }
  } catch { /* localStorage 不可用时静默 */ }
}
migrateLegacyLocalStorage();

// 模块顶层执行：页面首帧就读 localStorage 设 CSS var，避免 React mount 前的 FOUC。
applyCSS(
  "ui",
  readLocal(LS_KEYS.ui_latin, ENGINE_DEFAULTS.ui_latin_font_id),
  readLocal(LS_KEYS.ui_cjk, ENGINE_DEFAULTS.ui_cjk_font_id),
);
applyCSS(
  "reading",
  readLocal(LS_KEYS.reading_latin, ENGINE_DEFAULTS.reading_latin_font_id),
  readLocal(LS_KEYS.reading_cjk, ENGINE_DEFAULTS.reading_cjk_font_id),
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
    () => readLocal(LS_KEYS.ui_latin, ENGINE_DEFAULTS.ui_latin_font_id),
  );
  const [uiCjkFontId, setUiCjkFontIdState] = useState(
    () => readLocal(LS_KEYS.ui_cjk, ENGINE_DEFAULTS.ui_cjk_font_id),
  );
  const [readingLatinFontId, setReadingLatinFontIdState] = useState(
    () => readLocal(LS_KEYS.reading_latin, ENGINE_DEFAULTS.reading_latin_font_id),
  );
  const [readingCjkFontId, setReadingCjkFontIdState] = useState(
    () => readLocal(LS_KEYS.reading_cjk, ENGINE_DEFAULTS.reading_cjk_font_id),
  );

  // 启动时从 engine settings 同步（跨设备恢复）。失败静默，localStorage 兜底。
  // dictToFontsConfig 保证 settings.app.fonts 的 4 字段都是非空 string，
  // 这里直接按差异 diff 即可 —— 每 role 至多一次 setProperty。
  useEffect(() => {
    getFontPreferences()
      .then((fonts) => {
        const uiLatinChanged = fonts.ui_latin_font_id !== uiLatinFontId;
        const uiCjkChanged = fonts.ui_cjk_font_id !== uiCjkFontId;
        const readingLatinChanged = fonts.reading_latin_font_id !== readingLatinFontId;
        const readingCjkChanged = fonts.reading_cjk_font_id !== readingCjkFontId;

        if (uiLatinChanged) {
          setUiLatinFontIdState(fonts.ui_latin_font_id);
          writeLocal(LS_KEYS.ui_latin, fonts.ui_latin_font_id);
        }
        if (uiCjkChanged) {
          setUiCjkFontIdState(fonts.ui_cjk_font_id);
          writeLocal(LS_KEYS.ui_cjk, fonts.ui_cjk_font_id);
        }
        if (readingLatinChanged) {
          setReadingLatinFontIdState(fonts.reading_latin_font_id);
          writeLocal(LS_KEYS.reading_latin, fonts.reading_latin_font_id);
        }
        if (readingCjkChanged) {
          setReadingCjkFontIdState(fonts.reading_cjk_font_id);
          writeLocal(LS_KEYS.reading_cjk, fonts.reading_cjk_font_id);
        }
        if (uiLatinChanged || uiCjkChanged) {
          applyCSS("ui", fonts.ui_latin_font_id, fonts.ui_cjk_font_id);
        }
        if (readingLatinChanged || readingCjkChanged) {
          applyCSS("reading", fonts.reading_latin_font_id, fonts.reading_cjk_font_id);
        }
      })
      .catch(() => { /* engine 未 ready 或读取失败，localStorage 已兜底 */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 最新 4 字段的 ref —— 解决 setter 闭包 stale 问题。
   *
   * 场景：用户在同一 render 帧内快速连续调两个 setter（如两个下拉的 onChange
   * 紧挨着触发），第二个 setter 用的是第一个 setter 执行前的 state 闭包。
   * 如果 setter 用闭包值拼 persist 的 4 字段快照，第二次 persist 就会把第一次
   * 的改动覆盖丢失。
   *
   * 策略：render 后 useEffect 同步 state → ref（外部对齐），setter 内同步更新
   * ref（保证同一 event 链内下一次读到新值），persist 用 ref 读最新 4 字段。
   */
  const latestFontsRef = useRef({
    ui_latin: uiLatinFontId,
    ui_cjk: uiCjkFontId,
    reading_latin: readingLatinFontId,
    reading_cjk: readingCjkFontId,
  });
  useEffect(() => {
    latestFontsRef.current = {
      ui_latin: uiLatinFontId,
      ui_cjk: uiCjkFontId,
      reading_latin: readingLatinFontId,
      reading_cjk: readingCjkFontId,
    };
  }, [uiLatinFontId, uiCjkFontId, readingLatinFontId, readingCjkFontId]);

  const persist = useCallback(
    (snapshot: { ui_latin: string; ui_cjk: string; reading_latin: string; reading_cjk: string }) => {
      updateSettings({
        app: {
          fonts: {
            ui_latin_font_id: snapshot.ui_latin,
            ui_cjk_font_id: snapshot.ui_cjk,
            reading_latin_font_id: snapshot.reading_latin,
            reading_cjk_font_id: snapshot.reading_cjk,
          },
        },
      }).catch((err) => {
        // 本地 localStorage 已写入，用户感知无异常；但跨设备同步失效，debug 需要可见。
        console.warn("[useFontSelection] engine settings persist failed:", err);
      });
    },
    [],
  );

  const setUiLatinFontId = useCallback((id: string) => {
    setUiLatinFontIdState(id);
    writeLocal(LS_KEYS.ui_latin, id);
    const next = { ...latestFontsRef.current, ui_latin: id };
    latestFontsRef.current = next;
    applyCSS("ui", next.ui_latin, next.ui_cjk);
    persist(next);
  }, [persist]);

  const setUiCjkFontId = useCallback((id: string) => {
    setUiCjkFontIdState(id);
    writeLocal(LS_KEYS.ui_cjk, id);
    const next = { ...latestFontsRef.current, ui_cjk: id };
    latestFontsRef.current = next;
    applyCSS("ui", next.ui_latin, next.ui_cjk);
    persist(next);
  }, [persist]);

  const setReadingLatinFontId = useCallback((id: string) => {
    setReadingLatinFontIdState(id);
    writeLocal(LS_KEYS.reading_latin, id);
    const next = { ...latestFontsRef.current, reading_latin: id };
    latestFontsRef.current = next;
    applyCSS("reading", next.reading_latin, next.reading_cjk);
    persist(next);
  }, [persist]);

  const setReadingCjkFontId = useCallback((id: string) => {
    setReadingCjkFontIdState(id);
    writeLocal(LS_KEYS.reading_cjk, id);
    const next = { ...latestFontsRef.current, reading_cjk: id };
    latestFontsRef.current = next;
    applyCSS("reading", next.reading_latin, next.reading_cjk);
    persist(next);
  }, [persist]);

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
