// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * 剧情线面板 — Index of Threads（M8-B UI）。
 *
 * 第三层记忆（Thread）的用户入口：建线、看线、改进展、收束/搁置。
 * 设计取自 Claude Design 原型「Thread」（建在 FicForge DS 上）：
 * threads 按状态分组（sage drawer banner + gold 内嵌线），组内金色书脊卡。
 *
 * 本屏（slice 1）：列表 + 建线 + 改线 + 删线。节点详情视图（把 Fact 挂到线上、
 * 标 thread_role）是下一块 ThreadDetail。成员关系单一真相源 = fact.thread_ids。
 */

import { useState, useEffect, useMemo } from 'react';
import { Spinner } from '../shared/Spinner';
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { EmptyState } from '../shared/EmptyState';
import { Modal } from '../shared/Modal';
import { goldLine } from '../shared/tokens';
import { Spline, Plus, Trash2 } from 'lucide-react';
import { ThreadDetail } from './ThreadDetail';
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import { useFeedback } from '../../hooks/useFeedback';
import { useTranslation } from '../../i18n/useAppTranslation';
import {
  listThreads, addThread, updateThread, removeThread,
  listFacts, type FactInfo,
} from '../../api/engine-client';
import { ThreadStatus } from '@ficforge/engine';
import type { Thread } from '@ficforge/engine';

// Inset gold rules on the sage drawer banner — same recipe as Modal.tsx / LibraryFandomSections.
const headerGoldLines = {
  boxShadow: `inset 0 ${goldLine.topThick} 0 var(--color-gold-bright), inset 0 ${goldLine.bottomThick} 0 var(--color-gold-bright)`,
};

// 状态分组展示顺序：进行中 → 搁置 → 已收束。
const STATUS_ORDER: ThreadStatus[] = [ThreadStatus.ACTIVE, ThreadStatus.DORMANT, ThreadStatus.RESOLVED];

type DraftThread = { id?: string; title: string; description: string; state: string; status: ThreadStatus };

const emptyDraft = (): DraftThread => ({ title: '', description: '', state: '', status: ThreadStatus.ACTIVE });

