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

  /**
   * 锁内 read-modify-write：以磁盘当前内容为基底应用 updater 后写回。
   * 供「不依赖 UI 组件存活」的状态回写使用（如接受草稿后钉 accepted 标记）——
   * UI 侧防抖 save 走内存快照，组件卸载后快照即失效；这里保证关键终态仍能落盘，
   * 且不会覆盖 updater 之外的并发变更（读写同锁）。
   */
  update(au_id: string, updater: (messages: SimpleChatMessageEnvelope[]) => SimpleChatMessageEnvelope[]): Promise<void>;

  /** 清空对话历史（删除文件 / 写空 messages）。 */
  clear(au_id: string): Promise<void>;
}
