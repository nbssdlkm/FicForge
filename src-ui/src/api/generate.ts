/** 生成 API（SSE 流式） */

import { sseStream } from "./client";

export interface GenerateParams {
  au_path: string;
  chapter_num: number;
  user_input: string;
  input_type: "continue" | "instruction";
  session_llm?: object;
  session_params?: object;
}

export async function* generateChapter(params: GenerateParams) {
  for await (const event of sseStream("/api/v1/generate/stream", params)) {
    yield event;
  }
}