export const ThreadsLayout = ({ auPath }: { auPath: string }) => {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const loadGuard = useActiveRequestGuard(auPath);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [facts, setFacts] = useState<FactInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<DraftThread | null>(null);  // 建线 / 改线共用一个 modal
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);  // 进 ThreadDetail

  const load = async () => {
    if (!auPath) return;
    const token = loadGuard.start();
    setLoading(true);
    try {
      const [ts, fs] = await Promise.all([listThreads(auPath), listFacts(auPath)]);
      if (loadGuard.isStale(token)) return;
      setThreads(ts);
      setFacts(fs);
    } catch (err) {
      if (loadGuard.isStale(token)) return;
      showError(err, t('error_messages.unknown'));
    } finally {
      if (!loadGuard.isStale(token)) setLoading(false);
    }
  };

  useEffect(() => {
    setThreads([]); setFacts([]); setEditing(null); setSelectedThreadId(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auPath]);

  // 每条线挂了多少 Fact（成员关系真相源 = fact.thread_ids）。
  const nodeCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of facts) for (const tid of f.thread_ids ?? []) m[tid] = (m[tid] || 0) + 1;
    return m;
  }, [facts]);

  const grouped = useMemo(() => {
    const g: Record<string, Thread[]> = {};
    for (const th of threads) (g[th.status] ??= []).push(th);
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
    }
    return g;
  }, [threads]);

  const statusLabel = (s: ThreadStatus) => t(`threads.status.${s}`);

  const handleSave = async () => {
    if (!editing || !editing.title.trim()) return;
    const requestAuPath = auPath;
    setSaving(true);
    try {
      if (editing.id) {
        const existing = threads.find(th => th.id === editing.id);
        // 本地态可能已过期（线被外部删了）→ find 落空。不静默假成功，报错让用户知道（codex/workflow 审）。
        if (!existing) {
          showError(new Error('thread not found'), t('error_messages.unknown'));
          return;
        }
        await updateThread(requestAuPath, {
          ...existing,
          title: editing.title.trim(),
          description: editing.description,
          state: editing.state,
          status: editing.status,
        });
      } else {
        // 单次写入即定状态，避免「建成 active 再二次改状态、二次失败留重复线」（codex 审）。
        await addThread(requestAuPath, {
          title: editing.title.trim(),
          description: editing.description,
          state: editing.state,
          status: editing.status,
        });
      }
      if (loadGuard.isKeyStale(requestAuPath)) return;
      setEditing(null);
      await load();
    } catch (err) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(err, t('error_messages.unknown'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing?.id) return;
    const requestAuPath = auPath;
    setDeleting(true);
    try {
      await removeThread(requestAuPath, editing.id);
      if (loadGuard.isKeyStale(requestAuPath)) return;
      setEditing(null);
      setSelectedThreadId(null);  // 若在 ThreadDetail 删的正是当前线，立即退回 Index（不依赖 load 成功，审 MAJOR）
      await load();
    } catch (err) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(err, t('error_messages.unknown'));
    } finally {
      setDeleting(false);
    }
  };

  const selectedThread = selectedThreadId ? threads.find(th => th.id === selectedThreadId) : null;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {selectedThread ? (
        <ThreadDetail
          auPath={auPath}
          thread={selectedThread}
          facts={facts}
          onBack={() => setSelectedThreadId(null)}
          onEdit={(th) => setEditing({ id: th.id, title: th.title, description: th.description, state: th.state, status: th.status })}
          onChanged={load}
        />
      ) : (
      <>
      {/* 面板头 */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-rule bg-surface px-5 py-4 md:px-6">
        <div className="flex items-center gap-2.5 min-w-0">
          <Spline size={18} className="shrink-0 text-gold" />
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-semibold text-text">{t('threads.title')}</h1>
            <p className="truncate font-sans text-xs text-ink-faint">{t('threads.subtitle')}</p>
          </div>
        </div>
        <Button tone="accent" fill="solid" size="sm" className="shrink-0 gap-1 shadow-xs" onClick={() => setEditing(emptyDraft())}>
          <Plus size={15} /> {t('threads.newThread')}
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" className="text-accent" /></div>
        ) : threads.length === 0 ? (
          <EmptyState
            compact
            icon={<Spline size={28} />}
            title={t('threads.emptyTitle')}
            description={t('threads.emptyDesc')}
            actions={[{
              key: 'new-thread',
              element: <Button tone="accent" fill="solid" size="sm" onClick={() => setEditing(emptyDraft())}>{t('threads.newThread')}</Button>,
            }]}
          />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-7">
            {STATUS_ORDER.filter(s => (grouped[s]?.length ?? 0) > 0).map(status => (
              <section key={status} className="flex flex-col gap-3" aria-labelledby={`thread-group-${status}`}>
                {/* sage drawer banner — gold 内嵌线，同 Modal / Library */}
                <div className="rounded-sm bg-drawer px-4 py-2.5 text-inv-text" style={headerGoldLines}>
                  <span id={`thread-group-${status}`} className="font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-gold-bright">
                    {statusLabel(status)} · {grouped[status].length}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {grouped[status].map(th => {
                    const count = nodeCount[th.id] ?? 0;
                    return (
                      <button
                        key={th.id}
                        type="button"
                        onClick={() => setSelectedThreadId(th.id)}
                        className="group relative flex flex-col gap-2 rounded-sm border border-rule bg-surface py-3 pl-5 pr-4 text-left transition-colors hover:border-gold/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-gold-bright"
                      >
                        {/* 金色书脊 */}
                        <span aria-hidden className="pointer-events-none absolute left-0 top-3 bottom-3 w-[2px] rounded-r bg-gold opacity-65" />
                        <h3 className="font-display text-base font-medium leading-tight text-text">{th.title}</h3>
                        {th.state ? (
                          <p className="line-clamp-2 font-serif text-[13px] leading-snug text-ink-muted">{th.state}</p>
                        ) : (
                          <p className="font-sans text-xs italic text-ink-faint">{t('threads.noState')}</p>
                        )}
                        <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                          {t('threads.nodeCount', { count })}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      </>
      )}

      {/* 建线 / 改线 modal */}
      <Modal
        isOpen={!!editing}
        onClose={saving || deleting ? () => {} : () => setEditing(null)}
        title={editing?.id ? t('threads.editTitle') : t('threads.newThread')}
      >
        {editing ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="block text-sm font-bold text-text/90">{t('threads.field.title')} *</label>
              <Input
                autoFocus
                aria-label={t('threads.field.title')}
                value={editing.title}
                onChange={e => setEditing({ ...editing, title: e.target.value })}
                placeholder={t('threads.field.titlePlaceholder')}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-bold text-text/90">{t('threads.field.state')}</label>
              <Textarea
                aria-label={t('threads.field.state')}
                value={editing.state}
                onChange={e => setEditing({ ...editing, state: e.target.value })}
                placeholder={t('threads.field.statePlaceholder')}
                className="min-h-[72px] bg-surface/50"
              />
              <p className="text-xs text-text/50">{t('threads.field.stateHint')}</p>
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-bold text-text/90">{t('threads.field.description')}</label>
              <Textarea
                aria-label={t('threads.field.description')}
                value={editing.description}
                onChange={e => setEditing({ ...editing, description: e.target.value })}
                placeholder={t('threads.field.descriptionPlaceholder')}
                className="min-h-[60px] bg-surface/50"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-bold text-text/90">{t('threads.field.status')}</label>
              <select
                aria-label={t('threads.field.status')}
                value={editing.status}
                onChange={e => setEditing({ ...editing, status: e.target.value as ThreadStatus })}
                className="h-11 w-full rounded-md border border-black/20 bg-surface px-3 text-base outline-hidden focus:ring-2 focus:ring-accent dark:border-white/20 md:h-10 md:text-sm"
              >
                {STATUS_ORDER.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-black/10 pt-4 dark:border-white/10">
              {editing.id ? (
                <Button tone="destructive" fill="plain" size="sm" className="gap-1" onClick={handleDelete} disabled={saving || deleting}>
                  {deleting ? <Spinner size="sm" /> : <><Trash2 size={14} /> {t('threads.delete')}</>}
                </Button>
              ) : <span />}
              <div className="flex items-center gap-2">
                <Button tone="neutral" fill="plain" onClick={() => setEditing(null)} disabled={saving || deleting}>{t('common.actions.cancel')}</Button>
                <Button tone="accent" fill="solid" onClick={handleSave} disabled={!editing.title.trim() || saving || deleting}>
                  {saving ? <Spinner size="sm" /> : t('common.actions.save')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
};
