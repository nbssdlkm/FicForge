// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import React, { useEffect, useState } from 'react';
import { Sun, Moon, Leaf } from 'lucide-react';
import { Button } from './Button';
import { useTranslation } from '../../i18n/useAppTranslation';

type Theme = 'warm' | 'mint' | 'night';

export const ThemeToggle: React.FC = () => {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>('warm');

  useEffect(() => {
    // Remove all theme classes and add the current one
    document.documentElement.classList.remove('theme-warm', 'theme-mint', 'theme-night');
    document.documentElement.classList.add(`theme-${theme}`);
  }, [theme]);

  const cycleTheme = () => {
    setTheme(current => {
      if (current === 'warm') return 'mint';
      if (current === 'mint') return 'night';
      return 'warm';
    });
  };

  return (
    <Button variant="ghost" size="sm" onClick={cycleTheme} className="h-11 w-11 rounded-full p-0 md:h-10 md:w-10" title={t("shared.theme.toggle")}>
      {theme === 'warm' && <Sun size={18} />}
      {theme === 'mint' && <Leaf size={18} />}
      {theme === 'night' && <Moon size={18} />}
    </Button>
  );
};
