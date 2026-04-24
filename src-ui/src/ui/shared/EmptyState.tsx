// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { ReactNode } from "react";

interface EmptyStateAction {
  key: string;
  element: ReactNode;
}

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  actions?: EmptyStateAction[];
  compact?: boolean;
}

// Ex Libris empty state — dashed parchment frame with a "bookplate" icon box
// (double-line border mirroring the brand seal), display italic title in accent,
// serif body. Feels like an empty drawer in a card catalog, not a dead 404.
export function EmptyState({
  icon,
  title,
  description,
  actions = [],
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-sm border border-dashed border-rule px-6 text-center ${
        compact ? "py-8" : "py-12"
      }`}
    >
      <div className="relative mb-3 flex h-12 w-12 items-center justify-center rounded-sm border-[1.5px] border-rule text-text/40">
        {icon}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-1 rounded-[2px] border border-rule opacity-50"
        />
      </div>
      <h3 className="font-display text-[22px] font-semibold leading-tight text-accent">
        {title}
      </h3>
      <div className="mt-2 max-w-xl whitespace-pre-line font-serif text-sm leading-6 text-text/70">
        {description}
      </div>
      {actions.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {actions.map((action) => (
            <div key={action.key}>{action.element}</div>
          ))}
        </div>
      )}
    </div>
  );
}
