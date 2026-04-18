// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Copy, RefreshCw } from 'lucide-react';
import { Button } from '../shared/Button';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import { getLogger } from '../../api/engine-client';
import type { LogEntry } from '@ficforge/engine';

const LEVEL_COLORS: Record<string, string> = {
  debug: 'text-text/50',
  info: 'text-text/70',
  warn: 'text-warning',
  error: 'text-error',
};

const MAX_ENTRIES = 200;

export function DebugLogsSection() {
  const { t } = useTranslation();
  const { showToast } = useFeedback();
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<'all' | 'warn' | 'error'>('all');
  const [rawText, setRawText] = useState('');

  const loadLogs = useCallback(async () => {
    try {
      const logger = getLogger();
      await logger.flush();
      const text = await logger.readToday();
      setRawText(text);
      const lines = text.trim().split('\n').filter(Boolean);
      const parsed: LogEntry[] = [];
      for (const line of lines) {
        try {
          parsed.push(JSON.parse(line) as LogEntry);
        } catch {
          // skip bad lines
        }
      }
      // 最新的在前
      setEntries(parsed.reverse().slice(0, MAX_ENTRIES));
    } catch {
      setEntries([]);
      setRawText('');
    }
  }, []);

  const handleExpand = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    if (next) void loadLogs();
  }, [expanded, loadLogs]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      showToast(t('settings.debugLogs.copied'), 'success');
    } catch {
      showToast(t('settings.debugLogs.copyFailed'), 'error');
    }
  }, [rawText, showToast, t]);

  const filtered = levelFilter === 'all'
    ? entries
    : levelFilter === 'warn'
      ? entries.filter((e) => e.lvl === 'warn' || e.lvl === 'error')
      : entries.filter((e) => e.lvl === 'error');

  return (
    <div className="border-t border-black/10 pt-5 dark:border-white/10">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-sm font-bold text-text/90"
        onClick={handleExpand}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {t('settings.debugLogs.title')}
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as 'all' | 'warn' | 'error')}
              className="h-8 rounded-md border border-black/20 bg-background px-2 text-xs outline-none dark:border-white/20"
            >
              <option value="all">{t('settings.debugLogs.filterAll')}</option>
              <option value="warn">{t('settings.debugLogs.filterWarn')}</option>
              <option value="error">{t('settings.debugLogs.filterError')}</option>
            </select>
            <Button tone="neutral" fill="plain" size="sm" className="h-8 px-2 text-xs gap-1" onClick={() => void loadLogs()}>
              <RefreshCw size={12} /> {t('settings.debugLogs.refresh')}
            </Button>
            <Button tone="neutral" fill="plain" size="sm" className="h-8 px-2 text-xs gap-1" onClick={() => void handleCopy()} disabled={!rawText}>
              <Copy size={12} /> {t('settings.debugLogs.copy')}
            </Button>
            <span className="text-xs text-text/50">{t('settings.debugLogs.count', { count: filtered.length })}</span>
          </div>

          <div className="max-h-[40vh] overflow-y-auto rounded-md bg-black/5 p-2 font-mono text-xs leading-relaxed dark:bg-white/5">
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-text/50">{t('settings.debugLogs.empty')}</p>
            ) : (
              filtered.map((entry, i) => (
                <div key={i} className={`${LEVEL_COLORS[entry.lvl] ?? 'text-text/70'} border-b border-black/5 py-0.5 dark:border-white/5`}>
                  <span className="text-text/30">{entry.ts.slice(11, 19)}</span>
                  {' '}
                  <span className="font-semibold uppercase">{entry.lvl.padEnd(5)}</span>
                  {' '}
                  <span className="text-accent/70">[{entry.tag}]</span>
                  {' '}
                  {entry.msg}
                  {entry.ctx ? <span className="text-text/30"> {JSON.stringify(entry.ctx)}</span> : null}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
