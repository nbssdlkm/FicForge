// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * 全局错误兜底（2026-09-08，补「没人接管的报错」盲区）：
 *  - window.onerror：未捕获的同步异常
 *  - unhandledrejection：没有 .catch 的 Promise 拒绝
 *
 * 三条刻意设计（对抗审 2026-09-08 采纳）：
 *  1. **零静态依赖 + 模块顶层自安装**：本模块必须作为 main.tsx 的第一个 import——
 *     ESM 按 import 序求值，之后 App/engine 等模块顶层抛错也能被接住。若本模块
 *     静态 import 引擎 barrel，引擎顶层抛错反而抢在监听安装前发生（盲区照旧）。
 *  2. **logCatch 走动态 import + try/catch**：事件回调自身永不抛错（错误处理器
 *     再抛会丢原始 rejection 并触发二次错误处理）。引擎未加载/加载失败时降级
 *     console.warn 保诊断不丢（与 warnAlways 降级口径一致）。
 *  3. **安装标记挂 window 而非模块实例**：HMR 重评估 / 同页双 bundle 场景下
 *     模块级 flag 会失效重复注册；window 级标记随页面生命周期唯一。
 */

const INSTALLED_FLAG = "__ficforgeGlobalErrorsInstalled";

function report(msg: string, err: unknown): void {
  // 错误处理器自身绝不抛错。
  try {
    // Error 带 stack（含 message；日志侧 redactString 会擦敏感形态）——只留 message 排障不够。
    const errMsg = err instanceof Error ? (err.stack ?? err.message) : err != null ? String(err) : undefined;
    import("@ficforge/engine")
      .then((m) => m.logCatch("global", msg, errMsg))
      .catch(() => {
        // biome-ignore lint/suspicious/noConsole: sanctioned 降级出口——引擎不可用时保诊断不丢
        console.warn(`[global] ${msg}`, errMsg);
      });
  } catch {
    try {
      // biome-ignore lint/suspicious/noConsole: 同上（同步路径兜底）
      console.warn(`[global] ${msg}`);
    } catch {
      /* 连 console 都不可用时放弃 */
    }
  }
}

export function installGlobalErrorHandlers(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, unknown>;
  if (w[INSTALLED_FLAG]) return;
  w[INSTALLED_FLAG] = true;

  window.addEventListener("error", (event) => {
    // event.error 可能为 null（跨域脚本只给 message）；message 是字符串兜底
    report("未捕获异常", event.error ?? event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    report("未处理的 Promise rejection", event.reason);
  });
}

// 自安装：import 本模块即生效（main.tsx 第一行 import 它，见文件头注释）。
installGlobalErrorHandlers();
