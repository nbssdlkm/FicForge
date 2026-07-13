// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * deriveWriterDisplayState 纯派生函数测试（盲审长期债③）。
 *
 * 覆盖：header 章号口径（displayedChapter 修复回归）、busy 汇总、展示内容
 * 优先级、meta 回退链、预览截断、上下文分层条占比（零层剔除 + 最小 1%）。
 */

import { describe, expect, it } from "vitest";
import { deriveWriterDisplayState } from "../writer-display-state";
import type { StateInfo } from "../../../api/engine-client";
import type { DraftItem } from "../useWriterDraftController";

const t = (key: string) => key;

function makeDraft(overrides: Partial<DraftItem> = {}): DraftItem {
  return {
    label: "draft-1",
    content: "草稿正文",
    generatedWith: null,
    ...overrides,
  } as unknown as DraftItem;
}

function baseOptions(overrides: Partial<Parameters<typeof deriveWriterDisplayState>[0]> = {}) {
  return {
    auPath: "/data/fandoms/F/aus/A1",
    state: { au_id: "a1", current_chapter: 5 } as unknown as StateInfo,
    drafts: [] as DraftItem[],
    activeDraftIndex: 0,
    draftSummaries: {},
    isGenerating: false,
    isFinalizing: false,
    isDiscarding: false,
    isUndoing: false,
    isSettingsModeBusy: false,
    currentContent: "已定稿正文",
    streamText: "",
    generatedWith: null,
    budgetReport: null,
    sessionModel: "deepseek-v4-flash",
    locale: "zh-CN",
    t,
    ...overrides,
  };
}

describe("deriveWriterDisplayState · 章号口径", () => {
  it("空闲无草稿：显示最近定稿章（current_chapter - 1）—— 侧栏进入不显示「下一章」", () => {
    const d = deriveWriterDisplayState(baseOptions());
    expect(d.currentChapter).toBe(5);
    expect(d.displayedChapter).toBe(4);
  });

  it("current_chapter=1 的新 AU：displayedChapter 下限钳到 1", () => {
    const d = deriveWriterDisplayState(
      baseOptions({
        state: { current_chapter: 1 } as unknown as StateInfo,
      }),
    );
    expect(d.displayedChapter).toBe(1);
  });

  it("state 缺失：按第 1 章兜底", () => {
    const d = deriveWriterDisplayState(baseOptions({ state: null }));
    expect(d.currentChapter).toBe(1);
    expect(d.displayedChapter).toBe(1);
  });

  it.each([
    ["有草稿", { drafts: [makeDraft()] }],
    ["生成中", { isGenerating: true }],
    ["流式输出中", { streamText: "流式片段" }],
  ] as const)("%s：显示正在写的 current_chapter", (_label, overrides) => {
    const d = deriveWriterDisplayState(baseOptions(overrides as never));
    expect(d.displayedChapter).toBe(5);
  });
});

describe("deriveWriterDisplayState · busy 与内容", () => {
  it.each([
    "isGenerating",
    "isFinalizing",
    "isDiscarding",
    "isUndoing",
    "isSettingsModeBusy",
  ] as const)("%s=true → writeActionsDisabled", (flag) => {
    const d = deriveWriterDisplayState(baseOptions({ [flag]: true } as never));
    expect(d.writeActionsDisabled).toBe(true);
  });

  it("空闲：writeActionsDisabled=false", () => {
    expect(deriveWriterDisplayState(baseOptions()).writeActionsDisabled).toBe(false);
  });

  it("展示内容优先级：streamText > 当前草稿 > 已定稿正文", () => {
    expect(deriveWriterDisplayState(baseOptions()).fallbackDisplayContent).toBe("已定稿正文");
    expect(deriveWriterDisplayState(baseOptions({ drafts: [makeDraft()] })).fallbackDisplayContent).toBe("草稿正文");
    expect(
      deriveWriterDisplayState(baseOptions({ drafts: [makeDraft()], streamText: "流式中" })).fallbackDisplayContent,
    ).toBe("流式中");
  });

  it("settingsFandomPath：从 auPath 截到 fandom 段；无 /aus/ 时原样返回", () => {
    expect(deriveWriterDisplayState(baseOptions()).settingsFandomPath).toBe("/data/fandoms/F");
    expect(deriveWriterDisplayState(baseOptions({ auPath: "/data/fandoms/F" })).settingsFandomPath).toBe(
      "/data/fandoms/F",
    );
  });

  it("currentDraftSummary：非生成期按草稿 label 取；生成中强制 null（避免旧摘要挂在新流上）", () => {
    const summaries = { "draft-1": { p1_tokens: 10 } } as never;
    const withDraft = baseOptions({ drafts: [makeDraft()], draftSummaries: summaries });
    expect(deriveWriterDisplayState(withDraft).currentDraftSummary).not.toBeNull();
    expect(deriveWriterDisplayState({ ...withDraft, isGenerating: true }).currentDraftSummary).toBeNull();
  });
});

