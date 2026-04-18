// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Button } from '../shared/Button';
import { Textarea } from '../shared/Input';
import { EmptyState } from '../shared/EmptyState';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { useTranslation } from '../../i18n/useAppTranslation';

export type AuSettingsPinnedSectionProps = {
  pinnedContext: string[];
  addPinnedRule: () => void;
  removePinnedRule: (idx: number) => void;
  updatePinnedRule: (idx: number, value: string) => void;
};

export function AuSettingsPinnedSection({
  pinnedContext,
  addPinnedRule,
  removePinnedRule,
  updatePinnedRule,
}: AuSettingsPinnedSectionProps) {
  const { t } = useTranslation();

  return (
    <section className="space-y-6">
      <h2 className="flex flex-col gap-3 border-l-4 border-error pl-3 text-lg font-sans font-bold text-error md:flex-row md:items-center md:justify-between">
         <span>{t("settings.sections.pinnedContext")}</span>
         <Button tone="neutral" fill="outline" size="sm" className="h-11 border-error/30 text-sm font-normal text-error hover:bg-error/10 md:h-8 md:text-xs" onClick={addPinnedRule}>
           <Plus size={14} className="mr-1"/> {t("common.actions.addPinnedRule")}
         </Button>
      </h2>
      <p className="text-sm text-text/70">{t("settings.story.pinnedDescription")}</p>

      <div className="space-y-3">
         {pinnedContext.length === 0 ? (
           <EmptyState
             compact
             icon={<AlertCircle size={28} />}
             title={t("settings.emptyPinned.title")}
             description={t("settings.emptyPinned.description")}
             actions={[
               {
                 key: "add-pinned",
                 element: (
                   <Button tone="accent" fill="solid" onClick={addPinnedRule}>
                     {t("common.actions.addPinnedRule")}
                   </Button>
                 ),
               },
             ]}
           />
         ) : (
           pinnedContext.map((pc, idx) => (
             <div key={idx} className="flex items-start gap-3 rounded-lg border border-error/20 bg-error/5 p-4">
               <span className="font-mono text-error/50 font-bold mt-1 text-sm">{idx+1}.</span>
               <Textarea className="min-h-[60px] flex-1 bg-background font-serif text-base md:text-sm" value={pc} onChange={e => updatePinnedRule(idx, e.target.value)} />
               <Button tone="neutral" fill="plain" size="sm" className="h-11 w-11 p-0 text-error/60 hover:bg-error/10 hover:text-error md:h-auto md:w-auto md:p-2" onClick={() => removePinnedRule(idx)}>
                 <Trash2 size={16}/>
               </Button>
             </div>
           ))
         )}
      </div>
    </section>
  );
}
