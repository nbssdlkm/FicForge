// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FileSettingsRepository 测试。
 *
 * 本轮审计修复覆盖：
 * - P0-1：空 dataDir 构造不再抛错（Capacitor/Web 平台约定）
 * - P0-3：敏感字段不再明文落盘到 settings.yaml
 * - P1-4：不再有 default_llm.api_key → embedding.api_key 的隐式复用
 */

import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { FileSettingsRepository } from "../implementations/file_settings.js";
import { MockAdapter } from "./mock_adapter.js";

describe("FileSettingsRepository constructor", () => {
  it("P0-1: 允许空 dataDir（Capacitor/Web 平台约定）", () => {
    const adapter = new MockAdapter();
    expect(() => new FileSettingsRepository(adapter, "")).not.toThrow();
  });

  it("P0-1: 空 dataDir 时 settings.yaml 直接在根", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");
    // get() 在文件不存在时会创建 —— 触发一次写入，可以检查写到哪
    await repo.get();
    const files = adapter.allFiles();
    expect(files).toContain("settings.yaml");
    // 不应该写到 "/settings.yaml" 或其它奇怪位置
    expect(files.every((f) => !f.startsWith("/"))).toBe(true);
  });

  it("P0-1: 非空 dataDir 正常拼接", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "/tmp/app");
    await repo.get();
    expect(adapter.allFiles()).toContain("/tmp/app/settings.yaml");
  });
});

describe("FileSettingsRepository secure fields (P0-3)", () => {
  it("save 后 YAML 里不含 api_key 明文", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");

    const settings = await repo.get();
    settings.default_llm.api_key = "sk-super-secret";
    settings.embedding.api_key = "emb-secret";
    await repo.save(settings);

    const yamlText = adapter.allFiles().includes("settings.yaml")
      ? await adapter.readFile("settings.yaml")
      : "";
    expect(yamlText).not.toContain("sk-super-secret");
    expect(yamlText).not.toContain("emb-secret");
    // 占位符应该出现
    expect(yamlText).toContain("<secure>");
  });

  it("get 还原的 settings 与 save 时一致（round-trip）", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");

    const s1 = await repo.get();
    s1.default_llm.api_key = "sk-a";
    s1.embedding.api_key = "emb-b";
    s1.default_llm.model = "gpt-4o";
    await repo.save(s1);

    const s2 = await repo.get();
    expect(s2.default_llm.api_key).toBe("sk-a");
    expect(s2.embedding.api_key).toBe("emb-b");
    expect(s2.default_llm.model).toBe("gpt-4o");
  });
});

describe("FileSettingsRepository embedding fallback removed (P1-4)", () => {
  it("embedding.api_key 为空时不再自动复用 default_llm.api_key", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");

    const s = await repo.get();
    s.default_llm.api_key = "llm-key-only";
    s.embedding.api_key = "";  // 用户没配 embedding
    await repo.save(s);

    const reloaded = await repo.get();
    // 以前这里会被 "fallback" 填成 "llm-key-only" —— 现在必须保持空
    expect(reloaded.embedding.api_key).toBe("");
    expect(reloaded.default_llm.api_key).toBe("llm-key-only");
  });

  it("旧明文 YAML（无占位符）可以被 restoreSecureFields 自动迁移", async () => {
    const adapter = new MockAdapter();
    // 模拟旧版本写下的明文 YAML
    const legacyYaml = yaml.dump({
      default_llm: { mode: "api", model: "gpt-4o", api_base: "", api_key: "legacy-plaintext" },
      embedding: { mode: "api", model: "", api_base: "", api_key: "" },
      sync: {},
    });
    await adapter.writeFile("settings.yaml", legacyYaml);

    const repo = new FileSettingsRepository(adapter, "");
    const s = await repo.get();

    // 明文字段在还原时应该保留在对象里
    expect(s.default_llm.api_key).toBe("legacy-plaintext");
    // 同时已经被搬进 secure storage
    expect(await adapter.secureGet("settings.default_llm.api_key")).toBe("legacy-plaintext");

    // 下次 save 后 YAML 里就不含明文了
    await repo.save(s);
    const updatedYaml = await adapter.readFile("settings.yaml");
    expect(updatedYaml).not.toContain("legacy-plaintext");
    expect(updatedYaml).toContain("<secure>");
  });
});

