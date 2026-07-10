// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 薄 re-export —— 「聊天历史 → OpenAI messages」转换已下沉引擎
 * `services/chat_to_llm.ts`（盲审长期债④：序列化规则含影响 prompt 的业务判断，
 * 归生成流水线 / 引擎层）。保留本文件让 UI 端 import 路径不变；
 * 输出逐字节不变由同目录 `__tests__/chat-to-llm.golden.test.ts` 基线守护。
 */

export { chatToOpenAIMessages } from "@ficforge/engine";
export type { OpenAIChatMessage } from "@ficforge/engine";
