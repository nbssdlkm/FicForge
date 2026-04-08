// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** Dirty 章节解除时的 Facts 变更指令。 */

export interface FactChange {
  fact_id: string;
  action: "keep" | "update" | "deprecate";
  updated_fields: Record<string, unknown> | null;
}

export function createFactChange(partial: Pick<FactChange, "fact_id" | "action"> & Partial<FactChange>): FactChange {
  return {
    updated_fields: null,
    ...partial,
  };
}
