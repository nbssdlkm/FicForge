// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 垃圾箱服务。参见 D-0023。
 * .trash/ + manifest.jsonl 实现软删除与恢复。默认保留 30 天。
 */

import * as yaml from "js-yaml";
import { AU_CHARACTERS_DIR, parseCharacterCard } from "../domain/character_card.js";
import type { PlatformAdapter } from "../platform/adapter.js";
import { atomicWrite, dumpYaml, joinPath } from "../utils/file_utils.js";
import { PROJECT_YAML } from "../domain/paths.js";
import { warnAlways } from "../logger/index.js";
import { withProjectFileLock } from "./au_lock.js";

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

/**
 * restore 冲突策略（F5）：
 * - `abort`（默认，= 历史行为）：原位已有不同内容的同名文件时中止，回收站完整保留，抛冲突错误。
 * - `overwrite`：以回收站副本为准覆盖原位。**覆盖前先把原位当前文件备份进本条目的
 *   overwrite-backup sidecar**（`.trash/<trash_path>.overwrite-backup/…`），绝不无备份覆盖
 *   —— 用户「原位被自己编辑过 / 被半恢复文件占住」时得以强制恢复，且被覆盖的当前版本可从
 *   sidecar 手工找回。
 */
export type RestoreConflictPolicy = "abort" | "overwrite";

/**
 * 冲突错误码常量（单一真相源）：API 层据此把 message 映射成 friendly i18n 文案。
 * restore 冲突用 `RESTORE_CONFLICT` 前缀，permanent_delete 半恢复用 `HALF_RESTORED` 前缀。
 */
export const RESTORE_CONFLICT_MARKER = "RESTORE_CONFLICT";
export const HALF_RESTORED_MARKER = "HALF_RESTORED";

/**
 * overwrite 恢复时被覆盖的原位版本备份，其在回收站里的 entity_type。
 * 走单文件生命周期（metadata.is_directory=false），TrashPanel 对未知类型归为文件（不得以 `_dir` 结尾、
 * 不得是 fandom/au，否则被误判为目录）。
 */