describe("deriveWriterDisplayState · meta 回退链", () => {
  it("无 generatedWith：model 回退会话模型、字数回退展示内容长度、时长回退 i18n 占位", () => {
    const d = deriveWriterDisplayState(baseOptions());
    expect(d.metaModel).toBe("deepseek-v4-flash");
    expect(d.metaChars).toBe("已定稿正文".length);
    expect(d.metaDuration).toBe("writer.metaDurationUnknown");
  });

  it("草稿携带 generatedWith：三项取实测值", () => {
    const d = deriveWriterDisplayState(
      baseOptions({
        drafts: [
          makeDraft({
            generatedWith: { model: "glm-4.7", char_count: 1234, duration_ms: 1500 } as never,
          }),
        ],
      }),
    );
    expect(d.metaModel).toBe("glm-4.7");
    expect(d.metaChars).toBe(1234);
    expect(d.metaDuration).toBe("1.5s");
  });

  it("currentDraftMeta：合法时间戳 + 模型拼「 · 」；非法时间戳只留模型；无 generatedWith 为空串", () => {
    const valid = deriveWriterDisplayState(
      baseOptions({
        drafts: [
          makeDraft({
            generatedWith: { model: "glm-4.7", generated_at: "2026-07-09T10:30:00Z" } as never,
          }),
        ],
      }),
    );
    expect(valid.currentDraftMeta).toContain(" · glm-4.7");

    const badTimestamp = deriveWriterDisplayState(
      baseOptions({
        drafts: [
          makeDraft({
            generatedWith: { model: "glm-4.7", generated_at: "not-a-date" } as never,
          }),
        ],
      }),
    );
    expect(badTimestamp.currentDraftMeta).toBe("glm-4.7");

    expect(deriveWriterDisplayState(baseOptions()).currentDraftMeta).toBe("");
  });

  it("previewText：空白折叠 + 超 200 字截断加省略号", () => {
    const long = `开头  \n\n${"字".repeat(300)}`;
    const d = deriveWriterDisplayState(baseOptions({ drafts: [makeDraft({ content: long })] }));
    expect(d.previewText.endsWith("...")).toBe(true);
    expect(d.previewText).toHaveLength(203);
    expect(d.previewText.startsWith("开头 字")).toBe(true);

    const short = deriveWriterDisplayState(baseOptions({ drafts: [makeDraft({ content: "短 内容" })] }));
    expect(short.previewText).toBe("短 内容");
  });
});

describe("deriveWriterDisplayState · 上下文分层条", () => {
  it("无 budgetReport：空层列表", () => {
    const d = deriveWriterDisplayState(baseOptions());
    expect(d.contextLayers).toEqual([]);
  });

  it("零 token 的 P 层剔除；pinned（system）恒在；占比按层和归一", () => {
    const d = deriveWriterDisplayState(
      baseOptions({
        budgetReport: {
          system_tokens: 500,
          p1_tokens: 0,
          p2_tokens: 300,
          p3_tokens: 0,
          p4_tokens: 200,
          p5_tokens: 0,
        },
      }),
    );
    expect(d.layerSum).toBe(1000);
    expect(d.contextLayers.map((l) => l.key)).toEqual(["pinned", "recent", "rag"]);
    expect(d.contextLayers.find((l) => l.key === "pinned")?.percent).toBe(50);
    expect(d.contextLayers.find((l) => l.key === "rag")?.percent).toBe(20);
  });

  it("极小层占比钳到最小 1%（条形图上仍可见）", () => {
    const d = deriveWriterDisplayState(
      baseOptions({
        budgetReport: {
          system_tokens: 10000,
          p2_tokens: 1,
          p1_tokens: 0,
          p3_tokens: 0,
          p4_tokens: 0,
          p5_tokens: 0,
        },
      }),
    );
    expect(d.contextLayers.find((l) => l.key === "recent")?.percent).toBe(1);
  });
});
