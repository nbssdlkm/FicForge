// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * chapter_inflight 跨路径并发碰撞测试（盲审 2026-07-09：互斥表是防「写文 × 对话
 * 同章并发生成互相覆盖草稿」的单一真相源，此前无专门碰撞测试，仅被 dispatch 间接触及）。
 *
 * 验证点：任一路径持有 (au, chapter) 在飞标记时，另一路径必须在进 loop / 分配
 * label 之前被 409 拒绝；释放后放行；不同章互不干扰。
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  chapterInflightKey,
  isChapterInflight,
  markChapterInflight,
  releaseChapterInflight,
} from "../chapter_inflight.js";
import { generate_chapter, type GenerateChapterParams } from "../generation.js";
import { dispatch_simple_chat } from "../simple_chat_dispatch.js";
import { createProject, createSettings, createState } from "../../domain/index.js";

const AU = "fandoms/F/aus/A";
const CH = 3;
const KEY = chapterInflightKey(AU, CH);

/** 最小参数集：409 检查发生在任何 repo/provider 访问之前，stub 不会被触碰。 */
function minimalParams(): GenerateChapterParams {
  return {
    au_id: AU,
    chapter_num: CH,
    user_input: "继续写",
    session_llm: null,
    session_params: null,
    project: createProject({ au_id: AU, name: "test" }),
    state: createState({ au_id: AU, current_chapter: CH }),
    settings: createSettings(),
    facts: [],
    chapter_repo: {} as never,
    draft_repo: {} as never,
  } as unknown as GenerateChapterParams;
}

afterEach(() => {
  releaseChapterInflight(KEY);
});

describe("chapter_inflight 跨路径互斥", () => {
  it("对话路径在飞时，写文 generate_chapter 同章被 409 拒绝（不进生成流程）", async () => {
    markChapterInflight(KEY, "dispatch");

    const gen = generate_chapter(minimalParams());
    const first = await gen.next();

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: "error",
      data: { error_code: "GENERATION_IN_PROGRESS" },
    });
    // 拒绝路径不得清掉对方的在飞标记
    expect(isChapterInflight(KEY)).toBe(true);
  });

  it("写文路径在飞时，对话 dispatch_simple_chat 同章被 409 拒绝", async () => {
    markChapterInflight(KEY, "generate");

    const gen = dispatch_simple_chat(minimalParams() as never);
    const first = await gen.next();

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: "error",
      data: { error_code: "DISPATCH_IN_PROGRESS" },
    });
    expect(isChapterInflight(KEY)).toBe(true);
  });

  it("释放后放行：release 之后表内无此章", () => {
    markChapterInflight(KEY, "generate");
    expect(isChapterInflight(KEY)).toBe(true);
    releaseChapterInflight(KEY);
    expect(isChapterInflight(KEY)).toBe(false);
  });

  it("互斥粒度是 (au, chapter)：同 AU 其它章不受影响", () => {
    markChapterInflight(KEY, "dispatch");
    expect(isChapterInflight(chapterInflightKey(AU, CH + 1))).toBe(false);
    expect(isChapterInflight(chapterInflightKey("fandoms/F/aus/B", CH))).toBe(false);
  });
});
