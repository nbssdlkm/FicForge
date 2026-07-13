// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 章节角色扫描。参见 PRD §2.6.5 scanCharactersInChapter。 */

/**
 * 扫描章节正文中出场的角色。
 *
 * Phase 1 只走前 2 档匹配：
 *   ① cast_registry.characters 角色名
 *   ② 各角色 aliases 别名
 */
export function scanCharactersInChapter(
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
    // Object.hasOwn 而非 `mainName in result`：主名可为 "constructor"/"toString" 等
    // Object.prototype 键，裸 `in` 会命中原型链把首次出现误判为「已匹配过」而 continue 跳过，
    // 该角色永不入表。用 own-property 判定后，名为 constructor 的角色也能正常记录。
    if (Object.hasOwn(result, mainName)) {
      continue; // 已通过更优先的名字匹配过
    }
    if (chapter_text.includes(name)) {
      setLastSeen(result, mainName, chapter_num);
    }
  }

  return result;
}

/**
 * 安全写入「角色名 → 章号」映射（扫描与合并两处写点共用，杜绝防护漂移）。
 *
 * 用 defineProperty 而非裸 `map[name] =`：名为 "__proto__" 的键裸赋值会命中 Object.prototype 的
 * 原型 setter 被静默丢弃（该角色永不入表、下轮重试仍丢），defineProperty 强制建自有数据属性、
 * JSON/YAML 往返正确。其余原型键（constructor/toString）裸写本就建自有属性，此处一并收口
 * （盲审 R5 codex：合并写侧的 __proto__ 缺口）。读侧的原型键防护见各调用点的 Object.hasOwn。
 */
function setLastSeen(map: Record<string, number>, name: string, chapterNum: number): void {
  Object.defineProperty(map, name, { value: chapterNum, writable: true, enumerable: true, configurable: true });
}

/**
 * 把一次 scanCharactersInChapter 的结果合并进 characters_last_seen 累加器，逐名取较大章号。
 *
 * 全代码库「合并 characters_last_seen」的唯一入口 —— confirm / undo / dirty / recalc / import
 * 五条路径共用此函数，杜绝逐点手写 max-merge 时的防护漂移（盲审 R5 正确性 L1）。
 * 用 Object.hasOwn 判存在而非裸读 `target[name] ?? 0`：角色名可为 "constructor"/"toString" 等
 * Object.prototype 继承键，裸读会拿到原型上的函数、`?? 0` 兜不住（函数非 null/undefined），
 * 令 `chapterNum > 函数`（NaN 比较）恒 false → 该角色永不入表。写侧 __proto__ 防护见 setLastSeen。
 */
export function mergeCharactersLastSeen(target: Record<string, number>, scanned: Record<string, number>): void {
  for (const [name, chapterNum] of Object.entries(scanned)) {
    if (!Object.hasOwn(target, name) || chapterNum > target[name]) {
      setLastSeen(target, name, chapterNum);
    }
  }
}
