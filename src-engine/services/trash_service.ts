// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 垃圾箱服务。参见 D-0023。
 * .trash/ + manifest.jsonl 实现软删除与恢复。默认保留 30 天。
 */

import yaml from "js-yaml";
import { safeMatter } from "../domain/frontmatter.js";
import type { PlatformAdapter } from "../platform/adapter.js";
import { joinPath } from "../repositories/implementations/file_utils.js";

/**
 * 角色设定文件 frontmatter 的合法键集合（settings-chat 提示词约定的 schema：
 * name / aliases / importance，见 prompts/zh.ts「提取 frontmatter 元数据」段）。
 * readCharacterName 用它区分真 frontmatter 与「正文以 `---` 分割线开头」——
 * 裸 matter() 在后者会吞正文/对非法 YAML 抛错（审计 H6 同族），safeMatter
 * 只认含已知键的真 frontmatter。schema 增删键时此集合必须同步。
 */
const KNOWN_CHARACTER_META_KEYS: ReadonlySet<string> = new Set(["name", "aliases", "importance"]);

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

export interface TrashEntry {
  trash_id: string;
  original_path: string;
  trash_path: string;
  entity_type: string;
  entity_name: string;
  deleted_at: string;
  expires_at: string;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 核心服务
// ---------------------------------------------------------------------------

export class TrashService {
  constructor(
    private adapter: PlatformAdapter,
    private retentionDays = 30,
  ) {}

  /**
   * 按 scopeRoot 串行化所有「会读改写 manifest（及 cast_registry）」的操作。
   * manifest.jsonl 的 append/remove/write 都是非原子读改写：多个删除/恢复/清理并发时会
   * 互相覆盖对方刚写入的条目 → 条目丢失（副本在但 manifest 无记录=孤儿=数据永久丢失，审计②③）。
   * 同一 scopeRoot 排队执行，不同 scopeRoot 并行；这也顺带串行化了 cast_registry 的写。
   */
  private opChain = new Map<string, Promise<unknown>>();

  private runExclusive<T>(scopeRoot: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.opChain.get(scopeRoot) ?? Promise.resolve();
    // 前一个成功/失败都接着跑，避免一次失败卡死整条链；结果/错误照常返回给各自调用方。
    const next = prev.then(fn, fn);
    this.opChain.set(scopeRoot, next.then(() => undefined, () => undefined));
    return next;
  }

  async move_tree_to_trash(
    scopeRoot: string,
    relativePath: string,
    entityType: string,
    entityName: string,
  ): Promise<TrashEntry> {
    return this.runExclusive(scopeRoot, () =>
      this._moveTreeToTrash(scopeRoot, relativePath, entityType, entityName),
    );
  }

