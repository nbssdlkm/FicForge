// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LocalFileDraftRepository — 草稿文件读写实现。参见 D-0014、D-0016。 */

import matter from "gray-matter";
import type { PlatformAdapter } from "../../platform/adapter.js";
import type { Draft } from "../../domain/draft.js";
import { createDraft } from "../../domain/draft.js";
// 草稿解析必须走 safeMatter（审计 B-1，H6 同族）：AI 常以 `---` 场景分割线开草稿，
// 裸 matter(text) 会把首段正文吞成 frontmatter；用户未编辑直接 confirm 时
// confirm_chapter 回退 draft.content，截断内容会固化进正式章节。
import { safeMatter } from "../../domain/frontmatter.js";
import type { GeneratedWith } from "../../domain/generated_with.js";
import { createGeneratedWith } from "../../domain/generated_with.js";
import type { DraftRepository } from "../interfaces/draft.js";
import { atomicWrite, joinPath, validateBasePath, validatePathSegment } from "./file_utils.js";

/**
 * 草稿 frontmatter 的合法键集合。真相源 = 下方 save() 的 meta 构造 —— 本仓库
 * 唯一写草稿 frontmatter 的地方，只会写 generated_with 一个键（generated_with
 * 为 null 时 meta 为空，gray-matter 不输出 frontmatter 块，文件即纯正文）。
 * 与章节不同（无 chapter_id / provenance 等），必须单独定义。save() 增删键时
 * 此集合必须同步。
 */
const KNOWN_DRAFT_META_KEYS: ReadonlySet<string> = new Set(["generated_with"]);

export class FileDraftRepository implements DraftRepository {
  constructor(private adapter: PlatformAdapter) {}

  private draftFilename(chapter_num: number, variant: string): string {
    return `ch${String(chapter_num).padStart(4, "0")}_draft_${variant}.md`;
  }

  private parseDraftFilename(filename: string): [number, string] | null {
    const m = filename.match(/^ch(\d{4,})_draft_(\w+)\.md$/);
    return m ? [Number(m[1]), m[2]] : null;
  }

  private draftsDir(au_id: string): string {
    validateBasePath(au_id, "au_id");
    return joinPath(au_id, "chapters", ".drafts");
  }

  private draftPath(au_id: string, chapter_num: number, variant: string): string {
    validatePathSegment(variant, "variant");
    return joinPath(this.draftsDir(au_id), this.draftFilename(chapter_num, variant));
  }

  async get(au_id: string, chapter_num: number, variant: string): Promise<Draft> {
    const path = this.draftPath(au_id, chapter_num, variant);
    const exists = await this.adapter.exists(path);
    if (!exists) {
      throw new Error(`Draft not found: ${path}`);
    }

    const text = await this.adapter.readFile(path);
    const parsed = safeMatter(text, KNOWN_DRAFT_META_KEYS);
    const meta = parsed.data;

    let generated_with: GeneratedWith | null = null;
    const gwRaw = meta.generated_with as Record<string, unknown> | undefined;
    if (gwRaw && typeof gwRaw === "object") {
      generated_with = createGeneratedWith({
        mode: (gwRaw.mode as string) ?? "",
        model: (gwRaw.model as string) ?? "",
        temperature: Number(gwRaw.temperature ?? 0),
        top_p: Number(gwRaw.top_p ?? 0),
        input_tokens: Number(gwRaw.input_tokens ?? 0),
        output_tokens: Number(gwRaw.output_tokens ?? 0),
        char_count: Number(gwRaw.char_count ?? 0),
        duration_ms: Number(gwRaw.duration_ms ?? 0),
        generated_at: (gwRaw.generated_at as string) ?? "",
      });
    }

    return createDraft({
      au_id,
      chapter_num,
      variant,
      content: parsed.content,
      generated_with,
    });
  }

  async save(draft: Draft): Promise<void> {
    const path = this.draftPath(draft.au_id, draft.chapter_num, draft.variant);
    const meta: Record<string, unknown> = {};
    if (draft.generated_with !== null) {
      const gw = draft.generated_with;
      meta.generated_with = {
        mode: gw.mode,
        model: gw.model,
        temperature: gw.temperature,
        top_p: gw.top_p,
        input_tokens: gw.input_tokens,
        output_tokens: gw.output_tokens,
        char_count: gw.char_count,
        duration_ms: gw.duration_ms,
        generated_at: gw.generated_at,
      };
    }
    // 必须以 { content } 对象形式传入（审计 B-1，同 file_chapter 写路径）：
    // matter.stringify 收到字符串时会先把正文按 frontmatter 再解析一遍，
    // `---` 开头的草稿在写入这一刻就被吞掉首段/搅碎；对象形式跳过这次解析。
    const text = matter.stringify({ content: draft.content }, meta);
    const dir = path.substring(0, path.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    // 覆盖已有 variant 时截断会毁掉旧稿 —— 原子写（审计 H5）
    await atomicWrite(this.adapter, path, text);
  }

  async list_by_chapter(au_id: string, chapter_num: number): Promise<Draft[]> {
    const dir = this.draftsDir(au_id);
    const exists = await this.adapter.exists(dir);
    if (!exists) return [];

    const files = await this.adapter.listDir(dir);
    const result: Draft[] = [];
    for (const f of files.sort()) {
      const parsed = this.parseDraftFilename(f);
      if (parsed && parsed[0] === chapter_num) {
        const draft = await this.get(au_id, parsed[0], parsed[1]);
        result.push(draft);
      }
    }
    return result;
  }

  async delete_by_chapter(au_id: string, chapter_num: number): Promise<void> {
    const dir = this.draftsDir(au_id);
    const exists = await this.adapter.exists(dir);
    if (!exists) return;

    const files = await this.adapter.listDir(dir);
    for (const f of files) {
      const parsed = this.parseDraftFilename(f);
      if (parsed && parsed[0] === chapter_num) {
        await this.adapter.deleteFile(joinPath(dir, f));
      }
    }
  }

  async delete_from_chapter(au_id: string, from_chapter_num: number): Promise<void> {
    const dir = this.draftsDir(au_id);
    const exists = await this.adapter.exists(dir);
    if (!exists) return;

    const files = await this.adapter.listDir(dir);
    for (const f of files) {
      const parsed = this.parseDraftFilename(f);
      if (parsed && parsed[0] >= from_chapter_num) {
        await this.adapter.deleteFile(joinPath(dir, f));
      }
    }
  }
}
