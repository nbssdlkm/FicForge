// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { BookOpen } from "lucide-react";
import { useTranslation } from "../i18n/useAppTranslation";

interface SplashScreenProps {
  visible: boolean;
}

export function SplashScreen({ visible }: SplashScreenProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-background transition-opacity duration-300 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div className="flex flex-col items-center text-center">
        <BookOpen size={56} strokeWidth={1.5} className="mb-5 text-accent" />
        <h1 className="font-serif text-3xl font-bold tracking-tight text-text">FicForge</h1>
        <p className="mt-1 text-base text-text/50">{t("app.splash.subtitle")}</p>
        <p className="mt-8 text-sm text-text/30">{t("app.splash.sloganZh")}</p>
        <p className="mt-1 text-xs italic text-text/30">{t("app.splash.sloganEn")}</p>
        <div className="mt-10 h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
      </div>
    </div>
  );
}
