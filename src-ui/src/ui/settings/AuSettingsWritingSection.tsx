// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Input, Textarea } from '../shared/Input';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';

export type AuSettingsWritingSectionProps = {
  perspective: string;
  setPerspective: (v: string) => void;
  emotionStyle: string;
  setEmotionStyle: (v: string) => void;
  chapterLength: number;
  setChapterLength: (v: number) => void;
  customInstructions: string;
  setCustomInstructions: (v: string) => void;
};

export function AuSettingsWritingSection({
  perspective,
  setPerspective,
  emotionStyle,
  setEmotionStyle,
  chapterLength,
  setChapterLength,
  customInstructions,
  setCustomInstructions,
}: AuSettingsWritingSectionProps) {
  const { t } = useTranslation();

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-sans font-bold text-accent border-l-4 border-accent pl-3">{t("settings.sections.writingStyle")}</h2>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
        <div className="flex flex-col gap-4">
           <div className="flex flex-col gap-2">
             <label className="text-sm font-bold text-text/90">{t("common.labels.perspective")}</label>
             <select value={perspective} onChange={e => setPerspective(e.target.value)} className="h-11 rounded-md border border-black/20 bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent dark:border-white/20 md:h-10 md:text-sm">
               <option value="third_person">{getEnumLabel("perspective", "third_person", "third_person")}</option>
               <option value="first_person">{getEnumLabel("perspective", "first_person", "first_person")}</option>
             </select>
           </div>
           <div className="flex flex-col gap-2">
             <label className="text-sm font-bold text-text/90">{t("common.labels.emotionStyle")}</label>
             <select value={emotionStyle} onChange={e => setEmotionStyle(e.target.value)} className="h-11 rounded-md border border-black/20 bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent dark:border-white/20 md:h-10 md:text-sm">
               <option value="implicit">{getEnumLabel("emotion_style", "implicit", "implicit")}</option>
               <option value="explicit">{getEnumLabel("emotion_style", "explicit", "explicit")}</option>
             </select>
           </div>
           <div className="flex flex-col gap-2">
             <label className="text-sm font-bold text-text/90">{t("common.labels.chapterLength")}</label>
             <Input type="number" value={chapterLength} onChange={e => setChapterLength(parseInt(e.target.value) || 2000)} className="h-11 font-mono text-base md:h-10 md:text-sm" />
             <p className="text-xs text-text/50">{t("settings.story.chapterLengthDescription")}</p>
           </div>
        </div>

        <div className="flex flex-col gap-2 flex-1">
           <label className="text-sm font-bold text-text/90">{t("common.labels.customInstructions")}</label>
           <Textarea
             value={customInstructions}
             onChange={e => setCustomInstructions(e.target.value)}
             placeholder={t("settings.story.customInstructionsPlaceholder")}
             className="min-h-[200px] resize-y bg-background p-4 font-serif text-base leading-relaxed md:text-sm"
           />
        </div>
      </div>
    </section>
  );
}
