// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * 「接受提取候选 → 批量落库」共享流程（盲审 2026-07-11 重复维：useFactsExtraction 与
 * useWriterFactsExtraction 此前各写一份，半成功登记 / 批量单锁 CAS / writtenIndices
 * 精确去重这些易错逻辑要手工双向同步）。两 hook 仅「章号归属」判据不同，经 chapterOf 注入。
 */

import {
  addFactsBatch,
  buildFactDataFromCandidate,
  PartialAddFactsError,
  type BatchFactInput,
  type ExtractedFactCandidate,
} from "../../api/engine-client";

export interface SaveAcceptedResult {
  added: number;
  skipped: number;
}

/**
 * 把「本轮尚未入库」的候选批量落库（单锁 + 逐章存在性 CAS，防并发 undo 插批次产生孤儿）。
 * - registerSaved 用引擎返回的 writtenIndices **精确**登记（混章 skip/add 交错时前缀 slice 会错位）；
 * - 半成功（PartialAddFactsError）同样先登记已落盘部分再向上抛，重试只补余下。
 */
export async function saveAcceptedCandidates(params: {
  auPath: string;
  pending: ExtractedFactCandidate[];
  chapterOf: (c: ExtractedFactCandidate) => number;
  registerSaved: (c: ExtractedFactCandidate) => void;
}): Promise<SaveAcceptedResult> {
  const inputs: BatchFactInput[] = params.pending.map((candidate) => ({
    chapterNum: params.chapterOf(candidate),
    data: buildFactDataFromCandidate(candidate),
  }));

  try {
    const r = await addFactsBatch(params.auPath, inputs);
    r.writtenIndices.forEach((i) => params.registerSaved(params.pending[i]));
    return { added: r.added, skipped: r.skipped };
  } catch (err) {
    if (err instanceof PartialAddFactsError) {
      err.writtenIndices.forEach((i) => params.registerSaved(params.pending[i]));
    }
    throw err;
  }
}
