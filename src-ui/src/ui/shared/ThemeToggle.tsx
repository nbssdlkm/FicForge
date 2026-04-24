// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import React, { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { Button } from './Button';
import { useTranslation } from '../../i18n/useAppTranslation';

// Ex Libris ships two themes — Light (parchment + sage drawer + olive accent)
// and Dark (charcoal + dark-sage drawer + dark-olive accent). The old mint
// theme was retired 2026-04; if a user's localStorage still holds
// 'mint' or any unknown value, readPersistedTheme falls back to 'warm'.
type Theme = 'warm' | 'night';
const THEME_KEY = 'ficforge_theme';
const VALID_THEMES: Theme[] = ['warm', 'night'];
const ALL_THEME_CLASSES = ['theme-warm', 'theme-night', 'theme-mint'] as const;

function readPersistedTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored && VALID_THEMES.includes(stored as Theme)) return stored as Theme;
  } catch { /* localStorage 不可用 */ }
  return 'warm';
}

// 页面加载时立即应用（避免闪烁），在 React 挂载前就生效
const initialTheme = readPersistedTheme();
document.documentElement.classList.add(`theme-${initialTheme}`);

export const ThemeToggle: React.FC = () => {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(readPersistedTheme);

  useEffect(() => {
    // Remove every possible theme class (including legacy 'theme-mint')
    // before applying the active one, so stale classes can't linger.
    ALL_THEME_CLASSES.forEach((cls) => document.documentElement.classList.remove(cls));
    document.documentElement.classList.add(`theme-${theme}`);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* best effort */ }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((current) => (current === 'warm' ? 'night' : 'warm'));
  };

  return (
    <Button tone="neutral" fill="plain" size="sm" onClick={toggleTheme} className="h-11 w-11 rounded-full p-0 md:h-10 md:w-10" title={t("shared.theme.toggle")}>
      {theme === 'warm' ? <Sun size={18} /> : <Moon size={18} />}
    </Button>
  );
};
