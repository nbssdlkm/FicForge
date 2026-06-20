// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 剧情线（Thread）领域对象（M8-B，D-0041 §7）。
 *
 * 三层记忆的第三层：跨章的命名剧情线 / 弧。Fact 太碎、ChapterSummary 按章切，
 * 都答不出「这条贯穿多章的长线现在到哪了」。Thread 把相关 Fact 归到一条命名线下，
 * 带一句「当前进展」（state），在续写时注入，让模型守住长线连贯。
 *
 * 成员关系（哪些 Fact 属于本线）的单一真相源 = `fact.thread_ids`（D1），
 * Thread 本身不存 fact_ids，避免双向漂移。
 */

import { ThreadStatus } from "./enums.js";

export interface Thread {
  id: string;            // t_{时间戳}_{4位随机}
  title: string;         // 剧情线名（"沈砚为父翻案"）
  description: string;   // 这条线是什么（可空）
  state: string;         // 当前进展一句话（注入用；"已确认名录被篡改，准备面圣"）
  status: ThreadStatus;  // active / resolved / dormant
  created_at: string;    // ISO 8601
  updated_at: string;    // ISO 8601
}

export function createThread(
  partial: Pick<Thread, "id" | "title"> & Partial<Thread>,
): Thread {
  return {
    description: "",
    state: "",
    status: ThreadStatus.ACTIVE,
    created_at: "",
    updated_at: "",
    ...partial,
  };
}
