// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LocalFileChapterRepository — 章节文件读写实现。参见 PRD §2.6.2、D-0014。 */

import matter from "gray-matter";
import type { PlatformAdapter } from "../../platform/adapter.js";
import type { Chapter } from "../../domain/chapter.js";
import { KNOWN_CHAPTER_META_KEYS, createChapter } from "../../domain/chapter.js";
// 章节解析必须走 safeMatter（审计 H6 + M27 + B-3 全套防御，见 domain/frontmatter.ts）：
// 裸 matter(raw) 会把 `---` 开头的正文吞成 frontmatter，导致该章不可读、
// list_main 整 AU 崩、get_content_only 静默丢正文。
import { safeMatter } from "../../domain/frontmatter.js";
import type { GeneratedWith } from "../../domain/generated_with.js";
import { createGeneratedWith } from "../../domain/generated_with.js";
import type { ChapterRepository } from "../interfaces/chapter.js";
import { atomicWrite, compute_content_hash, joinPath, now_utc, validateBasePath } from "./file_utils.js";

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
    validateBasePath(au_id, "au_id");
    const path = this.chapterPath(au_id, chapter_num);
    const exists = await this.adapter.exists(path);
    if (!exists) {
      throw new Error(`Chapter not found: ${path}`);
    }

    const text = await this.adapter.readFile(path);
    const { data: meta, content: rawContent } = safeMatter(text, KNOWN_CHAPTER_META_KEYS);
    // gray-matter preserves blank lines between frontmatter delimiter and body.
    // python-frontmatter strips all leading/trailing newlines.
    // Use /^\n+/ and /\n+$/ to handle hand-edited files with extra blank lines.
    const content = rawContent.replace(/^\n+/, "").replace(/\n+$/, "");

    // frontmatter 有无必须在补齐之前采样：下面的补齐会直接往 meta 里加键，
    // 补齐后再数键会把所有章都误判成「有 frontmatter」（provenance 恒为 "ai"，
    // 导入的裸正文永远拿不到 "imported"）。
    const hadFrontmatter = Object.keys(meta).length > 0;

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
      meta.provenance = hadFrontmatter ? "ai" : "imported";
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
    validateBasePath(chapter.au_id, "au_id");
    // content_hash 完整性检查：检测「修改了 content 但忘记重算 hash」的调用方 bug。
    // fire-and-forget —— 不阻塞文件写入。所有调用方在调 save() 之前已算过 hash，
    // 这里只是防御性校验，不应成为热路径的瓶颈。
    if (chapter.content_hash) {
      compute_content_hash(chapter.content).then((actual) => {
        if (actual !== chapter.content_hash) {
          console.warn(
            `[file_chapter] content_hash mismatch on save: ` +
            `au=${chapter.au_id} ch=${chapter.chapter_num} ` +
            `stored=${chapter.content_hash.slice(0, 8)}... actual=${actual.slice(0, 8)}...`,
          );
        }
      }).catch(() => { /* hash 校验失败不阻断 */ });
    }
    const path = this.chapterPath(chapter.au_id, chapter.chapter_num);
    const meta = chapterToMeta(chapter);
    // 必须以 { content } 对象形式传入：matter.stringify 收到字符串时会先把
    // 正文按 frontmatter 再解析一遍，正文以 `---` 开头会被吞掉一段（H6 的
    // 写路径变体，实测正文首段会混进 frontmatter）；对象形式跳过这次解析。
    const text = matter.stringify({ content: chapter.content }, meta);
    const dir = path.substring(0, path.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    // 章节正文是用户唯一副本，写盘必须原子（审计 H5）：崩溃击中写入中途时保旧文完整
    await atomicWrite(this.adapter, path, text);
  }

  async delete(au_id: string, chapter_num: number): Promise<void> {
    validateBasePath(au_id, "au_id");
    const path = this.chapterPath(au_id, chapter_num);
    const exists = await this.adapter.exists(path);
    if (exists) {
      await this.adapter.deleteFile(path);
    }
  }

  async list_main(au_id: string): Promise<Chapter[]> {
    validateBasePath(au_id, "au_id");
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
    validateBasePath(au_id, "au_id");
    return this.adapter.exists(this.chapterPath(au_id, chapter_num));
  }

  async get_content_only(au_id: string, chapter_num: number): Promise<string> {
    validateBasePath(au_id, "au_id");
    const path = this.chapterPath(au_id, chapter_num);
    const exists = await this.adapter.exists(path);
    if (!exists) {
      throw new Error(`Chapter not found: ${path}`);
    }
    const text = await this.adapter.readFile(path);
    const { content } = safeMatter(text, KNOWN_CHAPTER_META_KEYS);
    // Normalize leading/trailing newlines (see get() comment for rationale).
    return content.replace(/^\n+/, "").replace(/\n+$/, "");
  }

  async backup_chapter(au_id: string, chapter_num: number): Promise<string> {
    validateBasePath(au_id, "au_id");
    const src = this.chapterPath(au_id, chapter_num);
    const srcExists = await this.adapter.exists(src);
    if (!srcExists) {
      throw new Error(`Chapter not found for backup: ${src}`);
    }

    const backupsDir = joinPath(au_id, "chapters", "backups");
    await this.adapter.mkdir(backupsDir);

    // 确定版本号（L23）：用「现存最大版本号 + 1」而非「文件数 + 1」。外部清理掉 v1、只留 v2 时，
    // 文件数=1 会算出 v2 覆盖既有 v2（备份被覆盖 = undo 级联回滚拿到错内容）。解析文件名里的
    // 版本号取 max，保证新备份编号严格大于任何现存备份。
    const prefix = `ch${String(chapter_num).padStart(4, "0")}_v`;
    const existingFiles = await this.adapter.listDir(backupsDir);
    let maxVersion = 0;
    for (const f of existingFiles) {
      if (!f.startsWith(prefix)) continue;
      const m = f.slice(prefix.length).match(/^(\d+)/);
      if (m) {
        const v = parseInt(m[1], 10);
        if (v > maxVersion) maxVersion = v;
      }
    }
    const version = maxVersion + 1;

    const dest = joinPath(backupsDir, `ch${String(chapter_num).padStart(4, "0")}_v${version}.md`);
    const content = await this.adapter.readFile(src);
    // 备份供 undo 级联回滚使用：原子写保证要么完整存在、要么不存在，不会留半截备份被回滚误用
    await atomicWrite(this.adapter, dest, content);
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

// 注意：这里写入的键集合是 KNOWN_CHAPTER_META_KEYS（domain/chapter.ts）的真相源，
// 增删字段必须同步。
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
