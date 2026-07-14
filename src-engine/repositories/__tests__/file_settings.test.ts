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
import * as yaml from "js-yaml";
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

    const yamlText = adapter.allFiles().includes("settings.yaml") ? await adapter.readFile("settings.yaml") : "";
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

  it("default_llm.chat_path round-trip：设了自定义路径读回一致（新字段不被映射沉默丢弃）", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");

    const s1 = await repo.get();
    s1.default_llm.chat_path = "/openai/v1/chat";
    await repo.save(s1);

    // 真落盘（新字段确实写进 YAML，不是只在内存里）
    const yamlText = await adapter.readFile("settings.yaml");
    expect(yamlText).toContain("chat_path");

    const s2 = await repo.get();
    expect(s2.default_llm.chat_path).toBe("/openai/v1/chat");
  });

  it("default_llm 未设 chat_path：round-trip 后仍缺省（不静默补默认路径）", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");

    const s1 = await repo.get();
    await repo.save(s1);

    const s2 = await repo.get();
    expect(s2.default_llm.chat_path).toBeUndefined();
  });
});

describe("FileSettingsRepository tolerant read of retired keys", () => {
  it("旧 settings.yaml 含已清退的 license 块：读取容忍忽略、不炸、其余字段正常（盲审 R5 功能 L2）", async () => {
    const adapter = new MockAdapter();
    adapter.seed(
      "settings.yaml",
      [
        "updated_at: '2026-01-01T00:00:00Z'",
        "default_llm:",
        "  mode: api",
        "  model: gpt-4o",
        "license:",
        "  tier: pro",
        "  feature_flags: [beta]",
        "  api_mode: managed",
        "app:",
        "  language: en",
      ].join("\n"),
    );
    const repo = new FileSettingsRepository(adapter, "");

    // 不抛错，且 license 块被静默忽略（清退后无该属性）。
    const s = await repo.get();
    expect((s as unknown as { license?: unknown }).license).toBeUndefined();
    // 其余字段照常读入。
    expect(s.default_llm.model).toBe("gpt-4o");
    expect(s.app.language).toBe("en");
  });
});

