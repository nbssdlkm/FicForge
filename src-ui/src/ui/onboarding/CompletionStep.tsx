// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Button } from '../shared/Button';
import { CheckCircle2, SkipForward } from 'lucide-react';
import { useTranslation } from '../../i18n/useAppTranslation';
import { StepIndicator } from './StepIndicator';

export function CompletionStep({
  fandomName,
  onComplete,
}: {
  fandomName: string | null;
  onComplete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-lg space-y-7 py-12 text-center">
      <div className="flex justify-end">
        <StepIndicator current={4} total={4} />
      </div>

      <h2 className="font-display text-3xl font-semibold leading-tight text-accent">
        {t('onboarding.completion.title')}
      </h2>

      {/* Checklist card — parchment body, gold left spine (same Card motif as AU cards) */}
      <div className="space-y-3 rounded-r-sm border border-rule border-l-2 border-l-gold bg-surface p-5 text-left">
        <div className="flex items-center gap-3 font-serif text-sm">
          <CheckCircle2 size={18} className="shrink-0 text-success" />
          <span>{t('onboarding.completion.modelConnected')}</span>
        </div>
        <div className="flex items-center gap-3 font-serif text-sm">
          {fandomName ? (
            <>
              <CheckCircle2 size={18} className="shrink-0 text-success" />
              <span>{t('onboarding.completion.fandomCreated', { name: fandomName })}</span>
            </>
          ) : (
            <>
              <SkipForward size={18} className="shrink-0 text-text/30" />
              <span className="text-text/60">{t('onboarding.completion.fandomSkipped')}</span>
            </>
          )}
        </div>
      </div>

      {/* Next-steps list */}
      <div className="space-y-2 text-left">
        <p className="font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-gold">
          {t('onboarding.completion.nextSteps')}
        </p>
        <ul className="list-inside list-disc space-y-1 font-serif text-sm leading-relaxed text-text/65">
          <li>{t('onboarding.completion.nextCreateAu')}</li>
          <li>{t('onboarding.completion.nextAddCharacters')}</li>
          <li>{t('onboarding.completion.nextImport')}</li>
        </ul>
      </div>

      {/* Ethics notice — neutral card with hairline border */}
      <div className="space-y-3 rounded-sm border border-rule bg-surface p-5 text-left">
        <p className="font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-text/60">
          {t('ethics.onboardingTitle')}
        </p>
        <p className="whitespace-pre-line font-serif text-xs leading-relaxed text-text/60">
          {t('ethics.onboardingBody')}
        </p>
      </div>

      <div className="space-y-2">
        <Button tone="accent" fill="solid" className="h-12 px-8 text-base" onClick={onComplete}>
          {t('ethics.onboardingAcknowledge')}
        </Button>
        <p className="font-serif text-xs text-text/40">{t('ethics.onboardingConsent')}</p>
      </div>
    </div>
  );
}
