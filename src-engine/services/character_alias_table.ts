// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 角色别名归一化表：`{auPath}/characters/*.md` frontmatter → `Record<主名, 别名[]>`。
 *
 * 背景：normalize_characters / sanitize_known_to / buildCharacterInfoBlock 的
 * character_aliases 参数全链就绪，但此前全产品没有任何调用方构建过非 null 的表
 * （M3 批一查实）——用户在角色卡上填的别名从未生效。本模块是该表的**唯一构建通道**，
 * 消费端（engine-facts 的提取/编辑/落库、facts_extraction_task）经
 * CharacterAliasManager.get 取表。
 *
 * 缓存设计（仿 RagManager 的 per-AU 缓存，但表体量极小故不设 LRU 上限）：
 * - 命中判据 = characters/ 目录 .md 文件名集合签名（一次 listDir，零文件读）。
 *   文件增/删/改名/导入/恢复即使漏挂显式失效也会被签名差异兜住；
 * - 内容修改（签名不变）靠写入口显式 invalidate（engine-lore saveLore 等收口处调用）；
 * - epoch 守卫：构建在飞期间被 invalidate → 结果不落缓存（不缓存已知可能脏的数据）。
 * - get 永不抛错：目录读失败降级 null、单卡读失败跳过该卡，均 logCatch 可见，
 *   不阻塞提取与编辑主流程（无表 = 不归一化 = 该功能出现前的现状）。
 */

import type { PlatformAdapter } from "../platform/adapter.js";
import { AU_CHARACTERS_DIR, parseCharacterCard } from "../domain/character_card.js";
import { logCatch, warnAlways } from "../logger/index.js";

export interface CharacterCardInput {
  name: string;
  aliases: string[];
}

/**
 * 由角色卡集合构建别名表。冲突规则（保「归一化不吞并/不归错角色」的数据正确性）：
 * - 同主名多卡（大小写不敏感）→ 别名合并（union，主名保首见写法）；
 * - 别名与任一主名相撞（大小写不敏感）→ 剔除该别名——主名优先，不允许把 A 的
 *   正式名当成 B 的别名把 A 吞并进 B；
 * - 同一别名被 ≥2 个主名认领 → 双方都剔除（歧义别名宁可不归一，不可归错）；
 * - 每张卡都进表（别名可为空数组——normalize 仍能顺带纠正主名大小写并去重）；
 * - 无有效卡 → null（与「无表」同表示，normalize/prompt 渲染按无别名处理）。
 */
export function buildAliasTable(cards: CharacterCardInput[]): Record<string, string[]> | null {
  // 同主名合并（大小写不敏感），主名保首见写法；seen 按小写去重卡间重复别名
  const byMain = new Map<string, { main: string; aliases: string[]; seen: Set<string> }>();
  for (const card of cards) {
    const main = card.name.trim();
    if (!main) continue;
    const mainKey = main.toLowerCase();
    let entry = byMain.get(mainKey);
    if (!entry) {
      entry = { main, aliases: [], seen: new Set() };
      byMain.set(mainKey, entry);
    }
    for (const rawAlias of card.aliases) {
      const alias = rawAlias.trim();
      if (!alias) continue;
      const key = alias.toLowerCase();
      if (entry.seen.has(key)) continue;
      entry.seen.add(key);
      entry.aliases.push(alias);
    }
  }
  if (byMain.size === 0) return null;

  // 别名认领计数（跨主名歧义判定；同主名内已去重，每主名至多计 1 次）
  const claimCount = new Map<string, number>();
  for (const { seen } of byMain.values()) {
    for (const key of seen) claimCount.set(key, (claimCount.get(key) ?? 0) + 1);
  }

  const table: Record<string, string[]> = {};
  const droppedMainCollision: string[] = [];
  const droppedAmbiguous: string[] = [];
  for (const { main, aliases } of byMain.values()) {
    const kept: string[] = [];
    for (const alias of aliases) {
      const key = alias.toLowerCase();
      if (byMain.has(key)) {
        droppedMainCollision.push(alias);
        continue;
      }
      if ((claimCount.get(key) ?? 0) >= 2) {
        droppedAmbiguous.push(alias);
        continue;
      }
      kept.push(alias);
    }
    table[main] = kept;
  }
  if (droppedMainCollision.length > 0 || droppedAmbiguous.length > 0) {
    warnAlways("character_aliases", "别名表存在冲突项，已剔除、不参与归一化", {
      collideWithMainName: droppedMainCollision,
      claimedByMultiple: droppedAmbiguous,
    });
  }
  return table;
}

