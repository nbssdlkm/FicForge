// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useFontSelection — 字体偏好双层存储 hook。
 *
 * 双层：
 * - `localStorage`（`ficforge_font_ui` / `ficforge_font_reading`）—— 启动时同步读取，
 *   模块加载即可应用 CSS 变量，避免 FOUC（参考 ThemeToggle 的初始化模式）；
 * - `engine settings`（`app.fonts.{ui,reading}_font_id`）—— 异步读写，跨设备同步。
 *
 * 语义：localStorage 是"本设备的选择"，engine settings 是"云端真相"。启动时优先本地
 * 即显应用，engine settings 到位后若不一致则覆盖（后同步者为准）。
 */

import { useCallback, useEffect, useState } from "react";
import {
  FONT_MANIFEST,
  SYSTEM_FONT_ID,
  resolveFontStack,
  type FontRole,
} from "@ficforge/engine";
import { getSettings, updateSettings } from "../api/engine-client";

const LS_UI_KEY = "ficforge_font_ui";
const LS_READING_KEY = "ficforge_font_reading";

/** 默认：界面跟随系统、阅读用内置 CJK 楷体（和 engine createFontsConfig 保持同步）。 */
const DEFAULT_UI_FONT_ID = SYSTEM_FONT_ID;
const DEFAULT_READING_FONT_ID = "lxgw-wenkai-screen";

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

function applyCSS(role: FontRole, fontId: string): void {
  const cssVar = role === "ui" ? "--font-ui" : "--font-reading";
  document.documentElement.style.setProperty(cssVar, resolveFontStack(fontId, role));
}

// 模块顶层执行：页面首帧就读 localStorage 设 CSS var，避免 React mount 前的 FOUC。
// 与 App.css 的默认变量值配合：localStorage 有值则覆盖，否则保留 CSS 静态默认。
applyCSS("ui", readLocal(LS_UI_KEY, DEFAULT_UI_FONT_ID));
applyCSS("reading", readLocal(LS_READING_KEY, DEFAULT_READING_FONT_ID));

export interface FontOption {
  id: string;
  /** UI 下拉显示的名字（中英）。 */
  label: { zh: string; en: string };
}

/**
 * 当前可选字体列表：跟随系统 + 所有内置字体。
 *
 * Phase 5 会扩展为加上已下载的字体；Phase 4 只覆盖内置。
 */
export function listFontOptions(): FontOption[] {
  const options: FontOption[] = [
    { id: SYSTEM_FONT_ID, label: { zh: "跟随系统", en: "Follow system" } },
  ];
  for (const entry of FONT_MANIFEST) {
    if (entry.type === "builtin") {
      options.push({ id: entry.id, label: entry.displayName });
    }
  }
  return options;
}

export interface FontSelectionState {
  uiFontId: string;
  readingFontId: string;
  setUiFontId: (id: string) => void;
  setReadingFontId: (id: string) => void;
}

export function useFontSelection(): FontSelectionState {
  const [uiFontId, setUiFontIdState] = useState<string>(
    readLocal(LS_UI_KEY, DEFAULT_UI_FONT_ID),
  );
  const [readingFontId, setReadingFontIdState] = useState<string>(
    readLocal(LS_READING_KEY, DEFAULT_READING_FONT_ID),
  );

  // 启动时从 engine settings 同步（跨设备恢复）。失败静默，localStorage 兜底。
  useEffect(() => {
    getSettings()
      .then((s) => {
        const f = s?.app?.fonts;
        if (!f) return;
        if (f.ui_font_id && f.ui_font_id !== uiFontId) {
          setUiFontIdState(f.ui_font_id);
          applyCSS("ui", f.ui_font_id);
          writeLocal(LS_UI_KEY, f.ui_font_id);
        }
        if (f.reading_font_id && f.reading_font_id !== readingFontId) {
          setReadingFontIdState(f.reading_font_id);
          applyCSS("reading", f.reading_font_id);
          writeLocal(LS_READING_KEY, f.reading_font_id);
        }
      })
      .catch(() => { /* engine 未 ready 或 settings 读取失败，localStorage 兜底 */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setUiFontId = useCallback(
    (id: string) => {
      setUiFontIdState(id);
      applyCSS("ui", id);
      writeLocal(LS_UI_KEY, id);
      updateSettings({
        app: { fonts: { ui_font_id: id, reading_font_id: readingFontId } },
      }).catch(() => { /* engine 同步失败静默 */ });
    },
    [readingFontId],
  );

  const setReadingFontId = useCallback(
    (id: string) => {
      setReadingFontIdState(id);
      applyCSS("reading", id);
      writeLocal(LS_READING_KEY, id);
      updateSettings({
        app: { fonts: { ui_font_id: uiFontId, reading_font_id: id } },
      }).catch(() => { /* engine 同步失败静默 */ });
    },
    [uiFontId],
  );

  return { uiFontId, readingFontId, setUiFontId, setReadingFontId };
}
