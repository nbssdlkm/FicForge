// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LocalFileChapterRepository — 章节文件读写实现。参见 PRD §2.6.2、D-0014。 */

import matter from "gray-matter";
import type { PlatformAdapter } from "../../platform/adapter.js";
import type { Chapter } from "../../domain/chapter.js";
import { createChapter } from "../../domain/chapter.js";
import type { GeneratedWith } from "../../domain/generated_with.js";
import { createGeneratedWith } from "../../domain/generated_with.js";
import type { ChapterRepository } from "../interfaces/chapter.js";
import { compute_content_hash, joinPath, now_utc, validatePathSegment } from "./file_utils.js";

export class FileChapterRepository implements ChapterRepository {
  constructor(private adapter: PlatformAdapter) {}

  // ------------------------------------------------------------------
  // 文件名 ↔ chapter_num 转换（D-0014）
  // ------------------------------------------------------------------

  private chapterFilename(chapter_num: number): string {
    return `ch${String(chapter_num).padStart(4, "0")}.md`;
  }

  private parseChapterFilename(filename: string): number | null {
    const m = filename.match(/^ch(\d{4,})\.md$/);
    return m ? Number(m[1]) : null;
  }

  private chapterPath(au_id: string, chapter_num: number): string {
    return joinPath(au_id, "chapters", "main", this.chapterFilename(chapter_num));
  }

  // ------------------------------------------------------------------
  // 接口实现
  // ------------------------------------------------------------------

  async get(au_id: string, chapter_num: number): Promise<Chapter> {
    validatePathSegment(au_id, "au_id");
    const path = this.chapterPath(au_id, chapter_num);
    const exists = await this.adapter.exists(path);
    if (!exists) {
      throw new Error(`Chapter not found: ${path}`);
    }

    const text = await this.adapter.readFile(path);
    const parsed = matter(text);
    const meta = (parsed.data ?? {}) as Record<string, unknown>;
    // gray-matter preserves blank lines between frontmatter delimiter and body.
    // python-frontmatter strips all leading/trailing newlines.
    // Use /^\n+/ and /\n+$/ to handle hand-edited files with extra blank lines.
    const content = parsed.content.replace(/^\n+/, "").replace(/\n+$/, "");

    // --- 缺失字段自动补齐（§2.6.7）---
    // 仅在内存中补齐，不写回磁盘。修复后的值在下次 save() 时持久化。

    if (!meta.chapter_id) {
      meta.chapter_id = crypto.randomUUID();
    }

    if (!meta.confirmed_at) {
      meta.confirmed_at = now_utc();
    }

    if (!meta.content_hash) {
      meta.content_hash = await compute_content_hash(content);
    }

    if (!meta.provenance) {
      meta.provenance = Object.keys(parsed.data ?? {}).length > 0 ? "ai" : "imported";
    }

    if (!("revision" in meta)) {
      meta.revision = 1;
    }

    if (!("confirmed_focus" in meta)) {
      meta.confirmed_focus = [];
    }

    // 缺失字段在内存中补齐，不写回磁盘（读操作无副作用）。
    // 修复后的值会在下次 save() 时持久化。

    return metaToChapter(au_id, chapter_num, meta, content);
  }

  async save(chapter: Chapter): Promise<void> {
    validatePathSegment(chapter.au_id, "au_id");
    const path = this.chapterPath(chapter.au_id, chapter.chapter_num);
    const meta = chapterToMeta(chapter);
    const text = matter.stringify(chapter.content, meta);
    const dir = path.substring(0, path.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    await this.adapter.writeFile(path, text);
  }

  async delete(au_id: string, chapter_num: number): Promise<void> {
    validatePathSegment(au_id, "au_id");
    const path = this.chapterPath(au_id, chapter_num);
    const exists = await this.adapter.exists(path);
    if (exists) {
      await this.adapter.deleteFile(path);
    }
  }

  async list_main(au_id: string): Promise<Chapter[]> {
    validatePathSegment(au_id, "au_id");
    const mainDir = joinPath(au_id, "chapters", "main");
    const exists = await this.adapter.exists(mainDir);
    if (!exists) return [];

    const files = await this.adapter.listDir(mainDir);
    const chapters: Chapter[] = [];
    for (const f of files.sort()) {
      const num = this.parseChapterFilename(f);
      if (num !== null) {
        const ch = await this.get(au_id, num);
        chapters.push(ch);
      }
    }
    return chapters;
  }

  async exists(au_id: string, chapter_num: number): Promise<boolean> {
    validatePathSegment(au_id, "au_id");
    return this.adapter.exists(this.chapterPath(au_id, chapter_num));
  }

  async get_content_only(au_id: string, chapter_num: number): Promise<string> {
    validatePathSegment(au_id, "au_id");
    const path = this.chapterPath(au_id, chapter_num);
    const exists = await this.adapter.exists(path);
    if (!exists) {
      throw new Error(`Chapter not found: ${path}`);
    }
    const text = await this.adapter.readFile(path);
    const parsed = matter(text);
    // Normalize leading/trailing newlines (see get() comment for rationale).
    return parsed.content.replace(/^\n+/, "").replace(/\n+$/, "");
  }

  async backup_chapter(au_id: string, chapter_num: number): Promise<string> {
    validatePathSegment(au_id, "au_id");
    const src = this.chapterPath(au_id, chapter_num);
    const srcExists = await this.adapter.exists(src);
    if (!srcExists) {
      throw new Error(`Chapter not found for backup: ${src}`);
    }

    const backupsDir = joinPath(au_id, "chapters", "backups");
    await this.adapter.mkdir(backupsDir);

    // 确定版本号
    const prefix = `ch${String(chapter_num).padStart(4, "0")}_v`;
    const existingFiles = await this.adapter.listDir(backupsDir);
    const existing = existingFiles.filter((f) => f.startsWith(prefix));
    const version = existing.length + 1;

    const dest = joinPath(backupsDir, `ch${String(chapter_num).padStart(4, "0")}_v${version}.md`);
    const content = await this.adapter.readFile(src);
    await this.adapter.writeFile(dest, content);
    return dest;
  }
}

// ------------------------------------------------------------------
// 内部映射
// ------------------------------------------------------------------

function metaToChapter(
  au_id: string,
  chapter_num: number,
  meta: Record<string, unknown>,
  content: string,
): Chapter {
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

  return createChapter({
    au_id,
    chapter_num,
    content,
    chapter_id: (meta.chapter_id as string) ?? "",
    revision: (meta.revision as number) ?? 1,
    confirmed_focus: (meta.confirmed_focus as string[]) ?? [],
    confirmed_at: (meta.confirmed_at as string) ?? "",
    content_hash: (meta.content_hash as string) ?? "",
    provenance: (meta.provenance as string) ?? "",
    generated_with,
  });
}

function chapterToMeta(chapter: Chapter): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    chapter_id: chapter.chapter_id,
    revision: chapter.revision,
    confirmed_focus: chapter.confirmed_focus,
    confirmed_at: chapter.confirmed_at,
    content_hash: chapter.content_hash,
    provenance: chapter.provenance,
  };
  if (chapter.generated_with !== null) {
    const gw = chapter.generated_with;
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
  return meta;
}