describe("FileSettingsRepository embedding fallback removed (P1-4)", () => {
  it("embedding.api_key 为空时不再自动复用 default_llm.api_key", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");

    const s = await repo.get();
    s.default_llm.api_key = "llm-key-only";
    s.embedding.api_key = ""; // 用户没配 embedding
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

describe("FileSettingsRepository react_extraction_enabled (M9 default-on, PD-4)", () => {
  it("空 yaml / 缺字段（老 settings）首次 get → 默认开（true）", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");
    const s = await repo.get();
    expect(s.app.react_extraction_enabled).toBe(true);
  });

  it("缺字段的老 yaml 也读成 true（默认开兜底）", async () => {
    const adapter = new MockAdapter();
    const legacyYaml = yaml.dump({
      default_llm: { mode: "api", model: "", api_base: "", api_key: "" },
      embedding: { mode: "api", model: "", api_base: "", api_key: "" },
      app: { language: "zh" }, // 无 react_extraction_enabled
      sync: {},
    });
    await adapter.writeFile("settings.yaml", legacyYaml);
    const s = await new FileSettingsRepository(adapter, "").get();
    expect(s.app.react_extraction_enabled).toBe(true);
  });

  it("显式 false round-trip：关掉后读回仍是 false（不被默认开覆盖）", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");
    const s = await repo.get();
    s.app.react_extraction_enabled = false;
    await repo.save(s);
    const reloaded = await repo.get();
    expect(reloaded.app.react_extraction_enabled).toBe(false);
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
          ui_font_id: "source-serif-4", // latin 字体 → 迁到 ui_latin 槽
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

describe("FileSettingsRepository custom_providers / enabled_models（选择器方案 B）", () => {
  const fullProvider = {
    id: "custom-abc123",
    display_name: "我的中转站",
    base_url: "https://relay.example.com/v1",
    chat_path: "/custom/chat",
    api_key: "sk-custom-secret",
    models: [
      {
        id: "org/some-model",
        display_name: "Some Model",
        context_window: 200_000,
        max_output_tokens: 16_384,
        type: "chat" as const,
      },
      {
        id: "bge-large-zh",
        display_name: "BGE Large",
        context_window: 8_192,
        type: "embedding" as const,
      },
    ],
  };

  it("全字段 round-trip：自定义供应商（含 chat_path/max_output_tokens/type）+ enabled_models", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");

    const s1 = await repo.get();
    s1.custom_providers = [structuredClone(fullProvider)];
    s1.enabled_models = {
      deepseek: [{ id: "deepseek-v4-flash", display_name: "deepseek-v4-flash", type: "chat" }],
      "custom-abc123": [
        { id: "org/pulled-model", display_name: "org/pulled-model", context_window: 131_072, type: "chat" },
      ],
    };
    await repo.save(s1);

    const s2 = await repo.get();
    expect(s2.custom_providers).toEqual([fullProvider]);
    expect(s2.enabled_models).toEqual({
      deepseek: [{ id: "deepseek-v4-flash", display_name: "deepseek-v4-flash", type: "chat" }],
      "custom-abc123": [
        { id: "org/pulled-model", display_name: "org/pulled-model", context_window: 131_072, type: "chat" },
      ],
    });
  });

  it("context_window 缺失的模型 round-trip 后仍缺失（未知≠默认值，禁静默兜底）", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");

    const s1 = await repo.get();
    s1.enabled_models = { moonshot: [{ id: "kimi-x", display_name: "kimi-x", type: "chat" }] };
    await repo.save(s1);

    const s2 = await repo.get();
    expect(s2.enabled_models.moonshot[0].context_window).toBeUndefined();
    expect("context_window" in s2.enabled_models.moonshot[0]).toBe(false);
  });

  it("tolerant-read：legacy camelCase 自定义供应商仍能读出、缺 contextWindow 读成 undefined、save 自愈为 snake", async () => {
    const adapter = new MockAdapter();
    // 融合前旧版本写下的 settings.yaml：自定义供应商/模型键是 camelCase
    // （displayName / baseUrl / chatPath / contextWindow / maxOutputTokens）。
    const legacyYaml = yaml.dump({
      default_llm: { mode: "api", model: "gpt-4o", api_base: "", api_key: "" },
      embedding: { mode: "api", model: "", api_base: "", api_key: "" },
      custom_providers: [
        {
          id: "custom-legacy",
          displayName: "老中转站",
          baseUrl: "https://legacy.example.com/v1",
          chatPath: "/legacy/chat",
          api_key: "sk-legacy",
          models: [
            {
              id: "org/legacy-model",
              displayName: "Legacy Model",
              contextWindow: 128_000,
              maxOutputTokens: 8_192,
              type: "chat",
            },
          ],
        },
      ],
      enabled_models: {
        "custom-legacy": [
          { id: "org/with-ctx", displayName: "With Ctx", contextWindow: 65_536, type: "chat" },
          { id: "org/no-ctx", displayName: "No Ctx", type: "chat" }, // 缺 contextWindow → 必须读成 undefined
        ],
      },
      sync: {},
    });
    await adapter.writeFile("settings.yaml", legacyYaml);

    const repo = new FileSettingsRepository(adapter, "");
    const s = await repo.get();

    // tolerant-read：camel 键正确 coalesce 到 snake 域
    const prov = s.custom_providers[0];
    expect(prov.display_name).toBe("老中转站");
    expect(prov.base_url).toBe("https://legacy.example.com/v1");
    expect(prov.chat_path).toBe("/legacy/chat");
    // secure-storage 路径不受键改名影响：明文 api_key 仍被还原（并迁入 secure storage）
    expect(prov.api_key).toBe("sk-legacy");
    expect(prov.models[0].display_name).toBe("Legacy Model");
    expect(prov.models[0].context_window).toBe(128_000);
    expect(prov.models[0].max_output_tokens).toBe(8_192);

    const enabled = s.enabled_models["custom-legacy"];
    expect(enabled[0].display_name).toBe("With Ctx");
    expect(enabled[0].context_window).toBe(65_536);
    // 关键 optional 语义：缺 contextWindow 的老条目读成 undefined，不是 0/默认（UI「按 XXk 估算」依赖 absence）
    expect(enabled[1].context_window).toBeUndefined();
    expect("context_window" in enabled[1]).toBe(false);

    // save → 落盘自愈为 snake：文件不再含任何 camel 键，改含对应 snake 键
    await repo.save(s);
    const written = await adapter.readFile("settings.yaml");
    expect(written).not.toMatch(/displayName|baseUrl|chatPath|contextWindow|maxOutputTokens/);
    expect(written).toContain("display_name:");
    expect(written).toContain("base_url:");
    expect(written).toContain("chat_path:");
    expect(written).toContain("context_window:");
    expect(written).toContain("max_output_tokens:");

    // 自愈后再读一遍，值不变、optional 语义保持
    const s2 = await repo.get();
    expect(s2.custom_providers[0].display_name).toBe("老中转站");
    expect(s2.custom_providers[0].chat_path).toBe("/legacy/chat");
    expect(s2.enabled_models["custom-legacy"][1].context_window).toBeUndefined();
  });

  it("自定义供应商 api_key 走 secure storage：YAML 无明文、读回还原", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");

    const s1 = await repo.get();
    s1.custom_providers = [structuredClone(fullProvider)];
    await repo.save(s1);

    const yamlText = await adapter.readFile("settings.yaml");
    expect(yamlText).not.toContain("sk-custom-secret");
    expect(await adapter.secureGet("settings.custom_providers.custom-abc123.api_key")).toBe("sk-custom-secret");

    const s2 = await repo.get();
    expect(s2.custom_providers[0].api_key).toBe("sk-custom-secret");
  });

  it("旧 settings.yaml 无新字段 → 读入不炸，回退空集合", async () => {
    const adapter = new MockAdapter();
    const legacyYaml = yaml.dump({
      default_llm: { mode: "api", model: "gpt-4o", api_base: "", api_key: "" },
      embedding: { mode: "api", model: "", api_base: "", api_key: "" },
      sync: {},
    });
    await adapter.writeFile("settings.yaml", legacyYaml);

    const s = await new FileSettingsRepository(adapter, "").get();
    expect(s.custom_providers).toEqual([]);
    expect(s.enabled_models).toEqual({});
    expect(s.default_llm.model).toBe("gpt-4o"); // 同文件其它字段无损
  });

  it("脏数据防御：无 id 的供应商条目被丢弃、非数组 enabled_models 值被忽略", async () => {
    const adapter = new MockAdapter();
    const dirtyYaml = yaml.dump({
      default_llm: { mode: "api", model: "", api_base: "", api_key: "" },
      embedding: { mode: "api", model: "", api_base: "", api_key: "" },
      custom_providers: [
        { display_name: "无 id 条目", base_url: "https://x.example.com" },
        { id: "ok-1", display_name: "正常条目", base_url: "https://y.example.com", api_key: "" },
      ],
      enabled_models: { deepseek: "not-an-array", zhipu: [{ id: "glm-5.2", type: "chat" }] },
      sync: {},
    });
    await adapter.writeFile("settings.yaml", dirtyYaml);

    const s = await new FileSettingsRepository(adapter, "").get();
    expect(s.custom_providers).toHaveLength(1);
    expect(s.custom_providers[0].id).toBe("ok-1");
    expect(Object.keys(s.enabled_models)).toEqual(["zhipu"]);
    expect(s.enabled_models.zhipu[0].display_name).toBe("glm-5.2"); // display_name 缺失回退 id
  });
});

describe("FileSettingsRepository writing_mode 字段退役 — 容忍读取 + 不再持久化", () => {
  it("旧 settings.yaml 含 writing_mode → 加载不崩，该字段被丢弃，同块其它字段无损", async () => {
    const adapter = new MockAdapter();
    // 模拟融合前写下的 settings.yaml（app 里还带 writing_mode 开关）
    const legacyYaml = yaml.dump({
      default_llm: { mode: "api", model: "", api_base: "", api_key: "" },
      embedding: { mode: "api", model: "", api_base: "", api_key: "" },
      app: { language: "en", writing_mode: "simple" },
      sync: {},
    });
    await adapter.writeFile("settings.yaml", legacyYaml);

    const repo = new FileSettingsRepository(adapter, "");
    const s = await repo.get();

    // 字段已退役：domain 不再携带 writing_mode（dict→domain 映射不读它，自然丢弃）
    expect("writing_mode" in (s.app as unknown as Record<string, unknown>)).toBe(false);
    // 丢弃 writing_mode 不影响同 app 块其它字段的读取
    expect(s.app.language).toBe("en");
  });

  it("save 回写的 yaml 不再包含 writing_mode 字段", async () => {
    const adapter = new MockAdapter();
    const repo = new FileSettingsRepository(adapter, "");

    const s = await repo.get();
    await repo.save(s);

    const written = await adapter.readFile("settings.yaml");
    expect(written).not.toContain("writing_mode");
  });
});
