// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState } from "react";
import { Spinner } from "../shared/Spinner";
import { Button } from "../shared/Button";
import { Input } from "../shared/Input";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "../../i18n/useAppTranslation";
import { createFandom } from "../../api/engine-client";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { StepIndicator } from "./StepIndicator";

export function CreateFandomStep({
  onNext,
  onPrev,
}: {
  onNext: (fandomName: string | null) => void;
  onPrev: () => void;
}) {
  const { t } = useTranslation();
  const createGuard = useActiveRequestGuard("create-fandom-step");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  const handleNext = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      onNext(null); // skip
      return;
    }
    const token = createGuard.start();
    setCreating(true);
    setError("");
    try {
      await createFandom(trimmed);
      if (createGuard.isStale(token)) return;
      onNext(trimmed);
    } catch (e) {
      if (createGuard.isStale(token)) return;
      setError(e instanceof Error && e.message ? e.message : t("error_messages.unknown"));
    } finally {
      if (!createGuard.isStale(token)) {
        setCreating(false);
      }
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-6 py-8">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl font-semibold text-accent">{t("onboarding.createFandom.title")}</h2>
        <StepIndicator current={3} total={4} />
      </div>

      <div className="space-y-1.5">
        <label className="font-sans text-[11px] font-medium uppercase tracking-[0.1em] text-ink-muted">
          {t("onboarding.createFandom.nameLabel")}
        </label>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          placeholder={t("onboarding.createFandom.namePlaceholder")}
          disabled={creating}
          autoFocus
        />
      </div>

      {error && (
        <div className="rounded-sm border border-error/30 bg-error/10 px-3 py-2 font-serif text-sm text-error">
          {error}
        </div>
      )}

      {/* Collapsible explanation */}
      <div className="rounded-sm border border-rule">
        <button
          className="flex w-full items-center gap-2 px-4 py-3 font-serif text-sm text-text/70 transition-colors hover:text-text"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t("onboarding.createFandom.whyFandom")}
        </button>
        {expanded && (
          <div className="whitespace-pre-line border-t border-rule px-4 pb-4 pt-3 font-serif text-xs leading-relaxed text-text/60">
            {t("onboarding.createFandom.fandomExplain")}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button tone="neutral" fill="plain" onClick={onPrev} disabled={creating}>
          {t("onboarding.common.prev")}
        </Button>
        <div className="flex gap-2">
          <Button tone="neutral" fill="plain" onClick={() => onNext(null)} disabled={creating}>
            {t("onboarding.createFandom.skip")}
          </Button>
          <Button tone="accent" fill="solid" onClick={handleNext} disabled={creating || !name.trim()}>
            {creating ? <Spinner size="sm" /> : t("onboarding.common.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
