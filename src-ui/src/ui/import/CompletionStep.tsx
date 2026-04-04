import { useEffect, useRef, useState } from 'react';
import { Button } from '../shared/Button';
import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { useTranslation } from '../../i18n/useAppTranslation';
import { extractFactsBatch } from '../../api/facts';
export function CompletionStep({
  auPath,
  totalChapters,
  charactersFound,
  onStartWriting,
}: {
  auPath: string;
  totalChapters: number;
  charactersFound: string[];
  onStartWriting: () => void;
}) {
  const { t } = useTranslation();
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState({ current: 0, total: 0 });
  const [extractDone, setExtractDone] = useState(false);
  const extractRequestIdRef = useRef(0);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      extractRequestIdRef.current += 1;
    };
  }, []);

  const handleExtract = async (count: number) => {
    const requestId = ++extractRequestIdRef.current;
    setExtracting(true);
    const start = Math.max(1, totalChapters - count + 1);
    const total = Math.min(count, totalChapters);
    setExtractProgress({ current: 0, total });

    const batchSize = 3;
    for (let batchStart = start; batchStart <= totalChapters; batchStart += batchSize) {
      if (requestId !== extractRequestIdRef.current || unmountedRef.current) {
        return;
      }
      const chapterNums: number[] = [];
      for (let ch = batchStart; ch <= Math.min(batchStart + batchSize - 1, totalChapters); ch++) {
        chapterNums.push(ch);
      }
      setExtractProgress({ current: Math.min(batchStart - start + batchSize, total), total });
      try {
        await extractFactsBatch(auPath, chapterNums);
      } catch {
        // 批次失败不阻断
      }
    }
    if (requestId !== extractRequestIdRef.current || unmountedRef.current) {
      return;
    }
    setExtracting(false);
    setExtractDone(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <CheckCircle2 size={24} className="text-green-500" />
        <h3 className="text-lg font-bold">{t('import.completionTitle')}</h3>
      </div>

      <div className="bg-surface/50 rounded-xl p-5 border border-black/5 dark:border-white/5 space-y-2">
        <p className="text-sm">{t('import.stats', { chapters: totalChapters, chars: '—' })}</p>
        {charactersFound.length > 0 && (
          <p className="text-sm text-text/70">{t('import.charactersFound', { names: charactersFound.join(t('common.listSeparator')) })}</p>
        )}
      </div>

      {/* Facts extraction */}
      {!extractDone && (
        <div className="space-y-3">
          <p className="text-sm text-text/70">{t('import.factsPrompt')}</p>
          {extracting ? (
            <div className="flex items-center gap-2 text-sm text-accent">
              <Loader2 size={14} className="animate-spin" />
              {t('import.extractProgress', extractProgress)}
            </div>
          ) : (
            <div className="space-y-2">
              <Button variant="primary" size="sm" className="w-full justify-start" onClick={() => handleExtract(5)}>
                {t('import.extractRecent5')}
              </Button>
              <Button variant="secondary" size="sm" className="w-full justify-start" onClick={() => handleExtract(20)}>
                {t('import.extractRecent20')}
              </Button>
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setExtractDone(true)}>
                {t('import.extractLater')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Expectation management */}
      <div className="flex items-start gap-2 text-xs text-text/50 bg-black/3 dark:bg-white/3 rounded-md px-3 py-2">
        <AlertTriangle size={14} className="shrink-0 mt-0.5 text-warning" />
        <div>
          <div className="font-medium text-text/70">{t('import.importNotUnderstand')}</div>
          <div className="mt-1">{t('import.importNotUnderstandDesc')}</div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button variant="primary" onClick={onStartWriting} disabled={extracting}>
          {t('import.startWriting')}
        </Button>
      </div>
    </div>
  );
}
