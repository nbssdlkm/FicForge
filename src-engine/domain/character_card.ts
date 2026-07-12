// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 角色卡（`{auPath}/characters/*.md`）frontmatter schema 的单一真相源。
 *
 * 为什么放 domain：schema 知识（合法键集合 + name/aliases 解析口径）同时被
 * trash_service（删除/恢复的 cast_registry 联动）与 character_alias_table
 * （别名归一化表构建）消费——两处各写会随 settings-chat 提示词约定的 schema
 * 演进而漂移；domain 不依赖 services，双方统一从这里 import。
 */

import { safeMatter } from "./frontmatter.js";

/**
 * 角色设定文件 frontmatter 的合法键集合（settings-chat 提示词约定的 schema：
 * name / aliases / importance，见 prompts/zh.ts「提取 frontmatter 元数据」段）。
 * safeMatter 用它区分真 frontmatter 与「正文以 `---` 分割线开头」——裸 matter()
 * 在后者会吞正文/对非法 YAML 抛错（审计 H6 同族）。schema 增删键时此集合必须同步。
 */
export const KNOWN_CHARACTER_META_KEYS: ReadonlySet<string> = new Set(["name", "aliases", "importance"]);

/** AU 下角色卡所在目录名（engine-lore 写入口 / trash cast_registry 联动 / 别名表构建共用）。 */
export const AU_CHARACTERS_DIR = "characters";

export interface ParsedCharacterCard {
  /** frontmatter `name`（trim 后）；缺失/非字符串/空白 → null，回退口径由调用方决定。 */
  name: string | null;
  /** frontmatter `aliases` 合法项：字符串 → trim → 去空 → 卡内大小写不敏感去重 → 剔除与本卡 name 相同者。 */
  aliases: string[];
}

/**
 * 解析一张角色卡的 frontmatter。safeMatter 已保证「正文以 --- 开头」「YAML 非法」
 * 等形态安全降级为无 frontmatter（此时返回 { name: null, aliases: [] }），本函数不抛错。
 */
export function parseCharacterCard(raw: string): ParsedCharacterCard {
  const parsed = safeMatter(raw, KNOWN_CHARACTER_META_KEYS);

  const rawName = parsed.data.name;
  const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : null;

  const rawAliases = parsed.data.aliases;
  const aliases: string[] = [];
  if (Array.isArray(rawAliases)) {
    const seen = new Set<string>();
    for (const item of rawAliases) {
      if (typeof item !== "string") continue;
      const alias = item.trim();
      if (!alias) continue;
      const key = alias.toLowerCase();
      if (seen.has(key)) continue;
      // 别名 = 本卡主名：无信息量（normalize 本就映射主名→主名），剔除
      if (name && key === name.toLowerCase()) continue;
      seen.add(key);
      aliases.push(alias);
    }
  }
  return { name, aliases };
}
