// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Button } from '../shared/Button';
import { Tag } from '../shared/Tag';
import { SettingsPanel } from '../settings/SettingsPanel';
import { Undo2, BookOpen, FileUp } from 'lucide-react';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';
import type { FactInfo } from '../../api/engine-client';

type ContextLayer = {
  key: string;
  label: string;
  percent: number;
  tokens: number;
  color: string;
};

export interface WriterSidePanelContentProps {
  mode: string;
  // Focus
  unresolvedFacts: FactInfo[];
  focusSelection: string[];
  onFocusToggle: (id: string) => void;
  onClearFocus: () => void;
  onContinueLastFocus: () => void;
  lastConfirmedFocus: string[];
  // Memory
  budgetReport: any;
  contextLayers: ContextLayer[];
  layerSum: number;
  // Session params (for SettingsPanel)
  sessionModel: string;
  onModelChange: (v: string) => void;
  sessionTemp: number;
  onTempChange: (v: number) => void;
  sessionTopP: number;
  onTopPChange: (v: number) => void;
  onSaveGlobal: () => Promise<void>;
  onSaveAu: () => Promise<void>;
  // Reading prefs
  fontSize: number;
  onFontSizeChange: (v: number) => void;
  lineHeight: number;
  onLineHeightChange: (v: number) => void;
  // Navigation
  onNavigate: (page: string) => void;
  // Mobile extras
  onUndoClick?: () => void;
  onExportClick?: () => void;
  onClose?: () => void;
  currentChapter?: number;
  writeActionsDisabled?: boolean;
  isMobile?: boolean;
}

