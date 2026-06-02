// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** SimpleChatRepository 抽象接口（FicForge Lite C2 chat 持久化）。 */

import type { SimpleChatFile, SimpleChatMessageEnvelope } from "../../domain/simple_chat.js";

export interface SimpleChatRepository {
  /**
   * 读取 AU 的 simple-chat.yaml；不存在返回空白 SimpleChatFile（au_path 字段已填）。
   * 损坏 / 不可读时也返回空白文件，错误吞掉（chat 历史是体验性数据，不应阻塞 panel 加载）。
   */
  get(au_id: string): Promise<SimpleChatFile>;

  /**
   * 全量替换写入（messages 数组）。updated_at 自动刷新；created_at 仅在新建时设置。
   * 用 withWriteLock 串行化同 AU 的并发 save，防止两次 append 紧挨着 setTimeout
   * fire 时把第一份 partial state 覆盖。
   */
  save(au_id: string, messages: SimpleChatMessageEnvelope[]): Promise<void>;

  /** 清空对话历史（删除文件 / 写空 messages）。 */
  clear(au_id: string): Promise<void>;
}