describe("FileSettingsRepository fonts — dictToFontsConfig + 迁移", () => {
  it("空 yaml 首次 get → app.fonts 为 createFontsConfig() 默认值", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");
    const s = await repo.get();
    expect(s.app.fonts).toEqual({
      ui_latin_font_id: "system",
      ui_cjk_font_id: "system",
      reading_latin_font_id: "source-serif-4",
      reading_cjk_font_id: "lxgw-wenkai-screen",
    });
  });

  it("fonts 字段能正确 round-trip（以前 dictToAppConfig 漏掉整个 fonts → 总是默认值）", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");

    const s = await repo.get();
    s.app.fonts.ui_latin_font_id = "source-serif-4";
    s.app.fonts.ui_cjk_font_id = "lxgw-wenkai-screen";
    s.app.fonts.reading_latin_font_id = "source-serif-4";
    s.app.fonts.reading_cjk_font_id = "lxgw-wenkai-screen";
    await repo.save(s);

    const reloaded = await repo.get();
    expect(reloaded.app.fonts.ui_latin_font_id).toBe("source-serif-4");
    expect(reloaded.app.fonts.ui_cjk_font_id).toBe("lxgw-wenkai-screen");
    expect(reloaded.app.fonts.reading_latin_font_id).toBe("source-serif-4");
    expect(reloaded.app.fonts.reading_cjk_font_id).toBe("lxgw-wenkai-screen");
  });

  it("Phase 4 旧字段 ui_font_id / reading_font_id 自动按 script 迁移到 4 字段", async () => {
    const adapter = new MockAdapter();
    // 模拟 Phase 4 时代的 settings.yaml（只有 2 字段）
    const legacyYaml = yaml.dump({
      default_llm: { mode: "api", model: "", api_base: "", api_key: "" },
      embedding: { mode: "api", model: "", api_base: "", api_key: "" },
      app: {
        fonts: {
          ui_font_id: "source-serif-4",         // latin 字体 → 迁到 ui_latin 槽
          reading_font_id: "lxgw-wenkai-screen", // cjk 字体 → 迁到 reading_cjk 槽
        },
      },
      sync: {},
    });
    await adapter.writeFile("settings.yaml", legacyYaml);

    const repo = new FileSettingsRepository(adapter, "");
    const s = await repo.get();

    expect(s.app.fonts.ui_latin_font_id).toBe("source-serif-4");
    // 未被迁移的槽保持默认
    expect(s.app.fonts.ui_cjk_font_id).toBe("system");
    expect(s.app.fonts.reading_cjk_font_id).toBe("lxgw-wenkai-screen");
    expect(s.app.fonts.reading_latin_font_id).toBe("source-serif-4"); // 来自 createFontsConfig 默认
  });

  it("迁移后下次 save → yaml 里旧字段被自动剥离", async () => {
    const adapter = new MockAdapter();
    const legacyYaml = yaml.dump({
      default_llm: { mode: "api", model: "", api_base: "", api_key: "" },
      embedding: { mode: "api", model: "", api_base: "", api_key: "" },
      app: { fonts: { ui_font_id: "source-serif-4", reading_font_id: "lxgw-wenkai-screen" } },
      sync: {},
    });
    await adapter.writeFile("settings.yaml", legacyYaml);
    const repo = new FileSettingsRepository(adapter, "");

    const s = await repo.get();
    await repo.save(s);

    const updatedYaml = await adapter.readFile("settings.yaml");
    expect(updatedYaml).not.toContain("ui_font_id:");
    expect(updatedYaml).not.toContain("reading_font_id:");
    // 新 4 字段应该写入
    expect(updatedYaml).toContain("ui_latin_font_id:");
    expect(updatedYaml).toContain("reading_cjk_font_id:");
  });

  it("同时存在新字段 + 旧字段 → 新字段优先", async () => {
    const adapter = new MockAdapter();
    const legacyYaml = yaml.dump({
      default_llm: { mode: "api", model: "", api_base: "", api_key: "" },
      embedding: { mode: "api", model: "", api_base: "", api_key: "" },
      app: {
        fonts: {
          // 用户在 Phase 4 时期选过的旧字段
          ui_font_id: "lxgw-wenkai-screen",
          // Phase 7 之后又选过，新字段覆盖
          ui_cjk_font_id: "source-serif-4",
        },
      },
      sync: {},
    });
    await adapter.writeFile("settings.yaml", legacyYaml);

    const repo = new FileSettingsRepository(adapter, "");
    const s = await repo.get();

    // 旧 ui_font_id=lxgw 按 script 应迁到 ui_cjk，但新字段 ui_cjk=source-serif-4 覆盖它
    expect(s.app.fonts.ui_cjk_font_id).toBe("source-serif-4");
  });
});
