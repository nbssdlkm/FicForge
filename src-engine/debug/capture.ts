// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 生成调试包捕获（开发者模式观测面）。
 *
 * 设计契约（spec v3，2026-09-08）：
 * - 运行时开关：关 = capture 全 no-op；**置 false 时同步清空缓冲**，兑现「关 = 零保留」。
 * - 只驻内存不落盘：bundle 含完整 prompt（私密文稿），持久化交给 logger（telemetry 已落日志）。
 * - 不可变语义：bundle 必须在 capture 前组装完毕，capture 后不再被写；list/get 返回拷贝，
 *   调用方改不到内部状态。JS 事件循环内 push/shift 原子，不加锁。
 * - 环形缓冲上限 10 条（Neutral default；自用调试面不进 settings.yaml，调参需求真出现再外部化）。
 */

import type { DebugBundleMeta, GenerationDebugBundle } from "../domain/debug_bundle.js";
import { toDebugBundleMeta } from "../domain/debug_bundle.js";

const MAX_BUNDLES = 10;

/**
 * 状态挂 globalThis 而非模块作用域（2026-09-09 实测修复）：dev server 长跑 + HMR
 * 会把引擎模块图撕成多份实例（UI 侧 engine-client 解析到新版 capture.ts、
 * dispatch 侧 services barrel 仍持旧版）——模块级单例一分裂，开关写 A 实例、
 * 生成写 B 实例、面板读 A 实例，表现为「开关开着但面板永远 0 条」。
 * globalThis 随页面生命周期唯一，多少份模块实例都共享同一份状态。
 * 生产包单 bundle 单实例，行为不变。
 */
interface CaptureState {
  enabled: boolean;
  bundles: GenerationDebugBundle[];
  seq: number;
}

const STATE_KEY = "__ficforgeDebugCapture";

function stateOf(): CaptureState {
  const g = globalThis as unknown as Record<string, CaptureState | undefined>;
  if (!g[STATE_KEY]) g[STATE_KEY] = { enabled: false, bundles: [], seq: 0 };
  return g[STATE_KEY];
}

export function setDebugCaptureEnabled(on: boolean): void {
  const s = stateOf();
  s.enabled = on;
  if (!on) s.bundles = [];
}

export function isDebugCaptureEnabled(): boolean {
  return stateOf().enabled;
}

/**
 * 捕获一份 bundle。no-op 条件：开关关。id 在此处分配（会话内单调），
 * 骨架创建方把 ts 留在创建时刻。
 */
export function captureDebugBundle(bundle: GenerationDebugBundle): void {
  const s = stateOf();
  if (!s.enabled) return;
  bundle.id = `${bundle.ts}#${++s.seq}`;
  s.bundles.push(bundle);
  if (s.bundles.length > MAX_BUNDLES) s.bundles.shift();
}

/** 列表元数据，最新在前；返回拷贝。 */
export function listDebugBundles(): DebugBundleMeta[] {
  return stateOf().bundles.map(toDebugBundleMeta).reverse();
}

/** 取单份完整 bundle；返回深拷贝（找不到返 null）。 */
export function getDebugBundle(id: string): GenerationDebugBundle | null {
  const b = stateOf().bundles.find((x) => x.id === id);
  return b ? structuredClone(b) : null;
}

export function clearDebugBundles(): void {
  stateOf().bundles = [];
}
