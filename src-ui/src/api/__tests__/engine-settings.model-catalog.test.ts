// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 模型目录命令层测试（供应商主导选择器）：
 * 自定义供应商 CRUD（含 secure key 生命周期）+ enabled_models 覆写 + catalog 查询视图。
 * 走真实 FileSettingsRepository + MockAdapter —— round-trip 闭环证明，不是 mock 单元覆盖。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { initEngine } from "../engine-instance";
import {
  deleteCustomProvider,
  enableModel,
  getCustomProviderApiKey,
  getModelCatalog,
  getWriterSessionConfig,
  replaceEnabledModelsInUniverse,
  saveCustomProvider,
  saveEnabledModels,
} from "../engine-settings";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";

describe("engine-settings model catalog commands", () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
    initEngine(adapter, "");
  });

  it("saveCustomProvider 新建：生成唯一 id、key 进 secure storage、catalog 只暴露 has_api_key", async () => {
    // 顶层 displayName/baseUrl = CustomProviderSaveInput（UI DTO，camelCase）；
    // models[] 内的条目 = CustomModelEntry（持久化域，已 snake 化）。
    const saved = await saveCustomProvider({
      displayName: "我的中转站",
      baseUrl: "https://relay.example.com/v1",
      api_key: "sk-relay-secret",
      models: [{ id: "relay/chat", display_name: "Relay Chat", context_window: 200_000, type: "chat" }],
    });

    expect(saved.id).toMatch(/^custom-/);
    expect(saved.has_api_key).toBe(true);
    expect((saved as Record<string, unknown>).api_key).toBeUndefined(); // 查询视图不携带明文

    // 落盘 round-trip：YAML 无明文、secure storage 有真值
    const yamlText = await adapter.readFile("settings.yaml");
    expect(yamlText).not.toContain("sk-relay-secret");
    expect(await adapter.secureGet(`settings.custom_providers.${saved.id}.api_key`)).toBe("sk-relay-secret");

    const catalog = await getModelCatalog();
    expect(catalog.custom_providers).toHaveLength(1);
    expect(catalog.custom_providers[0]).toMatchObject({
      id: saved.id,
      displayName: "我的中转站",
      has_api_key: true,
    });
    expect(catalog.custom_providers[0].models[0].context_window).toBe(200_000);

    // 真实 key 走专用读取口（选中供应商时自动带出）
    expect(await getCustomProviderApiKey(saved.id)).toBe("sk-relay-secret");
  });

  it("saveCustomProvider 编辑：api_key undefined = 保持已存密钥不变", async () => {
    const saved = await saveCustomProvider({
      displayName: "A",
      baseUrl: "https://a.example.com",
      api_key: "sk-original",
      models: [],
    });

    const updated = await saveCustomProvider({
      id: saved.id,
      displayName: "A 改名",
      baseUrl: "https://a2.example.com",
      models: [],
    });

    expect(updated.displayName).toBe("A 改名");
    expect(updated.baseUrl).toBe("https://a2.example.com");
    expect(await getCustomProviderApiKey(saved.id)).toBe("sk-original");
  });

  it("saveEnabledModels 按供应商覆写；getWriterSessionConfig 附带 catalog（会话下拉数据链）", async () => {
    await saveEnabledModels("deepseek", [{ id: "deepseek-pulled", display_name: "deepseek-pulled", type: "chat" }]);
    await saveEnabledModels("deepseek", [
      { id: "deepseek-v4-flash", display_name: "deepseek-v4-flash", context_window: 1_000_000, type: "chat" },
    ]);

    const catalog = await getModelCatalog();
    // 覆写语义：第二次调用完全取代第一次
    expect(catalog.enabled_models.deepseek.map((m) => m.id)).toEqual(["deepseek-v4-flash"]);

    const sessionConfig = await getWriterSessionConfig();
    expect(sessionConfig.catalog.enabled_models.deepseek[0].context_window).toBe(1_000_000);
  });

  it("enableModel 原子启用：并发双调用双双保留、按 id 幂等（对抗审 C1 终审）", async () => {
    // 并发触发——读-合并-写在同一把写锁内串行，两个 id 都必须存活（旧 UI 层
    // fresh-read + 整表覆写在此场景必丢一个）。
    const [addedA, addedB] = await Promise.all([
      enableModel("deepseek", { id: "deepseek-a", display_name: "deepseek-a", type: "chat" }),
      enableModel("deepseek", { id: "deepseek-b", display_name: "deepseek-b", type: "chat" }),
    ]);
    expect(addedA).toBe(true);
    expect(addedB).toBe(true);
    const catalog = await getModelCatalog();
    expect(catalog.enabled_models.deepseek.map((m) => m.id).sort()).toEqual(["deepseek-a", "deepseek-b"]);

    // 幂等：同 id 再启用不新增、返回 false
    expect(await enableModel("deepseek", { id: "deepseek-a", display_name: "deepseek-a", type: "chat" })).toBe(false);
    const after = await getModelCatalog();
    expect(after.enabled_models.deepseek.filter((m) => m.id === "deepseek-a")).toHaveLength(1);

    // 落盘 round-trip
    const yamlText = await adapter.readFile("settings.yaml");
    expect(yamlText).toContain("deepseek-a");
    expect(yamlText).toContain("deepseek-b");
  });

  it("deleteCustomProvider：条目 + 关联 enabled_models + secure 密钥一并清除", async () => {
    const saved = await saveCustomProvider({
      displayName: "待删",
      baseUrl: "https://del.example.com",
      api_key: "sk-doomed",
      models: [],
    });
    await saveEnabledModels(saved.id, [{ id: "x", display_name: "x", type: "chat" }]);
    await saveEnabledModels("deepseek", [{ id: "keep", display_name: "keep", type: "chat" }]);

    await deleteCustomProvider(saved.id);

    const catalog = await getModelCatalog();
    expect(catalog.custom_providers).toHaveLength(0);
    expect(saved.id in catalog.enabled_models).toBe(false);
    expect(catalog.enabled_models.deepseek).toHaveLength(1); // 无关供应商不受影响
    expect(await adapter.secureGet(`settings.custom_providers.${saved.id}.api_key`)).toBeNull();
  });

  it("终审 v5 P1：replaceEnabledModelsInUniverse 锁内合并——宇宙内以勾选为准、宇宙外保留", async () => {
    await saveEnabledModels("deepseek", [
      { id: "deepseek-chat", display_name: "deepseek-chat", type: "chat" }, // 宇宙外（未在本 sheet 展示）
      { id: "old-in-universe", display_name: "old-in-universe", type: "chat" }, // 宇宙内、未勾选 → 应被清
    ]);
    const merged = await replaceEnabledModelsInUniverse(
      "deepseek",
      [{ id: "deepseek-v9-new", display_name: "deepseek-v9-new", type: "chat" }],
      new Set(["deepseek-v9-new", "old-in-universe"]),
    );
    expect(merged.map((m) => m.id).sort()).toEqual(["deepseek-chat", "deepseek-v9-new"]);
    const after = await getModelCatalog();
    expect(after.enabled_models.deepseek.map((m) => m.id).sort()).toEqual(["deepseek-chat", "deepseek-v9-new"]);
  });

  it("终审 v5 P1：sheet 确认与并发 enableModel 互不丢条目（读-合-写同锁）", async () => {
    await Promise.all([
      replaceEnabledModelsInUniverse(
        "deepseek",
        [{ id: "model-sheet", display_name: "model-sheet", type: "chat" }],
        new Set(["model-sheet"]),
      ),
      enableModel("deepseek", { id: "model-auto", display_name: "model-auto", type: "chat" }),
    ]);
    const catalog = await getModelCatalog();
    expect(catalog.enabled_models.deepseek.map((m) => m.id).sort()).toEqual(["model-auto", "model-sheet"]);
  });
});
