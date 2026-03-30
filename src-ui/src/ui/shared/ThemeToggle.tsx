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
    <Button variant="ghost" size="sm" onClick={cycleTheme} className="w-10 h-10 p-0 rounded-full" title={t("shared.theme.toggle")}>
      {theme === 'warm' && <Sun size={18} />}
      {theme === 'mint' && <Leaf size={18} />}
      {theme === 'night' && <Moon size={18} />}
    </Button>
  );
};
