// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useTranslation } from "../../i18n/useAppTranslation";

// Roman numeral for the Ex Libris catalog-card eyebrow. Only needs 1–4
// (onboarding is capped at 4 steps), but keep it tolerant of future expansion.
function toRoman(n: number): string {
  const pairs: Array<[number, string]> = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let v = n;
  let out = "";
  for (const [w, s] of pairs) {
    while (v >= w) {
      out += s;
      v -= w;
    }
  }
  return out || "—";
}

// "§ II · IV" — mono uppercase gold, echoes design-system-exlibris-v2.html
// §01 .section-head .num and the LibraryFandomSections call-no. treatment.
export function StepIndicator({ current, total }: { current: number; total: number }) {
  const { t } = useTranslation();
  return (
    <div
      className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold"
      aria-label={t("onboarding.common.step", { current, total })}
    >
      § {toRoman(current)} · {toRoman(total)}
    </div>
  );
}
