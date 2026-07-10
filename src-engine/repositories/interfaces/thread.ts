// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import type { Thread } from "../../domain/thread.js";

/**
 * 剧情线读写接口（M8-B）。threads.jsonl 直写存储（非 ops-backed，见 spec D3）。
 * `au_id` 即 AU 目录路径（全仓储统一命名，2026-07-09；此前本接口用 auPath 同义分裂）。
 */
export interface ThreadRepository {
  list(au_id: string): Promise<Thread[]>;
  get(au_id: string, id: string): Promise<Thread | null>;
  add(au_id: string, thread: Thread): Promise<void>;
  /** 按 id 整条替换；不存在则静默忽略（调用方负责存在性）。 */
  update(au_id: string, thread: Thread): Promise<void>;
  remove(au_id: string, id: string): Promise<void>;
}
