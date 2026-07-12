// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * AuSettingsAdvancedSection —— 归档候选数徽标（最后一公里：让「整理旧剧情笔记」可发现）。
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuSettingsAdvancedSection } from "../AuSettingsAdvancedSection";

function renderSection(archiveCandidateCount: number | null | undefined) {
  return render(
    <AuSettingsAdvancedSection
      recalcing={false}
      handleRecalc={() => {}}
      handleRebuildIndex={() => {}}
      handleBackfillMemory={() => {}}
      handleArchiveFacts={() => {}}
      archiveCandidateCount={archiveCandidateCount}
    />,
  );
}

describe("AuSettingsAdvancedSection 归档候选徽标", () => {
  it("有候选（>0）→ 显示数字徽标 + 计数提示文案", () => {
    renderSection(5);
    expect(screen.getByText("5")).toBeInTheDocument(); // 徽标数字
    expect(screen.getByText(/有 5 条旧笔记可以整理归档/)).toBeInTheDocument();
  });

  it("零候选 → 无徽标，显示默认说明", () => {
    renderSection(0);
    // 默认说明在场，计数提示不在
    expect(screen.getByText(/把很久以前、标为次要的旧笔记收起/)).toBeInTheDocument();
    expect(screen.queryByText(/条旧笔记可以整理归档/)).toBeNull();
  });

  it("未扫/扫失败（null）→ 无徽标，默认说明", () => {
    renderSection(null);
    expect(screen.getByText(/把很久以前、标为次要的旧笔记收起/)).toBeInTheDocument();
    expect(screen.queryByText(/条旧笔记可以整理归档/)).toBeNull();
  });
});
