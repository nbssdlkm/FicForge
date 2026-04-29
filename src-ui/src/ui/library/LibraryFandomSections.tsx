// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useMemo, useState } from 'react';
import { Plus, FileText, Trash2, ArchiveRestore, ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '../shared/Button';
import { type FandomInfo } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { goldLine } from '../shared/tokens';
import { cn } from '../shared/utils';

type LibraryFandomSectionsProps = {
  dataDir: string;
  fandoms: FandomInfo[];
  creatingFandom: boolean;
  creatingAu: boolean;
  deleting: boolean;
  onNavigate: (page: string, auPath?: string) => void;
  onOpenAuModal: (fandomName: string, fandomDir: string) => void;
  onOpenTrash: (fandomDir: string, fandomName: string) => void;
  onDeleteFandom: (fandomDir: string, fandomName: string) => void;
  onDeleteAu: (fandomDir: string, fandomName: string, auDir: string, auName: string) => void;
};

// Inset gold rules on the sage drawer banner — same recipe as Modal.tsx
// (design-system-exlibris-v2.html §08 .sig-drawer / library-mobile-exlibris-v13
// .drawer-banner).
const drawerGoldLines = {
  boxShadow: `inset 0 ${goldLine.topThick} 0 var(--color-gold-bright), inset 0 ${goldLine.bottomThick} 0 var(--color-gold-bright)`,
};

// Decorative call number. v13 uses real ones like "GE.07" (Genshin), but our
// data model has no such mapping — we synthesize one from the dir_name's
// first 2 letters + the fandom's 0-based index. It's purely a typographic
// flourish to make the drawer banner read like an actual card-catalog entry.
function fandomCallNo(dirName: string, index: number): string {
  const letters = dirName.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase();
  const prefix = letters.length === 2 ? letters : (letters + 'X').padEnd(2, 'X');
  return `${prefix}.${String(index + 1).padStart(2, '0')}`;
}

// AU call number = parent fandom call no + AU's 1-based index (zero-padded).
function auCallNo(parentCallNo: string, auIndex: number): string {
  return `${parentCallNo}.${String(auIndex + 1).padStart(2, '0')}`;
}

// localStorage key for collapsed-fandom state. Keyed by dir_name.
const COLLAPSED_KEY = 'ficforge.library.collapsedFandoms';

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeCollapsed(set: Set<string>) {
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

export function LibraryFandomSections({
  dataDir,
  fandoms,
  creatingFandom,
  creatingAu,
  deleting,
  onNavigate,
  onOpenAuModal,
  onOpenTrash,
  onDeleteFandom,
  onDeleteAu,
}: LibraryFandomSectionsProps) {
  const { t } = useTranslation();
  const mutating = creatingFandom || creatingAu || deleting;

  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const toggleCollapse = useCallback((dirName: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dirName)) next.delete(dirName); else next.add(dirName);
      writeCollapsed(next);
      return next;
    });
  }, []);

  // Per-fandom totals for the banner top row ("N AU · M 章")
  const totals = useMemo(() => {
    return fandoms.map((f) => ({
      auCount: f.aus.length,
      chapterTotal: f.aus.reduce((sum, au) => sum + (au.chapter_count ?? 0), 0),
      mostRecent: f.aus[0] ?? null, // approximation — we don't track "last opened"
    }));
  }, [fandoms]);

  return (
    <div className="space-y-5 md:space-y-6">
      {fandoms.map((fandom, fi) => {
        const isCollapsed = collapsed.has(fandom.dir_name);
        const callno = fandomCallNo(fandom.dir_name, fi);
        const { auCount, chapterTotal, mostRecent } = totals[fi];

        return (
          <section key={fandom.name}>
            {/* DRAWER BANNER — sage bg, gold inset rules. Whole banner is the
                collapse target; action row inside stops propagation. v13:
                <button> wrapping → invalid HTML, so we use div + role=button
                + onKeyDown. */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => toggleCollapse(fandom.dir_name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleCollapse(fandom.dir_name);
                }
              }}
              // v13 .drawer-banner: padding 12px 14px on mobile. Slightly more
              // generous on desktop because the banner spans the full grid width.
              className="group relative w-full cursor-pointer select-none rounded-sm bg-drawer px-[14px] py-3 text-left transition-[filter] hover:brightness-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-bright focus-visible:ring-offset-2 focus-visible:ring-offset-background md:px-4 md:py-[14px]"
              style={drawerGoldLines}
              aria-expanded={!isCollapsed}
              aria-label={fandom.name}
            >
              {/* Top mono row: call no · INDEX (left) | AU count · chapter count (right) */}
              <div className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright">
                <span>{callno} · INDEX</span>
                <span className="flex items-center gap-2">
                  <span>{auCount} AU</span>
                  {chapterTotal > 0 && (
                    <>
                      <span className="opacity-60">·</span>
                      <span>{chapterTotal} 章</span>
                    </>
                  )}
                </span>
              </div>

              {/* Name row + actions on a single horizontal axis on desktop */}
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
                {/* v13 .drawer-banner .name .en: 19px / weight 500 — not 22/600.
                    Roman EB Garamond (no italic) per v13 spec. */}
                <h2 className="flex items-baseline gap-2 truncate font-display text-[19px] font-medium leading-tight text-inv-text">
                  <span className="truncate">{fandom.name}</span>
                  <ChevronDown
                    size={13}
                    aria-hidden="true"
                    className={cn(
                      'shrink-0 text-gold-bright/80 transition-transform duration-200',
                      isCollapsed ? '-rotate-90' : 'rotate-0',
                    )}
                  />
                </h2>

                <div
                  className="flex flex-wrap items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    tone="neutral"
                    fill="plain"
                    size="sm"
                    onClick={() => onNavigate('fandom_lore', `${dataDir}/fandoms/${fandom.dir_name}`)}
                    className="text-inv-text/85 hover:bg-gold-bright/10 hover:text-inv-text"
                  >
                    <FileText size={14} className="mr-1.5" /> {t('library.fandomSectionButton')}
                  </Button>
                  <Button
                    tone="neutral"
                    fill="plain"
                    size="sm"
                    onClick={() => onOpenAuModal(fandom.name, fandom.dir_name)}
                    disabled={mutating}
                    className="text-inv-text/85 hover:bg-gold-bright/10 hover:text-inv-text"
                  >
                    <Plus size={14} className="mr-1" /> {t('library.createAuButton')}
                  </Button>
                  <Button
                    tone="neutral"
                    fill="plain"
                    size="sm"
                    onClick={() => onOpenTrash(fandom.dir_name, fandom.name)}
                    title={t('trash.tooltip')}
                    className="h-8 w-8 p-0 text-inv-text/60 hover:bg-gold-bright/10 hover:text-gold-bright"
                  >
                    <ArchiveRestore size={14} />
                  </Button>
                  <Button
                    tone="destructive"
                    fill="plain"
                    size="sm"
                    onClick={() => onDeleteFandom(fandom.dir_name, fandom.name)}
                    disabled={mutating}
                    className="h-8 w-8 p-0 text-inv-text/40 hover:bg-error/20 hover:text-error"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>

              {/* Collapsed-only preview row — italic small print "最近 · {AU name}".
                  Mirrors v13 .drawer-banner-preview so the user sees what's
                  inside without expanding. We use the first AU as the
                  approximate "most recent" since we don't track open time. */}
              {isCollapsed && mostRecent && (
                // v13 .drawer-banner-preview: lbl is mono caps gold-bright,
                // recent is LXGW (not italic) drawer-fg. The container's
                // own italic from earlier was wrong — only specific elements
                // get italic in v13 (the "更新于…" timestamp, which we don't
                // have data for). Recent name stays roman.
                <div className="mt-2.5 flex items-center gap-2 border-t border-[color:var(--color-drawer-edge)] pt-2 font-serif text-xs text-inv-text/70">
                  <span className="font-sans font-medium uppercase tracking-[0.14em] text-gold-bright text-[9px]">
                    最近
                  </span>
                  <span className="truncate text-inv-text">{mostRecent.name}</span>
                </div>
              )}
            </div>

            {/* DRAWER CARDS — when expanded, the AU list flows directly under
                the banner without an outer frame (v13 desktop adaptation:
                drawer-cards on mobile have a 1px frame, but on a wider
                column-grid that frame reads as visual noise; the gold spine
                on each card is enough container affordance). */}
            {!isCollapsed && (
              fandom.aus.length === 0 ? (
                <p className="mt-3 px-4 py-6 text-center font-serif text-sm text-ink-faint">
                  {t('library.emptyAuList')}
                </p>
              ) : (
                <ol className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {fandom.aus.map((au, ai) => {
                    const auCn = auCallNo(callno, ai);
                    const chapters = au.chapter_count ?? 0;
                    const hasDirty = au.has_dirty ?? false;
                    return (
                      <li key={`${fandom.dir_name}/${au.dir_name}`}>
                        <article
                          onClick={() =>
                            onNavigate(
                              'writer',
                              `${dataDir}/fandoms/${fandom.dir_name}/aus/${au.dir_name}`,
                            )
                          }
                          // v13 .au-card padding 12px 14px 12px 16px — left
                          // padding bigger to make room for the gold spine.
                          className="group relative cursor-pointer bg-surface py-3 pl-4 pr-[14px] transition-colors hover:bg-rule-soft"
                        >
                          {/* Gold spine — 2px tall pseudo-element echoing the
                              v13 .au-card::before. Uses absolute + opacity so
                              the spine doesn't disturb card padding. */}
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute left-0 top-3 bottom-3 w-[2px] bg-gold opacity-65"
                          />

                          {/* Row 1 — call no + delete affordance (which v13
                              didn't show, but our app needs it; placed where
                              v13 had `updated` to keep the same alignment). */}
                          <div className="mb-1 flex items-baseline justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.1em]">
                            <span className="text-gold">{auCn}</span>
                            <button
                              type="button"
                              className="-mr-1 -my-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[2px] text-text/30 opacity-100 transition-opacity hover:bg-error/10 hover:text-error md:h-6 md:w-6 md:opacity-0 md:group-hover:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteAu(fandom.dir_name, fandom.name, au.dir_name, au.name);
                              }}
                              title={t('common.actions.delete')}
                              disabled={mutating}
                              aria-label={t('common.actions.delete')}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>

                          {/* Row 2 — title (LXGW for CN / display for EN) +
                              optional Draft badge inline. */}
                          {/* Title — v13 .au-card .title: 16px font-weight 500
                              (LXGW for CN, EB Garamond for EN auto via stack). */}
                          <h3 className="font-display text-base font-medium leading-[1.3] text-text">
                            <span className="align-middle">{au.name}</span>
                            {hasDirty && (
                              // v13 .draft-badge — exact: 8px tracking-[0.14em],
                              // padding 2/5, border-radius 1px, bg/border at
                              // gold rgba(168,131,51,0.16/0.28). The /15 + /28
                              // alpha gives the same washed-out gold tint.
                              <span className="ml-1.5 inline-block rounded-[1px] border border-gold/30 bg-gold/15 px-[5px] py-[2px] align-middle font-mono text-[8px] font-medium uppercase tracking-[0.14em] text-gold">
                                Draft
                              </span>
                            )}
                          </h3>

                          {/* Row 3 — chapter count + chevron. v13 shows
                              `<strong>N</strong> fics · words` with the
                              number in EB Garamond display weight. We mirror
                              that with chapter_count. */}
                          <div className="mt-2 flex items-baseline justify-between font-mono text-[11px] tracking-[0.04em] text-ink-muted">
                            <span>
                              {chapters > 0 ? (
                                <>
                                  <strong className="font-display text-sm font-semibold not-italic text-accent">
                                    {chapters}
                                  </strong>
                                  <span className="ml-1">章</span>
                                </>
                              ) : (
                                <span className="text-ink-faint">未开始</span>
                              )}
                            </span>
                            <ChevronRight size={14} className="text-ink-faint/70" />
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ol>
              )
            )}
          </section>
        );
      })}
    </div>
  );
}