  private async _moveTreeToTrash(
    scopeRoot: string,
    relativePath: string,
    entityType: string,
    entityName: string,
  ): Promise<TrashEntry> {
    if (relativePath.includes("..") || relativePath.startsWith("/")) {
      throw new Error(`非法路径: ${relativePath}`);
    }

    const sourceRoot = joinPath(scopeRoot, relativePath);
    if (!(await this.adapter.exists(sourceRoot))) {
      throw new Error(`源不存在: ${sourceRoot}`);
    }

    const files = await this.collectTreeFiles(sourceRoot);
    const ts = Math.floor(Date.now() / 1000);
    const shortId = crypto.randomUUID().slice(0, 4);
    const trashId = `tr_${ts}_${shortId}`;
    // trash_path 带上 shortId 保唯一：秒级 ts 在同秒同路径重复删除时会碰撞，
    // 导致副本互相覆盖 + 回滚误删他项副本（审计① defect 1）。
    const trashRel = `${relativePath}_${ts}_${shortId}`;
    const trashRoot = joinPath(scopeRoot, ".trash", trashRel);
    const copiedFiles: Array<{ source: string; trash: string }> = [];

    // 顺序即数据安全（对齐 _moveToTrash 审计①，本处审计 H7）：copy 全部 → 登记 manifest →
    // 删源。manifest 落库时源文件全部仍在，任何一步失败都不会出现「源已删但 manifest 无记录」
    // 的不可恢复孤儿；删源阶段哪怕中断，副本 + manifest 都已就位，回滚有依。
    let manifestAppended = false;
    try {
      for (const fileRel of files) {
        const source = joinPath(sourceRoot, fileRel);
        const trashTarget = joinPath(trashRoot, fileRel);
        await this.copyTextFile(source, trashTarget);
        copiedFiles.push({ source, trash: trashTarget });
      }

      const now = new Date();
      const expires = new Date(now.getTime() + this.retentionDays * 86400000);
      const entry: TrashEntry = {
        trash_id: trashId,
        original_path: relativePath,
        trash_path: trashRel,
        entity_type: entityType,
        entity_name: entityName,
        deleted_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
        expires_at: expires.toISOString().replace(/\.\d{3}Z$/, "Z"),
        metadata: {
          is_directory: true,
          file_count: files.length,
        },
      };

      await this.appendManifest(scopeRoot, entry);
      manifestAppended = true;

      for (const { source } of copiedFiles) {
        await this.adapter.deleteFile(source);
      }

      return entry;
    } catch (error) {
      // 回滚。关键约束（审计 H7）：清理 .trash 副本前必须验证「对应源文件确实存在」——
      // 删源中断 + copy-back 又失败的双失败叠加时，.trash 副本是该文件唯一幸存数据，
      // 旧代码在这里无条件删副本 = 永久销毁。回滚各步 best-effort，不掩盖主错误。
      if (manifestAppended) {
        try {
          await this.removeFromManifest(scopeRoot, trashId);
        } catch {
          // best effort：残留条目最多让 restore 报「文件已丢失」后自清，不丢数据
        }
      }
      const restoreFailures = await this.restoreCopiedTree(copiedFiles);
      await this.deleteCopiesWithVerifiedSource(copiedFiles);
      if (restoreFailures.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[trash] 目录删除回滚不完整：${restoreFailures.length} 个文件未能恢复到原位，` +
          `其 .trash 副本已保留，可手工找回: ` +
          restoreFailures.map((f) => `${f.source} ← ${f.trash} (${f.message})`).join("; "),
        );
      }
      throw error;
    }
  }

  async move_to_trash(
    scopeRoot: string,
    relativePath: string,
    entityType: string,
    entityName: string,
  ): Promise<TrashEntry> {
    return this.runExclusive(scopeRoot, () =>
      this._moveToTrash(scopeRoot, relativePath, entityType, entityName),
    );
  }

  private async _moveToTrash(
    scopeRoot: string,
    relativePath: string,
    entityType: string,
    entityName: string,
  ): Promise<TrashEntry> {
    // 路径遍历防护
    if (relativePath.includes("..") || relativePath.startsWith("/")) {
      throw new Error(`非法路径: ${relativePath}`);
    }

    const source = joinPath(scopeRoot, relativePath);
    const sourceExists = await this.adapter.exists(source);
    if (!sourceExists) {
      throw new Error(`源不存在: ${source}`);
    }

    const ts = Math.floor(Date.now() / 1000);
    const shortId = crypto.randomUUID().slice(0, 4);
    const trashId = `tr_${ts}_${shortId}`;

    // 构建 .trash/ 内的路径
    const lastDot = relativePath.lastIndexOf(".");
    const lastSlash = relativePath.lastIndexOf("/");
    const stem = lastDot > lastSlash ? relativePath.slice(0, lastDot) : relativePath;
    const ext = lastDot > lastSlash ? relativePath.slice(lastDot) : "";
    // trash_path 带上 shortId 保唯一（审计① defect 1）：秒级 ts 在同秒同路径重复删除时碰撞，
    // 会让第二次的副本覆盖第一次的、且回滚 deleteFile 误删第一条仍引用的副本 → 孤儿。
    const trashRel = `${stem}_${ts}_${shortId}${ext}`;

    const trashDir = joinPath(scopeRoot, ".trash");
    const trashTarget = joinPath(trashDir, trashRel);

    // 收集元数据
    const meta: Record<string, unknown> = {};
    try {
      const content = await this.adapter.readFile(source);
      meta.file_size_bytes = content.length;
      meta.preview = content.slice(0, 100);
    } catch {
      // 目录或不可读
    }

    // 读取角色名（用于 cast_registry 联动）
    let characterName: string | null = null;
    if (this.shouldSyncCastRegistry(relativePath, scopeRoot)) {
      characterName = await this.readCharacterName(source);
    }

    const now = new Date();
    const expires = new Date(now.getTime() + this.retentionDays * 86400000);
    const entry: TrashEntry = {
      trash_id: trashId,
      original_path: relativePath,
      trash_path: trashRel,
      entity_type: entityType,
      entity_name: entityName,
      deleted_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
      expires_at: expires.toISOString().replace(/\.\d{3}Z$/, "Z"),
      metadata: meta,
    };

    // 顺序即数据安全（审计①）：先写 .trash 副本 + 登记 manifest（此刻源文件仍在），
    // manifest 落库成功后才删源。任何一步失败都不会出现「源已删但 manifest 无记录」的孤儿
    // ——那种孤儿在 list_trash / restore（都以 manifest 为准）里不可见、不可恢复=数据永久丢失。
    // 对齐 move_tree_to_trash 的原子语义；失败时回滚 .trash 副本与 manifest 登记，保证源不丢。
    let trashCopyWritten = false;
    let manifestAppended = false;
    try {
      const content = await this.adapter.readFile(source);
      const dir = trashTarget.substring(0, trashTarget.lastIndexOf("/"));
      await this.adapter.mkdir(dir);
      await this.adapter.writeFile(trashTarget, content);
      trashCopyWritten = true;
      await this.appendManifest(scopeRoot, entry);
      manifestAppended = true;
      // manifest 已落库，此时删源才安全
      await this.adapter.deleteFile(source);
    } catch {
      // 源保持原样（尚未删除，或删除本身失败）→ 撤销已登记 manifest（仅当 append 成功过）+
      // 清掉可能已写的 .trash 副本。回滚步骤全部 best-effort，绝不用回滚自身的失败掩盖主错误。
      if (manifestAppended) {
        try {
          await this.removeFromManifest(scopeRoot, trashId);
        } catch {
          // best effort
        }
      }
      if (trashCopyWritten) {
        try {
          if (await this.adapter.exists(trashTarget)) await this.adapter.deleteFile(trashTarget);
        } catch {
          // best effort
        }
      }
      throw new Error(`移动文件失败: ${source} → ${trashTarget}`);
    }

    // cast_registry 联动放在 manifest + 删源都成功之后（审计②）：即便这步失败，项已在回收站，
    // restore 会重新把角色 add 回名册，故此处失败只告警、不回退删除。
    // 反例（旧代码）：在 appendManifest 之前就 writeFile(project.yaml) 删掉角色，若随后 manifest
    // 失败，角色从名册永久消失且无 restore 可依（manifest 无记录）。
    if (characterName) {
      try {
        await this.updateCastRegistry(scopeRoot, characterName, "remove");
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[trash] cast_registry remove 失败；名册可能残留该角色，可经 restore 修正: ${(err as Error).message}`,
        );
      }
    }

