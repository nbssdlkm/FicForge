// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Lore 编辑共享工具函数。
 * 从 AuLoreLayout.tsx / FandomLoreLayout.tsx 提取，纯函数。
 */

import { parseCharacterCard } from "@ficforge/engine";

// ---------------------------------------------------------------------------
// 共享类型（AuLore / FandomLore 各 hook / 组件的单一定义点）
// ---------------------------------------------------------------------------

/** AU 资料的两个分类目录 */
export type LoreCategory = "characters" | "worldbuilding";

/** Fandom 资料的两个分类目录 */
export type FandomLoreCategory = "core_characters" | "core_worldbuilding";

export type LoreFileEntry = {
  name: string;
  filename: string;
};

// ---------------------------------------------------------------------------
// 模板
// ---------------------------------------------------------------------------

export function buildDefaultCharacterContent(name: string): string {
  return `---\nname: ${name}\naliases: []\n---\n\n# ${name}\n\n`;
}

export function buildDefaultWorldbuildingContent(name: string): string {
  return `# ${name}\n\n`;
}

/**
 * Fandom 核心资料（core_characters / core_worldbuilding 通用）的新建模板。
 * 桌面与移动端共用 —— 此前移动端各写一版且给 worldbuilding 塞了多余的 name
 * frontmatter（2026-07-10 合并审阅：跨端产物结构漂移，收敛单源）。
 */
export function buildDefaultFandomLoreContent(displayName: string): string {
  return `# ${displayName}\n\n[]`;
}

// ---------------------------------------------------------------------------
// 编辑器判据
// ---------------------------------------------------------------------------

/**
 * 编辑器脏判据（弃改确认 / 保存禁用 / reconcile 重读的门槛）——
 * 桌面 FandomLore 与移动端共用同一判据，禁两处各写（会随时间漂移）。
 */
export function isLoreEditorDirty(selectedFile: string | null, editorContent: string, savedContent: string): boolean {
  return selectedFile !== null && editorContent !== savedContent;
}

// ---------------------------------------------------------------------------
// Alias 操作
// ---------------------------------------------------------------------------

/**
 * 读取角色卡别名 —— 委托引擎 parseCharacterCard（真 YAML 解析 + safeMatter H6 防线）。
 * 此前此处手写正则扫 frontmatter（第三份 frontmatter 判据，R4 架构维 M4 同族）：引号/转义/
 * 内联数组处理与引擎不一致，编辑器看到的别名可能与归一化实际生效的不一样。现在编辑器
 * 显示的就是引擎的有效视图（trim/大小写去重/剔除与主名相同项 —— 与别名表构建同判据）。
 */
export function parseAliasesFromContent(content: string): string[] {
  return parseCharacterCard(content).aliases;
}

export function setAliasesInContent(content: string, aliases: string[]): string {
  const aliasYaml = aliases.length > 0 ? `aliases: [${aliases.join(", ")}]` : "aliases: []";
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return content;
  const fm = match[1];
  const lines = fm.split("\n");
  const idx = lines.findIndex((l) => l.startsWith("aliases:"));
  if (idx >= 0) {
    let endIdx = idx + 1;
    while (endIdx < lines.length && lines[endIdx].match(/^\s*-\s/)) endIdx++;
    lines.splice(idx, endIdx - idx, aliasYaml);
  } else {
    const nameIdx = lines.findIndex((l) => l.startsWith("name:"));
    lines.splice(nameIdx >= 0 ? nameIdx + 1 : lines.length, 0, aliasYaml);
  }
  return content.replace(/^---\n[\s\S]*?\n---/, `---\n${lines.join("\n")}\n---`);
}

// ---------------------------------------------------------------------------
// 路径 & 文件名工具
// ---------------------------------------------------------------------------

export function toCanonicalCreateKey(value: string): string {
  return value
    .trim()
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "_");
}

export function deriveFandomPath(auPath: string): string {
  return auPath.replace(/\/aus\/[^/]+$/, "");
}

/** fandom 路径 → 目录名（listFandomFiles 等 API 以目录名寻址） */
export function fandomDirNameOf(fandomPath: string | undefined): string {
  return fandomPath?.split("/").pop() || "";
}
