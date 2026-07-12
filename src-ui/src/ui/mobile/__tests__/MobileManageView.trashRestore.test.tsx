// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * MobileManageView — 回收站恢复章节的宿主刷新接线（R1-5）。
 *
 * 判别契约：
 *  1. 恢复「章文件」条目 → onChaptersChanged 被调（宿主刷新章节列表 + keep-mounted 面板）
 *  2. 恢复 lore 条目 → 不调（不给宿主无谓的全量刷新）
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../hooks/useFeedback", () => ({
  useFeedback: () => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showToast: vi.fn(),
  }),
}));

// project section 会挂 AuSettingsLayout（打引擎 API），本测试只关心 TrashPanel 接线 → 桩掉重子组件
vi.mock("../../settings/AuSettingsLayout", () => ({ AuSettingsLayout: () => <div data-testid="au-settings-stub" /> }));
vi.mock("../../facts/FactsLayout", () => ({ FactsLayout: () => <div /> }));
vi.mock("../../threads/ThreadsLayout", () => ({ ThreadsLayout: () => <div /> }));

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>("../../../api/engine-client");
  return {
    ...actual,
    listTrash: vi.fn(),
    restoreTrash: vi.fn(),
    permanentDeleteTrash: vi.fn(),
    purgeTrash: vi.fn(),
  };
});

import * as engineClient from "../../../api/engine-client";
import { MobileManageView } from "../MobileManageView";
import type { TrashEntry } from "../../../api/engine-client";

const mocked = vi.mocked(engineClient);
const AU = "/fandoms/test/aus/test_au";

function trashEntry(overrides: Partial<TrashEntry>): TrashEntry {
  return {
    trash_id: "tr_1_abcd",
    original_path: "chapters/main/ch0003.md",
    trash_path: "chapters/main/ch0003_1_abcd.md",
    entity_type: "chapter",
    entity_name: "3",
    deleted_at: "2026-07-01T00:00:00Z",
    expires_at: "2099-07-31T00:00:00Z",
    metadata: {},
    ...overrides,
  };
}

async function renderAndRestore(entry: TrashEntry, onChaptersChanged: () => void) {
  mocked.listTrash.mockResolvedValue([entry]);
  mocked.restoreTrash.mockResolvedValue(undefined as never);
  const user = userEvent.setup();

  render(<MobileManageView auPath={AU} defaultSection="project" onChaptersChanged={onChaptersChanged} />);
  await waitFor(() => expect(mocked.listTrash).toHaveBeenCalled());

  // 展开回收站面板 → 点「恢复」
  await user.click(screen.getByRole("button", { name: /垃圾箱/ }));
  const restoreBtn = await screen.findByRole("button", { name: "恢复" });
  await user.click(restoreBtn);
  await waitFor(() => expect(mocked.restoreTrash).toHaveBeenCalled());
}

describe("MobileManageView 回收站恢复章节接线（R1-5）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("恢复章文件条目 → onChaptersChanged 被调", async () => {
    const onChaptersChanged = vi.fn();
    await renderAndRestore(trashEntry({}), onChaptersChanged);

    await waitFor(() => expect(onChaptersChanged).toHaveBeenCalledTimes(1));
  });

  it("恢复 lore 条目 → onChaptersChanged 不被调", async () => {
    const onChaptersChanged = vi.fn();
    await renderAndRestore(
      trashEntry({
        original_path: "characters/Alice.md",
        trash_path: "characters/Alice_1_abcd.md",
        entity_type: "lore_file",
        entity_name: "Alice",
      }),
      onChaptersChanged,
    );

    // restore 已成功但不是章文件 → 不触发宿主刷新
    expect(onChaptersChanged).not.toHaveBeenCalled();
  });
});