    return entry;
  }

  async list_trash(scopeRoot: string): Promise<TrashEntry[]> {
    return this.readManifest(scopeRoot);
  }

  async restore(scopeRoot: string, trashId: string): Promise<TrashEntry> {
    return this.runExclusive(scopeRoot, () => this._restore(scopeRoot, trashId));
  }

  private async _restore(scopeRoot: string, trashId: string): Promise<TrashEntry> {
    const entries = await this.readManifest(scopeRoot);
    const targetEntry = entries.find((e) => e.trash_id === trashId);
    if (!targetEntry) throw new Error(`垃圾箱项不存在: ${trashId}`);

    if (this.isDirectoryEntry(targetEntry)) {
      return this.restoreDirectoryEntry(scopeRoot, targetEntry);
    }

    const originalDest = joinPath(scopeRoot, targetEntry.original_path);
    if (await this.adapter.exists(originalDest)) {
      throw new Error(`无法恢复，原路径已存在: ${targetEntry.original_path}`);
    }

    const trashSource = joinPath(scopeRoot, ".trash", targetEntry.trash_path);
    if (!(await this.adapter.exists(trashSource))) {
      await this.removeFromManifest(scopeRoot, trashId);
      throw new Error(`垃圾箱中的文件已丢失: ${targetEntry.trash_path}`);
    }

    // 兼容 adapter：使用 read + write + delete 实现“移动”
    const content = await this.adapter.readFile(trashSource);
    const dir = originalDest.substring(0, originalDest.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    await this.adapter.writeFile(originalDest, content);
    await this.adapter.deleteFile(trashSource);
    await this.removeFromManifest(scopeRoot, trashId);

    // cast_registry 联动
    if (this.shouldSyncCastRegistry(targetEntry.original_path, scopeRoot)) {
      const name = await this.readCharacterName(originalDest);
      if (name) await this.updateCastRegistry(scopeRoot, name, "add");
    }

    return targetEntry;
  }

  async permanent_delete(scopeRoot: string, trashId: string): Promise<TrashEntry> {
    return this.runExclusive(scopeRoot, () => this._permanentDelete(scopeRoot, trashId));
  }

  private async _permanentDelete(scopeRoot: string, trashId: string): Promise<TrashEntry> {
    const entries = await this.readManifest(scopeRoot);
    const targetEntry = entries.find((e) => e.trash_id === trashId);
    if (!targetEntry) throw new Error(`垃圾箱项不存在: ${trashId}`);

    if (this.isDirectoryEntry(targetEntry)) {
      const trashRoot = joinPath(scopeRoot, ".trash", targetEntry.trash_path);
      const files = await this.collectTreeFiles(trashRoot);
      await this.deleteCopiedTree(files.map((fileRel) => joinPath(trashRoot, fileRel)));
      await this.removeFromManifest(scopeRoot, trashId);
      return targetEntry;
    }

    const trashSource = joinPath(scopeRoot, ".trash", targetEntry.trash_path);
    if (await this.adapter.exists(trashSource)) {
      await this.adapter.deleteFile(trashSource);
    }

    await this.removeFromManifest(scopeRoot, trashId);
    return targetEntry;
  }

  async purge_expired(scopeRoot: string, maxAgeDays?: number | null): Promise<TrashEntry[]> {
    return this.runExclusive(scopeRoot, () => this._purgeExpired(scopeRoot, maxAgeDays));
  }

  private async _purgeExpired(scopeRoot: string, maxAgeDays?: number | null): Promise<TrashEntry[]> {
    const entries = await this.readManifest(scopeRoot);
    const now = Date.now();
    const forceAll = maxAgeDays !== undefined && maxAgeDays !== null && maxAgeDays === 0;
    const purged: TrashEntry[] = [];

    for (const entry of entries) {
      let shouldPurge = forceAll;
      if (!shouldPurge) {
        try {
          const expires = new Date(entry.expires_at).getTime();
          shouldPurge = now >= expires;
        } catch {
          continue;
        }
      }

      if (shouldPurge) {
        if (this.isDirectoryEntry(entry)) {
          const trashRoot = joinPath(scopeRoot, ".trash", entry.trash_path);
          const files = await this.collectTreeFiles(trashRoot);
          await this.deleteCopiedTree(files.map((fileRel) => joinPath(trashRoot, fileRel)));
        } else {
          const trashSource = joinPath(scopeRoot, ".trash", entry.trash_path);
          if (await this.adapter.exists(trashSource)) {
            await this.adapter.deleteFile(trashSource);
          }
        }
        purged.push(entry);
      }
    }

    if (purged.length > 0) {
      const purgedIds = new Set(purged.map((e) => e.trash_id));
      const remaining = entries.filter((e) => !purgedIds.has(e.trash_id));
      await this.writeManifest(scopeRoot, remaining);
    }

    return purged;
  }

  // ----- Manifest 操作 -----

  private manifestPath(scopeRoot: string): string {
    return joinPath(scopeRoot, ".trash", "manifest.jsonl");
  }

  private async readManifest(scopeRoot: string): Promise<TrashEntry[]> {
    const mp = this.manifestPath(scopeRoot);
    if (!(await this.adapter.exists(mp))) return [];

    const text = await this.adapter.readFile(mp);
    const entries: TrashEntry[] = [];
    for (const line of text.split("\n")) {
      const stripped = line.trim();
      if (!stripped) continue;
      try {
        entries.push(JSON.parse(stripped) as TrashEntry);
      } catch {
        continue;
      }
    }
    return entries;
  }

  private async writeManifest(scopeRoot: string, entries: TrashEntry[]): Promise<void> {
    const mp = this.manifestPath(scopeRoot);
    const dir = mp.substring(0, mp.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    const content = entries.length > 0
      ? entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
      : "";
    await this.adapter.writeFile(mp, content);
  }

  private async appendManifest(scopeRoot: string, entry: TrashEntry): Promise<void> {
    const mp = this.manifestPath(scopeRoot);
    const dir = mp.substring(0, mp.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    const line = JSON.stringify(entry) + "\n";
    const exists = await this.adapter.exists(mp);
    if (exists) {
      const existing = await this.adapter.readFile(mp);
      const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
      await this.adapter.writeFile(mp, existing + prefix + line);
    } else {
      await this.adapter.writeFile(mp, line);
    }
  }

  private async removeFromManifest(scopeRoot: string, trashId: string): Promise<void> {
    const entries = await this.readManifest(scopeRoot);
    const remaining = entries.filter((e) => e.trash_id !== trashId);
    await this.writeManifest(scopeRoot, remaining);
  }

  private isDirectoryEntry(entry: TrashEntry): boolean {
    return entry.metadata?.is_directory === true;
  }

  private async restoreDirectoryEntry(scopeRoot: string, entry: TrashEntry): Promise<TrashEntry> {
    const trashRoot = joinPath(scopeRoot, ".trash", entry.trash_path);
    if (!(await this.adapter.exists(trashRoot))) {
      await this.removeFromManifest(scopeRoot, entry.trash_id);
      throw new Error(`垃圾箱中的文件已丢失: ${entry.trash_path}`);
    }

    const files = await this.collectTreeFiles(trashRoot);
    for (const fileRel of files) {
      const originalDest = joinPath(scopeRoot, entry.original_path, fileRel);
      if (await this.adapter.exists(originalDest)) {
        throw new Error(`restore conflict: ${entry.original_path}/${fileRel}`);
      }
    }

    for (const fileRel of files) {
      const trashSource = joinPath(trashRoot, fileRel);
      const originalDest = joinPath(scopeRoot, entry.original_path, fileRel);
      await this.copyTextFile(trashSource, originalDest);
    }

    await this.deleteCopiedTree(files.map((fileRel) => joinPath(trashRoot, fileRel)));
    await this.removeFromManifest(scopeRoot, entry.trash_id);
    return entry;
  }

  private async collectTreeFiles(rootPath: string, relativePrefix = ""): Promise<string[]> {
    const currentPath = relativePrefix ? joinPath(rootPath, relativePrefix) : rootPath;
    let entries: string[] = [];
    try {
      entries = await this.adapter.listDir(currentPath);
    } catch {
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      const relativePath = relativePrefix ? `${relativePrefix}/${entry}` : entry;
      const candidatePath = joinPath(rootPath, relativePath);
      let childEntries: string[] | null = null;
      try {
        childEntries = await this.adapter.listDir(candidatePath);
      } catch {
        childEntries = null;
      }

      if (childEntries && childEntries.length > 0) {
        files.push(...await this.collectTreeFiles(rootPath, relativePath));
        continue;
      }

      if (await this.isReadableFile(candidatePath)) {
        files.push(relativePath);
      }
    }
    return files;
  }

  private async isReadableFile(path: string): Promise<boolean> {
    try {
      await this.adapter.readFile(path);
      return true;
    } catch {
      return false;
    }
  }

  private async copyTextFile(source: string, dest: string): Promise<void> {
    const content = await this.adapter.readFile(source);
    const dir = dest.substring(0, dest.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    await this.adapter.writeFile(dest, content);
  }

  /**
   * 回滚：把「源已被删」的文件从 .trash 副本 copy-back 回原位。
   * 失败不再裸吞（审计 H7）——返回失败清单，调用方据此保留对应副本并警告指路。
   */
  private async restoreCopiedTree(
    copiedFiles: Array<{ source: string; trash: string }>,
  ): Promise<Array<{ source: string; trash: string; message: string }>> {
    const failures: Array<{ source: string; trash: string; message: string }> = [];
    for (const item of [...copiedFiles].reverse()) {
      try {
        if (await this.adapter.exists(item.source)) continue;
        await this.copyTextFile(item.trash, item.source);
      } catch (err) {
        // exists() 探测失败也按「未恢复」记：宁可多保留一个副本，不冒销毁唯一数据的险
        failures.push({ source: item.source, trash: item.trash, message: (err as Error).message });
      }
    }
    return failures;
  }

  /**
   * 回滚清理：只删「对应源文件已验证存在」的 .trash 副本（审计 H7）。
   * 源不存在（删源成功但 copy-back 失败）时该副本是唯一幸存数据，必须保留。
   */
  private async deleteCopiesWithVerifiedSource(
    copiedFiles: Array<{ source: string; trash: string }>,
  ): Promise<void> {
    for (const item of [...copiedFiles].reverse()) {
      let sourceExists = false;
      try {
        sourceExists = await this.adapter.exists(item.source);
      } catch {
        sourceExists = false; // 探测失败按不存在处理 → 保留副本
      }
      if (!sourceExists) continue;
      try {
        if (await this.adapter.exists(item.trash)) {
          await this.adapter.deleteFile(item.trash);
        }
      } catch {
        // best effort cleanup：残留副本只是磁盘垃圾，不是数据风险
      }
    }
  }

  private async deleteCopiedTree(paths: string[]): Promise<void> {
    for (const path of [...paths].reverse()) {
      try {
        if (await this.adapter.exists(path)) {
          await this.adapter.deleteFile(path);
        }
      } catch {
        // best effort cleanup
      }
    }
  }

  // ----- cast_registry 联动 -----

  private shouldSyncCastRegistry(relativePath: string, _scopeRoot: string): boolean {
    return relativePath.startsWith("characters/");
  }

  private async readCharacterName(path: string): Promise<string | null> {
    try {
      const content = await this.adapter.readFile(path);
      // safeMatter 不抛错；try/catch 只兜 readFile 失败
      const parsed = safeMatter(content, KNOWN_CHARACTER_META_KEYS);
      const name = parsed.data.name;
      if (typeof name === "string" && name.trim()) return name.trim();
      return null;
    } catch {
      return null;
    }
  }

  private async updateCastRegistry(scopeRoot: string, characterName: string, action: "add" | "remove"): Promise<void> {
    const projectPath = joinPath(scopeRoot, "project.yaml");
    if (!(await this.adapter.exists(projectPath))) return;

    try {
      const text = await this.adapter.readFile(projectPath);
      const raw = (yaml.load(text) ?? {}) as Record<string, unknown>;
      if (typeof raw !== "object") return;

      const castRegistry = (raw.cast_registry ?? {}) as Record<string, unknown>;
      let names = (castRegistry.characters ?? []) as string[];
      names = names.filter((n) => typeof n === "string" && n.trim());

      if (action === "remove") {
        const updated = names.filter((n) => n !== characterName);
        if (updated.length === names.length) return;
        names = updated;
      } else {
        if (names.includes(characterName)) return;
        names.push(characterName);
      }

      castRegistry.characters = names;
      raw.cast_registry = castRegistry;
      const content = yaml.dump(raw, { sortKeys: false, lineWidth: -1 });
      await this.adapter.writeFile(projectPath, content);
    } catch {
      // ignore
    }
  }
}
