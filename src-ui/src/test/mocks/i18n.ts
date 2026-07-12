// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 共享 useAppTranslation mock 工厂（R4 测试 L1：收敛各测试文件自声明的副本）。
 *
 * 统一口径：
 *   - 无 params → 原样返回 key；
 *   - 有 params → `key:${JSON.stringify(params)}`（既有「插值口径」测试判据，迁移后逐字节等价）。
 * 附带 `i18n.resolvedLanguage`，供读语言的组件（如 MobileLayout）不崩。
 *
 * 用法（注意 vi.mock hoisting：factory 内 await import 本模块，避免引用外部变量）：
 *   vi.mock("../../../i18n/useAppTranslation", async () =>
 *     (await import("../../../test/mocks/i18n")).mockUseAppTranslation());
 *
 * 注：render 计数型 memo 测试需要 t 为 spy + defaultValue 口径，自持专用 mock，不用本工厂。
 */

/** t 的统一实现：有 params 拼 JSON，否则返回 key。 */
export function translate(key: string, params?: Record<string, unknown>): string {
  return params ? `${key}:${JSON.stringify(params)}` : key;
}

/** useAppTranslation mock 模块形状（vi.mock factory 直接返回）。 */
export function mockUseAppTranslation() {
  return {
    useTranslation: () => ({ t: translate, i18n: { resolvedLanguage: "zh" } }),
  };
}
