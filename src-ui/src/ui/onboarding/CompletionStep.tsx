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
    <div className="max-w-lg mx-auto space-y-8 py-12 text-center">
      <div className="flex justify-end">
        <StepIndicator current={4} total={4} />
      </div>

      <h2 className="text-2xl font-serif font-bold">{t('onboarding.completion.title')}</h2>

      <div className="space-y-3 text-left bg-surface/50 rounded-xl p-6 border border-black/5 dark:border-white/5">
        <div className="flex items-center gap-3 text-sm">
          <CheckCircle2 size={18} className="text-green-500 shrink-0" />
          <span>{t('onboarding.completion.modelConnected')}</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {fandomName ? (
            <>
              <CheckCircle2 size={18} className="text-green-500 shrink-0" />
              <span>{t('onboarding.completion.fandomCreated', { name: fandomName })}</span>
            </>
          ) : (
            <>
              <SkipForward size={18} className="text-text/30 shrink-0" />
              <span className="text-text/50">{t('onboarding.completion.fandomSkipped')}</span>
            </>
          )}
        </div>
      </div>

      <div className="text-left space-y-2">
        <p className="text-sm font-medium text-text/70">{t('onboarding.completion.nextSteps')}</p>
        <ul className="text-sm text-text/50 space-y-1 list-disc list-inside">
          <li>{t('onboarding.completion.nextCreateAu')}</li>
          <li>{t('onboarding.completion.nextAddCharacters')}</li>
          <li>{t('onboarding.completion.nextImport')}</li>
        </ul>
      </div>

      <Button variant="primary" className="px-8 h-12 text-base" onClick={onComplete}>
        {t('onboarding.completion.enter')}
      </Button>
    </div>
  );
}
