// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 垃圾箱服务。参见 D-0023。
 * .trash/ + manifest.jsonl 实现软删除与恢复。默认保留 30 天。
 */

import matter from "gray-matter";
import yaml from "js-yaml";
import type { PlatformAdapter } from "../platform/adapter.js";
import { joinPath } from "../repositories/implementations/file_utils.js";

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

  async move_tree_to_trash(
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
    const trashRel = `${relativePath}_${ts}`;
    const trashRoot = joinPath(scopeRoot, ".trash", trashRel);
    const copiedFiles: Array<{ source: string; trash: string }> = [];

    try {
      for (const fileRel of files) {
        const source = joinPath(sourceRoot, fileRel);
        const trashTarget = joinPath(trashRoot, fileRel);
        await this.copyTextFile(source, trashTarget);
        copiedFiles.push({ source, trash: trashTarget });
      }

      for (const { source } of copiedFiles) {
        await this.adapter.deleteFile(source);
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
      return entry;
    } catch (error) {
      await this.restoreCopiedTree(copiedFiles);
      await this.deleteCopiedTree(copiedFiles.map((item) => item.trash));
      throw error;
    }
  }

  async move_to_trash(
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
    const trashRel = `${stem}_${ts}${ext}`;

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

    // 移动（read + write + delete）
    try {
      const content = await this.adapter.readFile(source);
      const dir = trashTarget.substring(0, trashTarget.lastIndexOf("/"));
      await this.adapter.mkdir(dir);
      await this.adapter.writeFile(trashTarget, content);
      await this.adapter.deleteFile(source);
    } catch {
      throw new Error(`移动文件失败: ${source} → ${trashTarget}`);
    }

    // cast_registry 联动
    if (characterName) {
      await this.updateCastRegistry(scopeRoot, characterName, "remove");
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

    await this.appendManifest(scopeRoot, entry);
    return entry;
  }

  async list_trash(scopeRoot: string): Promise<TrashEntry[]> {
    return this.readManifest(scopeRoot);
  }

  async restore(scopeRoot: string, trashId: string): Promise<TrashEntry> {
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

  private async restoreCopiedTree(copiedFiles: Array<{ source: string; trash: string }>): Promise<void> {
    for (const item of [...copiedFiles].reverse()) {
      if (await this.adapter.exists(item.source)) continue;
      try {
        await this.copyTextFile(item.trash, item.source);
      } catch {
        // best effort rollback
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
      const parsed = matter(content);
      const name = parsed.data?.name;
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
