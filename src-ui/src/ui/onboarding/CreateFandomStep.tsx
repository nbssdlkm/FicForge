// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useRef, useState } from 'react';
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useTranslation } from '../../i18n/useAppTranslation';
import { createFandom } from '../../api/engine-client';
import { StepIndicator } from './StepIndicator';

export function CreateFandomStep({
  onNext,
  onPrev,
}: {
  onNext: (fandomName: string | null) => void;
  onPrev: () => void;
}) {
  const { t } = useTranslation();
  const requestIdRef = useRef(0);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
    };
  }, []);

  const handleNext = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      onNext(null); // skip
      return;
    }
    const requestId = ++requestIdRef.current;
    setCreating(true);
    setError('');
    try {
      await createFandom(trimmed);
      if (requestId !== requestIdRef.current) return;
      onNext(trimmed);
    } catch (e: any) {
      if (requestId !== requestIdRef.current) return;
      setError(e.message || t('error_messages.unknown'));
    } finally {
      if (requestId === requestIdRef.current) {
        setCreating(false);
      }
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-6 py-8">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-serif font-bold">{t('onboarding.createFandom.title')}</h2>
        <StepIndicator current={3} total={4} />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-text/90">{t('onboarding.createFandom.nameLabel')}</label>
        <Input
          value={name}
          onChange={e => { setName(e.target.value); setError(''); }}
          placeholder={t('onboarding.createFandom.namePlaceholder')}
          disabled={creating}
          autoFocus
        />
      </div>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">
          {error}
        </div>
      )}

      {/* Collapsible explanation */}
      <div className="border border-black/10 dark:border-white/10 rounded-lg">
        <button
          className="flex items-center gap-2 w-full px-4 py-3 text-sm text-text/70 hover:text-text/90 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t('onboarding.createFandom.whyFandom')}
        </button>
        {expanded && (
          <div className="px-4 pb-4 text-xs text-text/50 leading-relaxed whitespace-pre-line border-t border-black/5 dark:border-white/5 pt-3">
            {t('onboarding.createFandom.fandomExplain')}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button tone="neutral" fill="plain" onClick={onPrev} disabled={creating}>{t('onboarding.common.prev')}</Button>
        <div className="flex gap-2">
          <Button tone="neutral" fill="plain" onClick={() => onNext(null)} disabled={creating}>{t('onboarding.createFandom.skip')}</Button>
          <Button tone="accent" fill="solid" onClick={handleNext} disabled={creating || !name.trim()}>
            {creating ? <Loader2 size={14} className="animate-spin" /> : t('onboarding.common.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
