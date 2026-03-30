import { useTranslation } from '../../i18n/useAppTranslation';

export function StepIndicator({ current, total }: { current: number; total: number }) {
  const { t } = useTranslation();
  return (
    <div className="text-xs text-text/40 font-mono">
      {t('onboarding.common.step', { current, total })}
    </div>
  );
}
