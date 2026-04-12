// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Lore 编辑共享工具函数。
 * 从 AuLoreLayout.tsx / FandomLoreLayout.tsx 提取，纯函数。
 */

// ---------------------------------------------------------------------------
// 模板
// ---------------------------------------------------------------------------

export function buildDefaultCharacterContent(name: string): string {
  return `---\nname: ${name}\naliases: []\n---\n\n# ${name}\n\n`;
}

export function buildDefaultWorldbuildingContent(name: string): string {
  return `# ${name}\n\n`;
}

// ---------------------------------------------------------------------------
// Alias 操作
// ---------------------------------------------------------------------------

export function parseAliasesFromContent(content: string): string[] {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];
  const fm = match[1];
  // Parse aliases: [a, b, c] or aliases:\n- a\n- b
  const inlineMatch = fm.match(/aliases:\s*\[([^\]]*)\]/);
  if (inlineMatch) {
    return inlineMatch[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  const lines = fm.split('\n');
  const idx = lines.findIndex(l => l.startsWith('aliases:'));
  if (idx < 0) return [];
  const result: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*(.+)/);
    if (m) result.push(m[1].trim().replace(/^["']|["']$/g, ''));
    else break;
  }
  return result;
}

export function setAliasesInContent(content: string, aliases: string[]): string {
  const aliasYaml = aliases.length > 0 ? `aliases: [${aliases.join(', ')}]` : 'aliases: []';
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return content;
  const fm = match[1];
  const lines = fm.split('\n');
  const idx = lines.findIndex(l => l.startsWith('aliases:'));
  if (idx >= 0) {
    let endIdx = idx + 1;
    while (endIdx < lines.length && lines[endIdx].match(/^\s*-\s/)) endIdx++;
    lines.splice(idx, endIdx - idx, aliasYaml);
  } else {
    const nameIdx = lines.findIndex(l => l.startsWith('name:'));
    lines.splice(nameIdx >= 0 ? nameIdx + 1 : lines.length, 0, aliasYaml);
  }
  return content.replace(/^---\n[\s\S]*?\n---/, `---\n${lines.join('\n')}\n---`);
}

// ---------------------------------------------------------------------------
// 路径 & 文件名工具
// ---------------------------------------------------------------------------

export function toCanonicalCreateKey(value: string): string {
  return value
    .trim()
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '_');
}

export function deriveFandomPath(auPath: string): string {
  return auPath.replace(/\/aus\/[^/]+$/, '');
}
