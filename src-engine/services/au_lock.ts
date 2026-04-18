// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * AU 级互斥锁 —— 全系统对同一 au_id 的写操作串行化。
 *
 * ============================================================================
 * 为什么需要 AU 锁
 * ============================================================================
 * 一个 AU 下的 ops.jsonl / chapter.md / facts.jsonl / drafts/*.md / state.yaml
 * 之间存在紧耦合的一致性契约（D-0036 写入顺序 + lamport clock 对 ops 的强序要求）。
 * 如果两个 service 并发写同一 AU：
 *   - ops.jsonl 追加可能交错 → lamport 乱序 → 同步合并失败
 *   - state.yaml 被后者覆盖 → 前者的 chapters_dirty / characters_last_seen 丢失
 *   - confirm_chapter 刚写完 chapter 文件，undo_latest_chapter 同时读就读到半成品
 * 所以：对同一 au_id 的所有写操作必须串行。
 *
 * ============================================================================
 * 锁应该加在哪一层？—— 分层策略（重要）
 * ============================================================================
 * 原则：**锁加在"入口"而非"底层函数"**，避免重入死锁，同时覆盖所有调用路径。
 *
 * 三类"入口"：
 *
 * 1) 引擎内部的 orchestrator service（自带事务 + 级联逻辑）
 *    在其对外入口函数的第一行包 withAuLock：
 *      - confirm_chapter / undo_latest_chapter / resolve_dirty_chapter
 *      - executeImport / import_chapters
 *    它们内部调用 facts_lifecycle / chapter_edit 等底层函数时，底层不应再加锁。
 *
 * 2) 长流程中的"写段"（不能全程持锁）
 *    例：generation 是 30 秒级的流式生成，只在最后 draft_repo.save 那一小段持锁。
 *    流式 token 产出期间不持锁，UI 上对同 AU 的 confirm/undo 等操作可以响应。
 *
 * 3) UI API 层直接调用底层 service 的路径
 *    engine-facts.ts / engine-state.ts / engine-chapters.ts 里直接调用
 *    add_fact / edit_fact / update_fact_status / set_chapter_focus /
 *    edit_chapter_content 等底层函数的地方，必须顶层包 withAuLock。
 *    批量操作（例：batchUpdateFactStatus）整个循环包在一次锁内，避免中途释放
 *    被其它操作插入。
 *
 * ============================================================================
 * 为什么底层函数不加锁
 * ============================================================================
 * facts_lifecycle 的 edit_fact / update_fact_status 会被 dirty_resolve 的
 * applyFactChanges 调用。dirty_resolve 入口已经持有 AU 锁，如果底层也加同一把锁，
 * Promise queue 的后来者（dirty_resolve 里调的 edit_fact）会等前面（dirty_resolve
 * 自己）完成 —— 而 dirty_resolve 又在等 edit_fact 完成 —— 死锁。
 *
 * chapter_edit 同理。
 *
 * 所以 facts_lifecycle / chapter_edit 不加锁，假设调用者已持锁。这个假设由上面
 * 三类入口保证。
 *
 * ============================================================================
 * 加新 service / 新 UI API 时的检查清单
 * ============================================================================
 * - 新增 service 会写 ops / chapter / facts / drafts / state 任意一个？
 *   → 属于 orchestrator，入口包 withAuLock
 * - 新增 UI API 直接调用底层 service（非 orchestrator）？
 *   → UI API 层包 withAuLock
 * - 新增 service 会被其它已持锁的 service 调用？
 *   → 不要加锁（避免死锁），依赖调用者已持锁
 * - 长流程 service（生成、索引重建）？
 *   → 只对"写段"加锁，不全程持锁
 *
 * ============================================================================
 * 实现
 * ============================================================================
 * 底层复用 file_utils.withWriteLock 的 Promise 队列机制。
 * key 加 "au:" 前缀做命名空间，避免与文件级 withWriteLock(filepath, ...) 发生
 * key 碰撞。未来如需 chapter 级 / fandom 级锁可在此模块新增同构函数。
 */

import { withWriteLock } from "../repositories/implementations/file_utils.js";

export function withAuLock<T>(au_id: string, fn: () => Promise<T>): Promise<T> {
  return withWriteLock(`au:${au_id}`, fn);
}
