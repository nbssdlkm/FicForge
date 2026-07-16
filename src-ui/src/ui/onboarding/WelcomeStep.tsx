// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Button } from "../shared/Button";
import { BrandLockup } from "../shared/BrandLockup";
import { useTranslation } from "../../i18n/useAppTranslation";

// Welcome panel — Ex Libris: brand mark up top, hero in display italic,
// subtitle in serif, gold ornament separator between the hero and the CTA.
export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center justify-center gap-8 py-20 text-center">
      {/* Brand lockup — onboarding is a big moment, so it gets the hand-brushed wordmark */}
      <BrandLockup className="h-16 w-[148px]" />

      <div className="space-y-3">
        <h1 className="font-display text-4xl font-semibold tracking-[0.01em] text-text md:text-5xl">
          {t("onboarding.welcome.title")}
        </h1>
        <p className="mx-auto max-w-md font-serif text-lg leading-relaxed text-text/70">
          {t("onboarding.welcome.subtitle")}
        </p>
      </div>

      {/* Gold ornament — typographic drift between hero and CTA */}
      <div
        aria-hidden="true"
        className="select-none font-mono text-xs text-gold"
        style={{ letterSpacing: "1.2em", paddingLeft: "1.2em" }}
      >
        · · ·
      </div>

      <Button tone="accent" fill="solid" className="h-12 px-8 text-base" onClick={onNext}>
        {t("onboarding.welcome.start")}
      </Button>
    </div>
  );
}
