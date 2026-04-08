// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 生成来源与统计快照。参见 PRD §2.6.4 / §3.4 frontmatter。 */

export interface GeneratedWith {
  mode: string;           // api / local / ollama
  model: string;
  temperature: number;
  top_p: number;
  input_tokens: number;   // 本次组装的输入 token 数
  output_tokens: number;  // 模型实际输出 token 数
  char_count: number;     // 正文字数（不含 frontmatter）
  duration_ms: number;    // 生成耗时（毫秒）
  generated_at: string;   // ISO 8601
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
