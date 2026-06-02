// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — SimpleChat 持久化数据结构。
 *
 * 每个 AU 一份 chat.yaml（位于 `{au_path}/.well-known/simple-chat.yaml`），
 * 在简版 fork 永久驻留对话历史。
 *
 * **设计选择：messages 数组不限定 message 类型**。引擎层只关心"有 id / 有 timestamp"
 * 的最小契约 + 整体 YAML 信封；UI 端用 discriminated union（详见
 * `src-ui/src/ui/simple/types.ts`）做严格类型，落盘时按原结构序列化。
 *
 * 这套折衷的代价：UI 改 message 形状时引擎不感知，依赖前端 round-trip test。
 * 收益：引擎不用为 6 类 message 各写 dict-to-domain 映射，简版 MVP 提速。
 * 等 C 阶段后续把消息形状稳定下来，可考虑下沉到 engine domain。
 */

export interface SimpleChatMessageEnvelope {
  /** 全局唯一消息 ID。 */
  id: string;
  /** ISO 8601 时间戳。 */
  timestamp: string;
  /** UI discriminated union 的 `kind` 字段（user / writing-draft / tool-call / chapter-preview / setting-preview / system 等）。 */
  kind: string;
  /** 任意附加字段（content / chapterNum / status / toolName / 等）。 */
  [key: string]: unknown;
}

export interface SimpleChatFile {
  /** Schema 版本号。当前 1。后续若改 message 形状，写时升版本号 + 兼容旧版本读。 */
  version: number;
  /** AU 路径，写时回填用作 round-trip 校验，读时不校验值（允许 fork / rename）。 */
  au_path: string;
  created_at: string;
  updated_at: string;
  messages: SimpleChatMessageEnvelope[];
}

export const SIMPLE_CHAT_VERSION = 1;

export function createSimpleChatFile(partial?: Partial<SimpleChatFile>): SimpleChatFile {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    version: SIMPLE_CHAT_VERSION,
    au_path: "",
    created_at: now,
    updated_at: now,
    messages: [],
    ...partial,
  };
}
