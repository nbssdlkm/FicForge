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

// Ex Libris empty state — minimal: muted icon + display title + serif body +
// action row. No framing box around the whole state and no decorative icon
// container. The Library / Writer / Chapter-list pages already have their
// own chrome; the empty state just sits inside that chrome as typographic
// content, not a separate card.
export function EmptyState({
  icon,
  title,
  description,
  actions = [],
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center px-6 text-center ${
        compact ? "py-8" : "py-12"
      }`}
    >
      <div className="mb-3 text-ink-faint">{icon}</div>
      <h3 className="font-display text-[22px] font-semibold leading-tight text-accent">
        {title}
      </h3>
      <div className="mt-2 max-w-xl whitespace-pre-line font-serif text-sm leading-6 text-ink-muted">
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
