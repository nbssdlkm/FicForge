// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useState } from 'react';
import { Plus, FileText, Trash2, ArchiveRestore, ChevronDown } from 'lucide-react';
import { Card } from '../shared/Card';
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

// Inset shadow that draws the two hairline gold rules on the drawer banner
// (spec: `design-system-exlibris-v2.html` §08 .sig-drawer).
const drawerGoldLines = {
  boxShadow: `inset 0 ${goldLine.topThick} 0 var(--color-gold-bright), inset 0 ${goldLine.bottomThick} 0 var(--color-gold-bright)`,
};

function callNo(index: number): string {
  return String(index + 1).padStart(3, '0');
}

// Persist which fandom drawers are collapsed across sessions. The list of
// fandoms can be long — mid-story users reasonably want to close ones they
// aren't currently working on. Keyed by `dir_name` (stable per fandom).
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
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore storage errors (quota, incognito, etc.) */
  }
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
      if (next.has(dirName)) next.delete(dirName);
      else next.add(dirName);
      writeCollapsed(next);
      return next;
    });
  }, []);

  return (
    <div className="space-y-5 md:space-y-7">
      {fandoms.map((fandom, fi) => {
        const isCollapsed = collapsed.has(fandom.dir_name);
        return (
          <section key={fandom.name}>
            {/* DRAWER BANNER — sage bg, gold top/bottom inset rules. Whole
                banner is the click target for collapse; action buttons
                inside stopPropagation so they don't toggle collapse.
                Uses `role="button"` instead of <button> so the nested Button
                components in the action row don't produce invalid HTML
                (<button> inside <button>). */}
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
              className="group relative w-full cursor-pointer select-none rounded-sm bg-drawer px-4 py-3 text-left transition-[filter] hover:brightness-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-bright focus-visible:ring-offset-2 focus-visible:ring-offset-background md:px-5 md:py-3.5"
              style={drawerGoldLines}
              aria-expanded={!isCollapsed}
              aria-label={fandom.name}
            >
              <div className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright">
                <span>FANDOM · № {callNo(fi)}</span>
                <span>
                  {fandom.aus.length} {t("library.cardType")}
                </span>
              </div>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
                <div className="flex items-baseline gap-2">
                  <h2 className="font-display text-xl font-medium leading-tight text-inv-text md:text-[22px]">
                    {fandom.name}
                  </h2>
                  <ChevronDown
                    size={14}
                    className={cn(
                      "shrink-0 text-gold-bright/80 transition-transform duration-200",
                      isCollapsed ? "-rotate-90" : "rotate-0",
                    )}
                  />
                </div>
                {/* Action row — stopPropagation on the wrapper so banner-click-
                    to-collapse doesn't fire when user taps an action */}
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
                    <FileText size={14} className="mr-1.5" /> {t("library.fandomSectionButton")}
                  </Button>
                  <Button
                    tone="neutral"
                    fill="plain"
                    size="sm"
                    onClick={() => onOpenAuModal(fandom.name, fandom.dir_name)}
                    disabled={mutating}
                    className="text-inv-text/85 hover:bg-gold-bright/10 hover:text-inv-text"
                  >
                    <Plus size={14} className="mr-1" /> {t("library.createAuButton")}
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
            </div>

            {/* AU GRID — open-air, no wrapping frame. Hidden when collapsed.
                Uses aria-hidden for the collapsed state; CSS hides with
                `display: none` so tab-focus skips the cards too. */}
            {!isCollapsed && (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {fandom.aus.length === 0 ? (
                  <p className="col-span-full py-6 text-center font-serif text-sm text-ink-faint">
                    {t("library.emptyAuList")}
                  </p>
                ) : (
                  fandom.aus.map((au, ai) => (
                    <Card
                      key={`${fandom.dir_name}/${au.dir_name}`}
                      className="group relative cursor-pointer px-4 py-3.5 transition-colors hover:bg-rule-soft"
                      onClick={() =>
                        onNavigate(
                          'writer',
                          `${dataDir}/fandoms/${fandom.dir_name}/aus/${au.dir_name}`,
                        )
                      }
                    >
                      <div className="mb-1 flex items-start justify-between font-mono text-[9px] uppercase tracking-[0.1em]">
                        <span className="pt-2 text-gold">AU · № {callNo(ai)}</span>
                        <button
                          type="button"
                          // Mobile keeps a 44×44 touch target per WCAG 2.5.5;
                          // desktop collapses to a compact 28px icon that only
                          // appears on hover.
                          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] text-text/30 opacity-100 transition-opacity hover:bg-error/10 hover:text-error md:h-7 md:w-7 md:opacity-0 md:group-hover:opacity-100"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteAu(fandom.dir_name, fandom.name, au.dir_name, au.name);
                          }}
                          title={t("common.actions.delete")}
                          disabled={mutating}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <h3 className="mt-1 font-display text-lg font-medium leading-tight text-text">
                        {au.name}
                      </h3>
                      <div className="mt-3 flex items-center font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                        <span>{t("library.cardType")}</span>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
