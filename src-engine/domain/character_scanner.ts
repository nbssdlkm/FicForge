// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 章节角色扫描。参见 PRD §2.6.5 scan_characters_in_chapter。 */

/**
 * 扫描章节正文中出场的角色。
 *
 * Phase 1 只走前 2 档匹配：
 *   ① cast_registry.characters 角色名
 *   ② 各角色 aliases 别名
 */
export function scan_characters_in_chapter(
  chapter_text: string,
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null = null,
  chapter_num = 0,
): Record<string, number> {
  if (!chapter_text.trim()) {
    return {};
  }

  // ① 收集 cast_registry 中所有角色名
  const allNames = new Set<string>();
  const names = cast_registry.characters;
  if (Array.isArray(names)) {
    for (const name of names) {
      allNames.add(name);
    }
  }

  // 建立 搜索名 → 主名 映射
  const searchMap = new Map<string, string>();
  for (const name of allNames) {
    searchMap.set(name, name);
  }

  // ② aliases 映射
  if (character_aliases) {
    for (const [mainName, aliases] of Object.entries(character_aliases)) {
      for (const alias of aliases) {
        searchMap.set(alias, mainName);
      }
    }
  }

  // 按名字长度降序排列（长名优先匹配）
  const sortedNames = [...searchMap.keys()].sort((a, b) => b.length - a.length);

  // 在正文中搜索
  const result: Record<string, number> = {};
  for (const name of sortedNames) {
    const mainName = searchMap.get(name)!;
    if (mainName in result) {
      continue; // 已通过更优先的名字匹配过
    }
    if (chapter_text.includes(name)) {
      result[mainName] = chapter_num;
    }
  }

  return result;
}
