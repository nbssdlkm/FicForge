// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 穷尽性检查哨兵：联合类型的所有成员都被分支处理后，剩余类型收窄为 never，
 * 编译器据此强制「新增/改名联合成员必须同步更新全部分派点」。运行时兜底抛错
 * （类型被 as 绕过时不静默吞）。
 */
export function assertNever(value: never, label = "unexpected value"): never {
  throw new Error(`${label}: ${String(value)}`);
}