interface CacheEntry {
  signature: string;
  table: Record<string, string[]> | null;
}

export class CharacterAliasManager {
  private cache = new Map<string, CacheEntry>();
  /**
   * 在飞构建（并发 get 共享一次构建）。注意：签名已变但旧构建仍在飞时，后到的 get
   * 会拿到旧构建结果——有界陈旧，下一次 get 因签名不匹配自愈；应用内写入还会
   * 经 invalidate 立即清掉在飞引用。
   */
  private inflight = new Map<string, Promise<Record<string, string[]> | null>>();
  /** 失效纪元：invalidate 自增；构建在飞期间纪元变化 → 结果不落缓存（RagManager 同款守卫）。 */
  private epochs = new Map<string, number>();

  constructor(private adapter: PlatformAdapter) {}

  private epochOf(auPath: string): number {
    return this.epochs.get(auPath) ?? 0;
  }

  /**
   * 角色卡变更收口处调用：engine-lore 的 saveLore / deleteLore / importFromFandom、
   * engine-trash 恢复角色卡、engine-fandoms 删 AU/fandom（防同名重建继承陈旧表）。
   */
  invalidate(auPath: string): void {
    this.epochs.set(auPath, this.epochOf(auPath) + 1);
    this.cache.delete(auPath);
    this.inflight.delete(auPath);
  }

  /** 取该 AU 的别名表；无角色卡 → null。永不抛错（降级路径见模块头注释）。 */
  async get(auPath: string): Promise<Record<string, string[]> | null> {
    let filenames: string[];
    try {
      filenames = await this.listCardFiles(auPath);
    } catch (err) {
      logCatch("character_aliases", `列举角色卡目录失败，本次按无别名表降级: ${auPath}`, err);
      return null;
    }
    const signature = filenames.join("\n");

    const cached = this.cache.get(auPath);
    if (cached && cached.signature === signature) return cached.table;

    const inflight = this.inflight.get(auPath);
    if (inflight) return inflight;

    const epochAtStart = this.epochOf(auPath);
    const buildPromise = this.build(auPath, filenames)
      .then((table) => {
        if (this.epochOf(auPath) === epochAtStart) {
          this.cache.set(auPath, { signature, table });
        }
        return table;
      })
      .finally(() => {
        if (this.inflight.get(auPath) === buildPromise) this.inflight.delete(auPath);
      });
    this.inflight.set(auPath, buildPromise);
    return buildPromise;
  }

  private async listCardFiles(auPath: string): Promise<string[]> {
    const dir = `${auPath}/${AU_CHARACTERS_DIR}`;
    // exists 前置：listDir 对不存在目录的行为三端漂移（Web mock 返回 []、Tauri 抛错），
    // 与 engine-lore.listLoreFiles 同款防御。
    if (!(await this.adapter.exists(dir))) return [];
    const entries = await this.adapter.listDir(dir);
    return entries.filter((f) => f.endsWith(".md")).sort();
  }

  private async build(auPath: string, filenames: string[]): Promise<Record<string, string[]> | null> {
    if (filenames.length === 0) return null;
    const dir = `${auPath}/${AU_CHARACTERS_DIR}`;
    const cards = await Promise.all(
      filenames.map(async (filename): Promise<CharacterCardInput | null> => {
        try {
          const raw = await this.adapter.readFile(`${dir}/${filename}`);
          const parsed = parseCharacterCard(raw);
          // name 缺失回退文件名（去 .md）：历史卡/手工放置的文件也进表，主名至少可做大小写归一
          const name = parsed.name ?? filename.replace(/\.md$/, "").trim();
          if (!name) return null;
          return { name, aliases: parsed.aliases };
        } catch (err) {
          // 部分表仍正确可用；缺的角色只是不归一化（与无表现状相同），不整表作废
          logCatch("character_aliases", `读取角色卡失败，跳过该卡: ${filename}`, err);
          return null;
        }
      }),
    );
    return buildAliasTable(cards.filter((c): c is CharacterCardInput => c !== null));
  }
}
