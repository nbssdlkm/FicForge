// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExtractReviewModal } from "../WriterModals";
import type { ExtractedFactCandidate } from "../../../api/engine-client";

// PD-5: 候选卡片显示 M9 自动归类标签（归入剧情线 / 跨章因果），让用户接受前看到 AI 归类。
// 标签纯读候选自带的 thread_ids / caused_by，无值则不渲染。
function baseCandidate(over: Partial<ExtractedFactCandidate> = {}): ExtractedFactCandidate {
  return {
    content_raw: "原文",
    content_clean: "沈砚取出残角",
    characters: ["沈砚"],
    narrative_weight: "high",
    status: "active",
    chapter: 5,
    ...over,
  };
}

function renderModal(candidate: ExtractedFactCandidate) {
  return render(
    <ExtractReviewModal
      isOpen
      onClose={() => {}}
      extractedCandidates={[candidate]}
      selectedExtractedKeys={["0"]}
      getCandidateKey={(_c, i) => String(i)}
      onToggleCandidate={() => {}}
      onSave={() => {}}
      savingExtracted={false}
    />,
  );
}

describe("ExtractReviewModal — M9 归类标签 (PD-5)", () => {
  it("shows 归入剧情线 + 跨章因果 tags when the candidate carries thread_ids / caused_by", () => {
    renderModal(baseCandidate({ thread_ids: ["t_vindicate"], caused_by: ["f_ch3_forgery"] }));
    expect(screen.getByText("归入剧情线")).toBeInTheDocument();
    expect(screen.getByText("跨章因果")).toBeInTheDocument();
  });

  it("hides both tags when the candidate has neither", () => {
    renderModal(baseCandidate());
    expect(screen.queryByText("归入剧情线")).toBeNull();
    expect(screen.queryByText("跨章因果")).toBeNull();
  });

  it("appends ×N count only when more than one", () => {
    renderModal(baseCandidate({ thread_ids: ["a", "b"], caused_by: ["x"] }));
    // thread: 2 → 带 ×2；caused_by: 1 → 纯标签无计数
    expect(screen.getByText("归入剧情线 ×2")).toBeInTheDocument();
    expect(screen.getByText("跨章因果")).toBeInTheDocument();
    expect(screen.queryByText("跨章因果 ×1")).toBeNull();
  });

  it("counts unique ids — duplicate thread_ids do not inflate ×N", () => {
    // inline-propose 路径只过滤不去重；UI 按唯一关系数显示，重复 id 不应让计数虚高。
    renderModal(baseCandidate({ thread_ids: ["t_a", "t_a"] }));
    expect(screen.getByText("归入剧情线")).toBeInTheDocument();
    expect(screen.queryByText("归入剧情线 ×2")).toBeNull();
  });
});

describe("ExtractReviewModal — M3 批一：知情标注入库前可见", () => {
  it("候选带 known_to/hidden_from → 确认卡上显示知情章", () => {
    renderModal(baseCandidate({ known_to: "reader_only", hidden_from: ["林晚月"] }));
    expect(screen.getByText("仅读者知")).toBeInTheDocument();
    expect(screen.getByText("瞒着林晚月")).toBeInTheDocument();
  });

  it("known_to=all / 无标注 → 不出知情章（避免每张卡长一排无信息徽章）", () => {
    renderModal(baseCandidate({ known_to: "all" }));
    expect(screen.queryByText("都知道")).toBeNull();
    expect(screen.queryByText(/仅.*知道/)).toBeNull();
  });
});
