// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 生成来源与统计快照。参见 PRD §2.6.4 / §3.4 frontmatter。 */

export interface GeneratedWith {
  mode: string; // api / local / ollama
  model: string;
  temperature: number;
  top_p: number;
  input_tokens: number; // 本次组装的输入 token 数
  output_tokens: number; // 模型实际输出 token 数
  char_count: number; // 正文字数（不含 frontmatter）
  duration_ms: number; // 生成耗时（毫秒）
  generated_at: string; // ISO 8601
}

export function createGeneratedWith(partial?: Partial<GeneratedWith>): GeneratedWith {
  return {
    mode: "",
    model: "",
    temperature: 0,
    top_p: 0,
    input_tokens: 0,
    output_tokens: 0,
    char_count: 0,
    duration_ms: 0,
    generated_at: "",
    ...partial,
  };
}

/**
 * GeneratedWith ↔ frontmatter YAML 的单一真相源（盲审 R3 M8）。
 * 此前 file_draft / file_chapter 各手抄一份读/写映射（共 4 处），新增第 10 个字段
 * 会在某些副本被静默丢弃（项目自述「新字段沉默丢弃」持久化断链）。收敛到此处后，
 * 增删字段只改这一处 + interface + createGeneratedWith。
 */

/** 从 frontmatter 里的 generated_with 原始对象还原（缺失/非对象 → null）。 */
export function generatedWithFromYaml(raw: unknown): GeneratedWith | null {
  if (!raw || typeof raw !== "object") return null;
  const gw = raw as Record<string, unknown>;
  return createGeneratedWith({
    mode: (gw.mode as string) ?? "",
    model: (gw.model as string) ?? "",
    temperature: Number(gw.temperature ?? 0),
    top_p: Number(gw.top_p ?? 0),
    input_tokens: Number(gw.input_tokens ?? 0),
    output_tokens: Number(gw.output_tokens ?? 0),
    char_count: Number(gw.char_count ?? 0),
    duration_ms: Number(gw.duration_ms ?? 0),
    generated_at: (gw.generated_at as string) ?? "",
  });
}

/** 序列化为 frontmatter 里的 generated_with 对象（字段全量、顺序稳定）。 */
export function generatedWithToYaml(gw: GeneratedWith): Record<string, unknown> {
  return {
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
