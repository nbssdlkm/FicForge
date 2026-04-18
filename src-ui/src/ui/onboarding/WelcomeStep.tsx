// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Button } from '../shared/Button';
import { BookOpen } from 'lucide-react';
import { useTranslation } from '../../i18n/useAppTranslation';

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center text-center gap-8 py-20">
      <BookOpen size={56} className="text-accent" />
      <div className="space-y-3">
        <h1 className="text-3xl font-serif font-bold">{t('onboarding.welcome.title')}</h1>
        <p className="text-text/60 text-lg max-w-md">{t('onboarding.welcome.subtitle')}</p>
      </div>
      <Button tone="accent" fill="solid" className="px-8 h-12 text-base" onClick={onNext}>
        {t('onboarding.welcome.start')}
      </Button>
    </div>
  );
}