export const WriterSidePanelContent = ({
  mode,
  unresolvedFacts,
  focusSelection,
  onFocusToggle,
  onClearFocus,
  onContinueLastFocus,
  lastConfirmedFocus,
  budgetReport,
  contextLayers,
  layerSum,
  sessionModel,
  onModelChange,
  sessionTemp,
  onTempChange,
  sessionTopP,
  onTopPChange,
  onSaveGlobal,
  onSaveAu,
  fontSize,
  onFontSizeChange,
  lineHeight,
  onLineHeightChange,
  onNavigate,
  onUndoClick,
  onExportClick,
  onClose,
  currentChapter,
  writeActionsDisabled,
  isMobile,
}: WriterSidePanelContentProps) => {
  const { t } = useTranslation();

  return (
    <div className={isMobile ? 'space-y-6' : 'flex-1 overflow-y-auto p-5 space-y-8'}>
      {mode === 'write' ? (
        <>
          <section>
            {isMobile ? (
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wide text-text/70">{t('writer.focusTitle')}</h3>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="text-xs" onClick={onClearFocus} disabled={focusSelection.length === 0}>
                    {t('writer.freeWrite')}
                  </Button>
                  {lastConfirmedFocus.length > 0 ? (
                    <Button variant="ghost" size="sm" className="text-xs" onClick={onContinueLastFocus}>
                      {t('focus.continueLastChapter')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                <h3 className="text-xs font-sans font-medium mb-1 text-text/70 tracking-wide uppercase">{t('writer.focusTitle')}</h3>
                <p className="text-[10px] text-text/35 mb-3">{t('writer.focusHint')}</p>
              </>
            )}

            {isMobile ? (
              <div className="space-y-2">
                {unresolvedFacts.length === 0 ? (
                  <p className="text-sm text-text/45">{t('facts.noSearchResultDescription')}</p>
                ) : unresolvedFacts.map((fact) => {
                  const isHigh = fact.narrative_weight === 'high';
                  return (
                    <label key={fact.id} className={`flex items-start gap-3 rounded-xl border p-3 ${focusSelection.includes(String(fact.id)) ? 'border-accent/30 bg-accent/5' : 'border-black/10 bg-surface/35 dark:border-white/10'}`}>
                      <input type="checkbox" className="mt-1 accent-accent" checked={focusSelection.includes(String(fact.id))} onChange={() => onFocusToggle(String(fact.id))} />
                      <div className="space-y-2">
                        <p className="text-sm text-text/85">{fact.content_clean}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Tag variant="warning">{getEnumLabel('fact_status', 'unresolved', 'unresolved')}</Tag>
                          {isHigh ? <Tag variant="info">{t('focus.recommended')}</Tag> : null}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-2 mb-2">
                  <Button variant="ghost" size="sm" className="text-xs" onClick={onClearFocus} disabled={focusSelection.length === 0}>
                    {t('writer.freeWrite')}
                  </Button>
                  {lastConfirmedFocus.length > 0 && (
                    <Button variant="ghost" size="sm" className="text-xs" onClick={onContinueLastFocus}>
                      {t('focus.continueLastChapter')}
                    </Button>
                  )}
                </div>
                {unresolvedFacts.map((fact) => {
                  const isHigh = fact.narrative_weight === 'high';
                  return (
                    <label key={fact.id} className={`flex items-start gap-2 p-2 rounded-md hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer border transition-colors ${focusSelection.includes(String(fact.id)) ? 'border-accent/30 bg-accent/5' : 'border-transparent hover:border-black/5 dark:hover:border-white/5'}`}>
                      <input type="checkbox" className="mt-1 accent-accent" checked={focusSelection.includes(String(fact.id))} onChange={() => onFocusToggle(String(fact.id))} />
                      <div className="flex flex-col">
                        <span className="text-sm">{fact.content_clean}</span>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <Tag variant="warning" className="w-fit">{getEnumLabel('fact_status', 'unresolved', 'unresolved')}</Tag>
                          {isHigh && <Tag variant="info" className="w-fit text-[10px]">{t('focus.recommended')}</Tag>}
                        </div>
                      </div>
                    </label>
                  );
                })}
                {focusSelection.length >= 2 && (
                  <p className="text-[10px] text-text/40 px-2">{t('focus.maxTwo')}</p>
                )}
              </div>
            )}
          </section>

          <section>
            <h3 className={isMobile ? 'mb-3 text-xs font-medium uppercase tracking-wide text-text/70' : 'text-xs font-sans font-medium mb-1 text-text/70 tracking-wide uppercase'}>{t('writer.memoryPanel')}</h3>
            {!budgetReport ? (
              <p className={isMobile ? 'text-sm text-text/45' : 'text-[10px] text-text/35'}>{t('writer.memoryPanelHint')}</p>
            ) : (
              <div className="space-y-3">
                {contextLayers.map((item) => (
                  <div key={item.key} className="space-y-1">
                    <div className={`flex items-center justify-between ${isMobile ? 'text-sm' : 'text-xs'}`}>
                      <span className="text-text/70">{item.label}</span>
                      <span className={`font-mono text-text/50`}>{item.tokens} tok</span>
                    </div>
                    <div className={`${isMobile ? 'h-2' : 'h-1.5'} overflow-hidden rounded-full bg-black/10 dark:bg-white/10 flex`}>
                      <div className={`${item.color} h-full rounded-full`} style={{ width: `${Math.min(item.percent, 100)}%` }} />
                    </div>
                  </div>
                ))}
                {!isMobile && (
                  <div className="text-[10px] text-text/35 mt-1">
                    {t('writer.memoryTotal', { tokens: layerSum })}
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      ) : !isMobile ? (
        <section className="rounded-2xl border border-black/10 bg-background/50 p-4 dark:border-white/10">
          <h3 className="mb-2 text-xs font-sans font-medium uppercase tracking-wide text-text/70">{t('settingsMode.sideTitle')}</h3>
          <p className="text-sm leading-relaxed text-text/65">{t('settingsMode.sideDescription')}</p>
        </section>
      ) : null}

      <section className={isMobile ? 'border-t border-black/10 pt-5 dark:border-white/10' : 'pt-4 border-t border-black/10 dark:border-white/10'}>
        <SettingsPanel
          model={sessionModel}
          onModelChange={onModelChange}
          temperature={sessionTemp}
          onTemperatureChange={onTempChange}
          topP={sessionTopP}
          onTopPChange={onTopPChange}
          onSaveGlobal={onSaveGlobal}
          onSaveAu={onSaveAu}
        />
      </section>

      <section>
        <h3 className={isMobile ? 'mb-3 text-xs font-medium uppercase tracking-wide text-text/70' : 'text-xs font-sans font-medium mb-3 text-text/70 tracking-wide uppercase'}>{t('writer.readingPrefs')}</h3>
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text/70">{t('writer.fontSize')}</span>
              <span className="font-mono text-text/50">{fontSize}px</span>
            </div>
            <input type="range" min="14" max="24" step="1" value={fontSize} onChange={e => onFontSizeChange(parseInt(e.target.value))} className={`w-full accent-accent ${isMobile ? 'h-2' : 'h-1.5'}`} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text/70">{t('writer.lineHeight')}</span>
              <span className="font-mono text-text/50">{lineHeight.toFixed(1)}</span>
            </div>
            <input type="range" min="1.4" max="3.0" step="0.1" value={lineHeight} onChange={e => onLineHeightChange(parseFloat(e.target.value))} className={`w-full accent-accent ${isMobile ? 'h-2' : 'h-1.5'}`} />
          </div>
        </div>
      </section>

      {isMobile && (
        <section className="flex flex-wrap gap-2 border-t border-black/10 pt-5 dark:border-white/10">
          <Button variant="secondary" size="sm" onClick={onUndoClick} disabled={(currentChapter || 1) <= 1 || writeActionsDisabled}>
            <Undo2 size={16} className="mr-2" /> {t('common.actions.undoPreviousChapter')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => { onClose?.(); onNavigate('facts'); }}>
            <BookOpen size={16} className="mr-2" /> {t('writer.factsShortcut')}
          </Button>
          <Button variant="secondary" size="sm" onClick={onExportClick}>
            <FileUp size={16} className="mr-2" /> {t('writer.exportButtonTitle')}
          </Button>
        </section>
      )}
    </div>
  );
};
