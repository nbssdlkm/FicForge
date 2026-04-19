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
      <div className="mb-4 text-text/30">{icon}</div>
      <h3 className="font-serif text-xl font-semibold text-text">{title}</h3>
      <div className="mt-3 max-w-xl whitespace-pre-line text-sm leading-6 text-text/70">
        {description}
      </div>
      {actions.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {actions.map((action) => (
            <div key={action.key}>{action.element}</div>
          ))}
        </div>
      )}
    </div>
  );
}
