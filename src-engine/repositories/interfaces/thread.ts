// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import type { Thread } from "../../domain/thread.js";

/** 剧情线读写接口（M8-B）。threads.jsonl 直写存储（非 ops-backed，见 spec D3）。 */
export interface ThreadRepository {
  list(auPath: string): Promise<Thread[]>;
  get(auPath: string, id: string): Promise<Thread | null>;
  add(auPath: string, thread: Thread): Promise<void>;
  /** 按 id 整条替换；不存在则静默忽略（调用方负责存在性）。 */
  update(auPath: string, thread: Thread): Promise<void>;
  remove(auPath: string, id: string): Promise<void>;
}