export const OVERWRITE_BACKUP_ENTITY_TYPE = "overwrite_backup";

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
    this.opChain.set(
      scopeRoot,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  async move_tree_to_trash(
    scopeRoot: string,
    relativePath: string,
    entityType: string,
    entityName: string,
  ): Promise<TrashEntry> {
    return this.runExclusive(scopeRoot, () => this._moveTreeToTrash(scopeRoot, relativePath, entityType, entityName));
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
        warnAlways(
          "trash",
          `目录删除回滚不完整：${restoreFailures.length} 个文件未能恢复到原位，其 .trash 副本已保留，可手工找回`,
          {
            failures: restoreFailures.map((f) => `${f.source} ← ${f.trash} (${f.message})`),
          },
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
    return this.runExclusive(scopeRoot, () => this._moveToTrash(scopeRoot, relativePath, entityType, entityName));
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
      // 对称性（LOW）：预判该名此刻是否在册 → 存进 metadata。恢复时只在删除确实移除过
      // （flag=true）才补回，避免「用户已把角色移出名册但留了文件 / 改了 frontmatter 名」时，
      // 删→恢复把一个本不在册的名字静默注入（remove 有条件、add 无条件的不对称）。
      // 预判在 runExclusive(scopeRoot) 串行段内，与稍后的实际 remove 之间名册不会变，故准确。
      meta.cast_registry_removed = characterName ? await this.castRegistryContains(scopeRoot, characterName) : false;
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
      // 原子写（F5）：崩溃只会留下 .tmp，正式路径要么完整要么缺失，不出现半截副本。
      await atomicWrite(this.adapter, trashTarget, content);
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
        warnAlways("trash", "cast_registry remove 失败；名册可能残留该角色，可经 restore 修正", {
          error: (err as Error).message,
        });
      }
    }

    return entry;
  }

  async list_trash(scopeRoot: string): Promise<TrashEntry[]> {
    return this.readManifest(scopeRoot);
  }

  async restore(scopeRoot: string, trashId: string, onConflict: RestoreConflictPolicy = "abort"): Promise<TrashEntry> {
    return this.runExclusive(scopeRoot, () => this._restore(scopeRoot, trashId, onConflict));
  }

  private async _restore(scopeRoot: string, trashId: string, onConflict: RestoreConflictPolicy): Promise<TrashEntry> {
    const entries = await this.readManifest(scopeRoot);
    const targetEntry = entries.find((e) => e.trash_id === trashId);
    if (!targetEntry) throw new Error(`垃圾箱项不存在: ${trashId}`);

    if (this.isDirectoryEntry(targetEntry)) {
      return this.restoreDirectoryEntry(scopeRoot, targetEntry, onConflict);
    }

    const originalDest = joinPath(scopeRoot, targetEntry.original_path);
    const trashSource = joinPath(scopeRoot, ".trash", targetEntry.trash_path);
    // 先确认回收站副本仍在，再决定是否备份原位 —— 副本已丢时直接失败，不白备份 + 登记多余
    // overwrite_backup 条目（对抗审 LOW：备份前置在存在性检查之前会造一条冗余备份条目）。
    if (!(await this.adapter.exists(trashSource))) {
      await this.removeFromManifest(scopeRoot, trashId);
      throw new Error(`垃圾箱中的文件已丢失: ${targetEntry.trash_path}`);
    }

    if (await this.adapter.exists(originalDest)) {
      if (onConflict !== "overwrite") {
        // F5：区分场景文案 —— 原位已有不同内容的同名文件（用户新建 / 编辑过），
        // API 层据 RESTORE_CONFLICT_MARKER 映射成 friendly 文案，UI 提供「以回收站版本覆盖」出路。
        throw new Error(
          `${RESTORE_CONFLICT_MARKER}: 无法恢复，原路径已存在同名文件（内容可能已被改动）: ${targetEntry.original_path}`,
        );
      }
      // overwrite：覆盖前先把原位当前文件备份进本条目 sidecar（不许无备份覆盖）。
      await this.backupBeforeOverwrite(scopeRoot, targetEntry, "");
    }

    // 兼容 adapter：使用 read + write + delete 实现“移动”。写入原子（F5）：
    // 崩溃只留 .tmp，原位要么完整恢复要么保持缺失，不出现半截文件。
    const content = await this.adapter.readFile(trashSource);
    const dir = originalDest.substring(0, originalDest.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    await atomicWrite(this.adapter, originalDest, content);
    await this.adapter.deleteFile(trashSource);
    await this.removeFromManifest(scopeRoot, trashId);

    // cast_registry 联动（对称性 LOW）：只在删除时确实从名册移除过（cast_registry_removed===true）
    // 才补回。旧条目 / 无此字段 → undefined（!== false）→ 保持旧的无条件 add 语义（不回归）。
    if (
      this.shouldSyncCastRegistry(targetEntry.original_path, scopeRoot) &&
      targetEntry.metadata?.cast_registry_removed !== false
    ) {
      const name = await this.readCharacterName(originalDest);
      if (name) await this.updateCastRegistry(scopeRoot, name, "add");
    }

    return targetEntry;
  }

  /** project.yaml 的 cast_registry.characters 是否含指定名（删除时预判是否需在恢复时补回，对称性 LOW）。 */
  private async castRegistryContains(scopeRoot: string, name: string): Promise<boolean> {
    const projectPath = joinPath(scopeRoot, PROJECT_YAML);
    if (!(await this.adapter.exists(projectPath))) return false;
    try {
      const text = await this.adapter.readFile(projectPath);
      const raw = (yaml.load(text) ?? {}) as Record<string, unknown>;
      const castRegistry = (raw.cast_registry ?? {}) as Record<string, unknown>;
      const names = (castRegistry.characters ?? []) as unknown[];
      return names.some((n) => n === name);
    } catch {
      return false;
    }
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

      // M30 + F5：半成品保护。若该目录处于"半恢复"状态（部分文件已在原位、其余仍只在 trash），
      // 直接删整棵 trash 树会把"只在 trash 的那些文件"的唯一副本一并销毁 —— 用户本想用
      // permanent_delete 清掉一个"恢复失败"的残局，结果反而丢了还没恢复的数据。
      // 判据（F5 修正）：以「文件是否已回到原位」而非「是否与 trash 逐字节一致」判定 ——
      //   anyInPlace   = 至少一个文件已在原位（不论已被用户编辑：编辑过=依旧在原位）
      //   anyOnlyInTrash = 至少一个文件原位缺失（trash 副本是唯一版本）
      // 二者同真 = 半恢复：删 trash 会丢 only-in-trash 的文件。旧判据只认「逐字节一致=已恢复」，
      // 用户编辑了已恢复文件后该文件不再字节一致 → 被误判为未恢复 → anyRestored 全 false →
      // 放行删除，静默丢掉仍只在 trash 的兄弟文件（F5 死锁态的第二半）。改按「在原位与否」后，
      // 编辑过的已恢复文件仍算 in-place，半恢复态被正确识别、拒绝，逼用户走 restore（含覆盖）出路。
      let anyInPlace = false;
      let anyOnlyInTrash = false;
      for (const fileRel of files) {
        const originalDest = joinPath(scopeRoot, targetEntry.original_path, fileRel);
        if (await this.adapter.exists(originalDest)) {
          anyInPlace = true;
        } else {
          anyOnlyInTrash = true;
        }
      }
      if (anyInPlace && anyOnlyInTrash) {
        // F5：带 HALF_RESTORED_MARKER，API 层映射成 friendly 文案指引用户先完成恢复
        //（restore 支持续传；原位被编辑过的冲突文件可用「以回收站版本覆盖」出路）。
        throw new Error(
          `${HALF_RESTORED_MARKER}: 无法永久删除：该目录处于半恢复状态，部分文件尚未恢复到原位，` +
            `直接删除会丢失这些文件。请先点击"恢复"完成续传后再删除。`,
        );
      }

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
        const expires = new Date(entry.expires_at).getTime();
        if (!Number.isNaN(expires)) {
          shouldPurge = now >= expires;
        } else {
          // expires_at 损坏/缺失（Invalid Date → NaN）：原实现 `now >= NaN` 恒 false → 该条目
          // 永不被常规清理、永久占盘（LOW）。回退用 deleted_at + retentionDays 判定；deleted_at
          // 也损坏则视为已过期清理（无法推断保留期的垃圾条目不该永久滞留）。
          const deleted = new Date(entry.deleted_at).getTime();
          shouldPurge = Number.isNaN(deleted) || now >= deleted + this.retentionDays * 86400000;
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
      } catch {}
    }
    return entries;
  }

  private async writeManifest(scopeRoot: string, entries: TrashEntry[]): Promise<void> {
    const mp = this.manifestPath(scopeRoot);
    const dir = mp.substring(0, mp.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    const content = entries.length > 0 ? entries.map((e) => JSON.stringify(e)).join("\n") + "\n" : "";
    // 原子写（F5）：manifest 是回收站的唯一真相源，截断即孤儿；rename 提交保完整。
    await atomicWrite(this.adapter, mp, content);
  }

  private async appendManifest(scopeRoot: string, entry: TrashEntry): Promise<void> {
    const mp = this.manifestPath(scopeRoot);
    const dir = mp.substring(0, mp.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    const line = JSON.stringify(entry) + "\n";
    const exists = await this.adapter.exists(mp);
    // 原子写（F5）：读改写 manifest 中途崩溃会截断唯一真相源 → 条目丢失 = 副本孤儿。
    if (exists) {
      const existing = await this.adapter.readFile(mp);
      const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
      await atomicWrite(this.adapter, mp, existing + prefix + line);
    } else {
      await atomicWrite(this.adapter, mp, line);
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

  private async restoreDirectoryEntry(
    scopeRoot: string,
    entry: TrashEntry,
    onConflict: RestoreConflictPolicy,
  ): Promise<TrashEntry> {
    const trashRoot = joinPath(scopeRoot, ".trash", entry.trash_path);
    if (!(await this.adapter.exists(trashRoot))) {
      await this.removeFromManifest(scopeRoot, entry.trash_id);
      throw new Error(`垃圾箱中的文件已丢失: ${entry.trash_path}`);
    }

    const files = await this.collectTreeFiles(trashRoot);

    // M30：冲突预检可续传。逐文件 copy 中途失败会留下"半成品"（部分文件已落回原位、
    // 但 trash 副本 + manifest 都还在）。旧代码的预检对任何已存在的 originalDest 一律
    // 报 restore conflict → 重试永远撞在自己上一轮恢复的那几个文件上，恢复被永久卡死。
    // 修法：预检时区分"半成品自身"（内容与 trash 副本逐字节一致 = 上一轮已恢复）与
    // "真冲突"（原位置已有不同内容的同名文件）。前者可跳过续传，仅后者才是硬冲突。
    // F5：真冲突时若 onConflict='overwrite'，先把原位当前文件备份进本条目 sidecar，
    // 再列入 pending 覆盖（不许无备份覆盖）；否则维持 abort 行为、抛带 marker 的冲突错误
    // ——这修复「用户编辑了半恢复目录里已恢复的文件后 restore/permanent_delete 双拒」的死锁。
    const pending: string[] = [];
    for (const fileRel of files) {
      const trashSource = joinPath(trashRoot, fileRel);
      const originalDest = joinPath(scopeRoot, entry.original_path, fileRel);
      if (await this.adapter.exists(originalDest)) {
        // 已存在：只有内容一致（半成品）才放行续传；否则是真冲突。
        const [destContent, srcContent] = await Promise.all([
          this.adapter.readFile(originalDest).catch(() => null),
          this.adapter.readFile(trashSource).catch(() => null),
        ]);
        if (destContent !== null && srcContent !== null && destContent === srcContent) {
          continue; // 上一轮已恢复该文件，续传时跳过
        }
        if (onConflict === "overwrite") {
          await this.backupBeforeOverwrite(scopeRoot, entry, fileRel);
          pending.push(fileRel); // 备份后列入覆盖
          continue;
        }
        throw new Error(`${RESTORE_CONFLICT_MARKER}: restore conflict: ${entry.original_path}/${fileRel}`);
      }
      pending.push(fileRel);
    }

    // 只 copy 尚未恢复的文件。逐文件失败不再让整体不可重试：收集失败清单，
    // 若有失败则抛错但保留已恢复部分 + trash 副本（下次 restore 从断点续传）。
    const failures: string[] = [];
    for (const fileRel of pending) {
      const trashSource = joinPath(trashRoot, fileRel);
      const originalDest = joinPath(scopeRoot, entry.original_path, fileRel);
      try {
        await this.copyTextFile(trashSource, originalDest);
      } catch (err) {
        failures.push(`${fileRel} (${(err as Error).message})`);
      }
    }
    if (failures.length > 0) {
      // trash 副本 + manifest 保留：已恢复的文件留在原位，未恢复的仍在 trash，
      // 再次 restore 会跳过已恢复者、只补剩余（续传）。
      throw new Error(
        `目录恢复未完成，${failures.length} 个文件未能写回原位（可再次点击恢复续传）: ${failures.join("; ")}`,
      );
    }

    // 全部文件已就位 → 清 trash 副本 + manifest（best-effort 删除，残留只是磁盘垃圾）。
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
        files.push(...(await this.collectTreeFiles(rootPath, relativePath)));
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
    // 原子写（F5）：copyTextFile 被树入回收站 / restore copy-back 复用；直写非原子在
    // Android 后台杀进程/断电时会留半截副本，损伤固化。atomicWrite 经 rename 提交，
    // 崩溃只剩 .tmp、目标要么完整要么缺失，回滚判据（源存在性 / 逐字节比对）不被污染。
    await atomicWrite(this.adapter, dest, content);
  }

  /** overwrite 恢复的备份 sidecar 根：`.trash/<trash_path>.overwrite-backup`。 */
  private overwriteBackupRoot(scopeRoot: string, entry: TrashEntry): string {
    return joinPath(scopeRoot, ".trash", `${entry.trash_path}.overwrite-backup`);
  }

  /**
   * overwrite 恢复覆盖原位文件前，把原位当前内容备份进本条目 sidecar（F5）。
   * fileRel="" 表示单文件条目（备份到 `<root>/__file__`）；目录条目按相对路径分层备份。
   * 「不许无备份覆盖」硬约束：备份写失败即抛错，让上层中止覆盖（宁可不恢复也不销毁当前版本）。
   * 原位文件确实不存在（exists→read 探测竞态）时无需备份，静默跳过 —— 此时覆盖不毁任何数据；
   * 但「存在却读失败」是故障，上抛中止（F-7）。备份目标已存在时追加 -2/-3 后缀不覆盖旧备份（F-8）。
   */
  private async backupBeforeOverwrite(scopeRoot: string, entry: TrashEntry, fileRel: string): Promise<void> {
    const originalDest = fileRel
      ? joinPath(scopeRoot, entry.original_path, fileRel)
      : joinPath(scopeRoot, entry.original_path);
    let current: string;
    try {
      current = await this.adapter.readFile(originalDest);
    } catch (err) {
      // F-7：只吞「文件确实不存在」（exists→read 之间的探测竞态）—— 此时覆盖不销毁任何数据。
      // 其余读失败（权限 / IO 故障）说明原位有文件却读不出，吞掉会变成「无备份覆盖」，
      // 必须上抛让 overwrite 中止；exists 复探失败也按仍存在处理（宁可中止，不冒险）。
      let stillExists = true;
      try {
        stillExists = await this.adapter.exists(originalDest);
      } catch {
        stillExists = true;
      }
      if (!stillExists) return;
      throw err;
    }
    // leaf（相对 sidecar 根的文件名）单一真相源：absolute backupTarget 与相对 trash_path 都由它派生，
    // 不依赖 joinPath 内部拼法。F-8：同条目重复 overwrite 不覆盖旧备份 —— 目标已存在时找空闲后缀
    // （-2 / -3 …），每一轮被覆盖的原位版本各留一份，各自独立登记进回收站可恢复。
    const sidecarRoot = this.overwriteBackupRoot(scopeRoot, entry);
    const sidecarRel = `${entry.trash_path}.overwrite-backup`; // 相对 .trash/ 的 sidecar 根
    const leafBase = fileRel || "__file__";
    let leaf = leafBase;
    for (let i = 2; await this.adapter.exists(joinPath(sidecarRoot, leaf)); i++) {
      leaf = `${leafBase}-${i}`;
    }
    const backupTarget = joinPath(sidecarRoot, leaf);
    const dir = backupTarget.substring(0, backupTarget.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    // 原子写：备份本身也不能留半截；失败向上抛，overwrite 中止（不无备份覆盖）。
    await atomicWrite(this.adapter, backupTarget, current);

    // 登记进回收站列表（最后一公里）：让被覆盖的原位版本可在回收站里看到、恢复、永久删除。
    // 单文件条目（is_directory=false → 走 _restore / permanent_delete / purge 的单文件分支，全链原生正确，
    // 无需改那些方法）。cast_registry_removed=false：命中 _restore 的 `!== false` 门 → 恢复角色文件备份
    // 时不向名册误加名字（正向复用 LOW-3 引入的同一机制）。恢复此备份时其 original_path 已被父恢复内容占住
    // → 触发既有 abort/overwrite 冲突处理（诚实弹「以回收站版本覆盖」），无需专用「撤销 restore」逻辑。
    const backupOriginalPath = fileRel ? joinPath(entry.original_path, fileRel) : entry.original_path;
    const now = new Date();
    const expires = new Date(now.getTime() + this.retentionDays * 86400000);
    await this.appendManifest(scopeRoot, {
      // 8 位随机（非 4 位）：目录 overwrite 恢复会在同一秒的循环里为多个冲突文件各登记一条备份，
      // 4 位（2^16）在文件数上百时有生日碰撞风险 → 同 id 会让第二条备份变孤儿/删不掉（对抗审 MED）。
      trash_id: `tr_${Math.floor(Date.now() / 1000)}_${crypto.randomUUID().slice(0, 8)}`,
      original_path: backupOriginalPath,
      trash_path: `${sidecarRel}/${leaf}`,
      entity_type: OVERWRITE_BACKUP_ENTITY_TYPE,
      entity_name: backupOriginalPath.split("/").pop() || backupOriginalPath,
      deleted_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
      expires_at: expires.toISOString().replace(/\.\d{3}Z$/, "Z"),
      metadata: {
        is_directory: false,
        overwrite_backup: true,
        source_trash_id: entry.trash_id,
        cast_registry_removed: false,
      },
    });
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
  private async deleteCopiesWithVerifiedSource(copiedFiles: Array<{ source: string; trash: string }>): Promise<void> {
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
    return relativePath.startsWith(`${AU_CHARACTERS_DIR}/`);
  }

  private async readCharacterName(path: string): Promise<string | null> {
    try {
      const content = await this.adapter.readFile(path);
      // parseCharacterCard（domain/character_card 单一真相源）不抛错；try/catch 只兜 readFile 失败
      return parseCharacterCard(content).name;
    } catch {
      return null;
    }
  }

  private async updateCastRegistry(scopeRoot: string, characterName: string, action: "add" | "remove"): Promise<void> {
    const projectPath = joinPath(scopeRoot, PROJECT_YAML);
    if (!(await this.adapter.exists(projectPath))) return;

    // 读改写整段包进 project.yaml 文件锁：与设置保存链（withProjectWrite / deletePinned）
    // 共享同一把锁，消除 cast_registry 并发丢更新（盲审 R3 M1）。文件锁是叶锁，
    // 此处已在 trash-mutex 内再取它不构成锁序反转（见 au_lock.withProjectFileLock 注释）。
    await withProjectFileLock(scopeRoot, async () => {
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
        const content = dumpYaml(raw);
        // 原子写（F5）：project.yaml 截断会连带丢整份工程配置，损失远超 cast_registry 一行。
        await atomicWrite(this.adapter, projectPath, content);
      } catch {
        // ignore
      }
    });
  }
}
