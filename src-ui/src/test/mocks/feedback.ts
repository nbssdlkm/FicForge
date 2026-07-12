// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 共享 useFeedback mock 工厂（R4 测试 L1：收敛各测试文件自声明的副本）。
 *
 * showToast / showSuccess / showError 均为 vi.fn，且经 `feedbackMock` 暴露同一组句柄供断言。
 * vitest 每个测试文件独立模块图 → 句柄文件内单例、不跨文件泄漏；文件内多测试共享同一组，
 * beforeEach 里 vi.clearAllMocks() 复位（与既有「模块级 const showX = vi.fn()」语义一致）。
 *
 * 用法：
 *   vi.mock("../../hooks/useFeedback", async () =>
 *     (await import("../../test/mocks/feedback")).mockUseFeedback());
 *   import { feedbackMock } from "../../test/mocks/feedback";
 *   ...
 *   expect(feedbackMock.showError).toHaveBeenCalled();
 *   // 需保留原局部名时：const { showError } = feedbackMock;
 */
import { vi } from "vitest";

/** 与 mockUseFeedback 内部同一组 vi.fn 句柄（断言用）。 */
export const feedbackMock = {
  showToast: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
};

/** useFeedback mock 模块形状（vi.mock factory 直接返回）。 */
export function mockUseFeedback() {
  return { useFeedback: () => feedbackMock };
}
