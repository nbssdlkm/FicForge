// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * AuSettingsLayout 状态下沉回归（长期债②第一块）：
 * 31 useState → 4 hooks（data / form / modals / advancedOps）后锁住的行为——
 * 加载回显、保存 payload、切 AU 重灌，以及最关键的
 * 「移除 cast 角色（syncCastRegistry 局部更新 project）不得重灌表单、吞掉未保存编辑」。
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuSettingsLayout } from "../AuSettingsLayout";
import { FeedbackProvider } from "../../../hooks/useFeedback";

// 重型子组件与本测试无关，剪掉其 API 面
vi.mock("../model-picker/ProviderModelPicker", () => ({ ProviderModelPicker: () => null }));
vi.mock("../GlobalSettingsModal", () => ({ GlobalSettingsModal: () => null }));
vi.mock("../BackfillMemoryModal", () => ({ BackfillMemoryModal: () => null }));
vi.mock("../ArchiveCandidatesModal", () => ({ ArchiveCandidatesModal: () => null }));
vi.mock("../../shared/SecretStorageNotice", () => ({ SecretStorageNotice: () => null }));

vi.mock("../../../api/engine-client", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getProjectForEditing: vi.fn(),
    getSettingsForEditing: vi.fn(),
    getState: vi.fn(),
    saveAuSettingsForEditing: vi.fn(),
    saveProjectCastRegistryAndCoreIncludes: vi.fn(),
    findArchivalCandidates: vi.fn(),
    recalcState: vi.fn(),
    rebuildIndex: vi.fn(),
  };
});

import {
  getProjectForEditing,
  getSettingsForEditing,
  getState,
  saveAuSettingsForEditing,
  saveProjectCastRegistryAndCoreIncludes,
  findArchivalCandidates,
} from "../../../api/engine-client";

const projectFixture = () => ({
  name: "测试AU",
  chapter_length: 3000,
  writing_style: {
    perspective: "first_person",
    emotion_style: "explicit",
    custom_instructions: "多写环境",
  },
  pinned_context: ["禁止OOC"],
  core_always_include: ["主角甲"],
  cast_registry: { characters: ["主角甲", "配角乙"] },
  llm: { mode: "api", model: "", api_base: "", api_key: "", local_model_path: "", ollama_model: "" },
  embedding_lock: {},
});

const settingsFixture = { embedding: { model: "bge-m3" } };

async function renderLayout(auPath = "fandoms/f/aus/a") {
  const utils = render(
    <FeedbackProvider>
      <AuSettingsLayout auPath={auPath} />
    </FeedbackProvider>,
  );
  // hydrate 完成（自定义指令回显）
  await screen.findByDisplayValue("多写环境");
  return utils;
}

describe("AuSettingsLayout — 状态下沉回归", () => {
  beforeEach(() => {
    (getProjectForEditing as Mock).mockReset().mockResolvedValue(projectFixture());
    (getSettingsForEditing as Mock).mockReset().mockResolvedValue(settingsFixture);
    (getState as Mock).mockReset().mockResolvedValue({ index_status: "ok" });
    (saveAuSettingsForEditing as Mock).mockReset().mockResolvedValue(undefined);
    (saveProjectCastRegistryAndCoreIncludes as Mock).mockReset().mockResolvedValue(undefined);
    (findArchivalCandidates as Mock).mockReset().mockResolvedValue([]);
  });

  it("加载后表单回显 project 值", async () => {
    await renderLayout();

    expect(screen.getByDisplayValue("3000")).toBeTruthy(); // 每章目标字数
    expect(screen.getByDisplayValue("禁止OOC")).toBeTruthy(); // 铁律
    expect(screen.getAllByText("主角甲")).toHaveLength(2); // 必带角色 tag + cast 列表
    expect(screen.getByDisplayValue("bge-m3")).toBeTruthy(); // 全局 embedding 回显（非覆盖态）
  });

  it("编辑后保存 → payload 来自最新表单", async () => {
    await renderLayout();

    fireEvent.change(screen.getByDisplayValue("多写环境"), { target: { value: "台词短一点" } });
    fireEvent.click(screen.getAllByRole("button", { name: /保存/ })[0]);

    await waitFor(() => expect(saveAuSettingsForEditing).toHaveBeenCalledTimes(1));
    const [calledPath, payload] = (saveAuSettingsForEditing as Mock).mock.calls[0];
    expect(calledPath).toBe("fandoms/f/aus/a");
    expect(payload.writing_style.custom_instructions).toBe("台词短一点");
    expect(payload.writing_style.perspective).toBe("first_person"); // 未动字段原样保留
    expect(payload.chapter_length).toBe(3000);
    expect(payload.core_always_include).toEqual(["主角甲"]);
  });

  it("移除 cast 角色：同步 project 与必带角色，但不重灌表单（未保存编辑不丢）", async () => {
    await renderLayout();

    // 先制造一处未保存的表单编辑
    fireEvent.change(screen.getByDisplayValue("多写环境"), { target: { value: "未保存的编辑" } });

    // 移除「主角甲」（同时在 cast registry 与必带角色里）
    const removeButtons = screen.getAllByTitle("从出场角色列表中移除");
    fireEvent.click(removeButtons[0]);

    await waitFor(() => expect(saveProjectCastRegistryAndCoreIncludes).toHaveBeenCalledTimes(1));
    const [, castPayload] = (saveProjectCastRegistryAndCoreIncludes as Mock).mock.calls[0];
    expect(castPayload.characters).toEqual(["配角乙"]);
    expect(castPayload.core_always_include).toEqual([]);

    // cast 列表与必带角色区已同步
    await waitFor(() => expect(screen.queryByText("主角甲")).toBeNull());
    expect(screen.getByText("还没有设置必带角色。")).toBeTruthy();

    // 关键：project 局部更新不得触发表单重灌
    expect(screen.getByDisplayValue("未保存的编辑")).toBeTruthy();
  });

  it("切 AU：重新拉取并重灌表单", async () => {
    const { rerender } = await renderLayout();

    (getProjectForEditing as Mock).mockResolvedValue({
      ...projectFixture(),
      name: "另一篇",
      writing_style: { perspective: "third_person", emotion_style: "implicit", custom_instructions: "另一篇的指令" },
      chapter_length: 1500,
    });

    rerender(
      <FeedbackProvider>
        <AuSettingsLayout auPath="fandoms/f/aus/b" />
      </FeedbackProvider>,
    );

    await screen.findByDisplayValue("另一篇的指令");
    expect(screen.getByDisplayValue("1500")).toBeTruthy();
    expect(getProjectForEditing).toHaveBeenLastCalledWith("fandoms/f/aus/b");
  });
});
