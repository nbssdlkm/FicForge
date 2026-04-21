// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * React hook — 字体管理。
 * 封装 font-manager 的下载/注入逻辑，向 UI 组件提供状态。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useKV } from './useKV';
import { FONT_MANIFEST, SYSTEM_FONTS } from '../config/font-manifest';
import type { FontDownloadStatus } from '../api/font-manager';

export function useFontManager() {
  const [activeFontId, setActiveFontKV] = useKV('ficforge.fontFamily', 'system-serif');
  const [downloadStatus, setDownloadStatus] = useState<Record<string, FontDownloadStatus>>({});
  const [fontCSSFamily, setFontCSSFamily] = useState(() => {
    const sys = SYSTEM_FONTS.find(f => f.id === 'system-serif');
    return sys?.stack ?? 'serif';
  });
  const [isInitialized, setIsInitialized] = useState(false);
  const initRef = useRef(false);

  // Load initial download status and inject active font
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    (async () => {
      try {
        const { get_downloaded_fonts, get_font_css_family, init_active_font } = await import('../api/font-manager');

        const downloaded = await get_downloaded_fonts();
        const status: Record<string, FontDownloadStatus> = {};
        for (const entry of FONT_MANIFEST) {
          status[entry.id] = downloaded[entry.id] ? 'downloaded' : 'not-downloaded';
        }
        setDownloadStatus(status);

        // Inject @font-face for the active font if downloaded
        await init_active_font(activeFontId);
        setFontCSSFamily(get_font_css_family(activeFontId));
      } catch {
        // Non-critical — system fonts still work
      }
      setIsInitialized(true);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update CSS family when active font changes
  useEffect(() => {
    (async () => {
      try {
        const { get_font_css_family, init_active_font, get_downloaded_fonts } = await import('../api/font-manager');

        // Only inject if it's a manifest font that's downloaded
        const sys = SYSTEM_FONTS.find(f => f.id === activeFontId);
        if (!sys) {
          const downloaded = await get_downloaded_fonts();
          if (downloaded[activeFontId]) {
            await init_active_font(activeFontId);
          }
        }

        setFontCSSFamily(get_font_css_family(activeFontId));
      } catch {
        // Fall back to system serif
        const sys = SYSTEM_FONTS.find(f => f.id === activeFontId);
        setFontCSSFamily(sys?.stack ?? SYSTEM_FONTS[0].stack);
      }
    })();
  }, [activeFontId]);

  const setActiveFontId = useCallback((id: string) => {
    setActiveFontKV(id);
  }, [setActiveFontKV]);

  const downloadFont = useCallback(async (fontId: string) => {
    const entry = FONT_MANIFEST.find(f => f.id === fontId);
    if (!entry) {
      setDownloadStatus(prev => ({ ...prev, [fontId]: 'error' }));
      return;
    }

    setDownloadStatus(prev => ({ ...prev, [fontId]: 'downloading' }));
    try {
      const { download_font, inject_font_face } = await import('../api/font-manager');
      await download_font(entry);
      await inject_font_face(entry);
      setDownloadStatus(prev => ({ ...prev, [fontId]: 'downloaded' }));
    } catch {
      setDownloadStatus(prev => ({ ...prev, [fontId]: 'error' }));
    }
  }, []);

  return {
    activeFontId,
    setActiveFontId,
    downloadStatus,
    downloadFont,
    fontCSSFamily,
    isInitialized,
  };
}
