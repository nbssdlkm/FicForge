// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FileProjectRepository 测试（P0-3）。
 *
 * 覆盖：
 * - AU 级 llm.api_key / embedding_lock.api_key 不再明文落盘
 * - 旧版本明文 project.yaml 自动迁移到 secure storage（向后兼容）
 * - 删除 AU 时 removeSecureStorage 清理凭据
 * - 多 AU 凭据用 au_id 做 namespace，互不干扰
 */

import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { FileProjectRepository } from "../implementations/file_project.js";
import { createProject } from "../../domain/project.js";
import { MockAdapter } from "./mock_adapter.js";

describe("FileProjectRepository secure fields", () => {
  it("save 后 project.yaml 不含 llm/embedding_lock 的 api_key 明文", async () => {
    const adapter = new MockAdapter();
    const repo = new FileProjectRepository(adapter);
    const auPath = "fandoms/F/aus/a1";

    const proj = createProject({
      au_id: auPath,
      project_id: "p1",
      name: "test",
      fandom: "F",
    });
    proj.llm.api_key = "sk-llm-secret";
    proj.embedding_lock.api_key = "emb-secret";
    proj.llm.model = "gpt-4o";
    await repo.save(proj);

    const yamlText = await adapter.readFile(`${auPath}/project.yaml`);
    expect(yamlText).not.toContain("sk-llm-secret");
    expect(yamlText).not.toContain("emb-secret");
    expect(yamlText).toContain("<secure>");
    // 非敏感字段正常写入
    expect(yamlText).toContain("gpt-4o");
  });

  it("save → get round-trip 还原 api_key 一致", async () => {
    const adapter = new MockAdapter();
    const repo = new FileProjectRepository(adapter);
    const auPath = "fandoms/F/aus/a1";

    const p1 = createProject({ au_id: auPath, project_id: "p1", name: "x", fandom: "F" });
    p1.llm.api_key = "sk-a";
    p1.embedding_lock.api_key = "emb-b";
    await repo.save(p1);

    const p2 = await repo.get(auPath);
    expect(p2.llm.api_key).toBe("sk-a");
    expect(p2.embedding_lock.api_key).toBe("emb-b");
  });

  it("旧明文 project.yaml 可以自动迁移到 secure storage", async () => {
    const adapter = new MockAdapter();
    const auPath = "fandoms/F/aus/legacy";

    // 模拟旧版本直接写明文的 project.yaml
    const legacyYaml = yaml.dump({
      project_id: "legacy-p",
      au_id: auPath,
      name: "legacy",
      fandom: "F",
      schema_version: "1.0.0",
      revision: 5,
      llm: {
        mode: "api",
        model: "gpt-4",
        api_base: "https://api.openai.com",
        api_key: "legacy-plaintext-llm",
      },
      embedding_lock: {
        mode: "api",
        model: "text-embedding-3-small",
        api_base: "https://api.openai.com",
        api_key: "legacy-plaintext-emb",
      },
      writing_style: {},
      cast_registry: { characters: [] },
    });
    await adapter.writeFile(`${auPath}/project.yaml`, legacyYaml);

    const repo = new FileProjectRepository(adapter);
    const loaded = await repo.get(auPath);

    // 读取后对象上仍保留原明文（当前会话可直接用）
    expect(loaded.llm.api_key).toBe("legacy-plaintext-llm");
    expect(loaded.embedding_lock.api_key).toBe("legacy-plaintext-emb");

    // 同时明文已经被搬进 secure storage（下次 save 就会变成占位符）
    expect(await adapter.secureGet(`project.${auPath}.llm.api_key`)).toBe("legacy-plaintext-llm");
    expect(await adapter.secureGet(`project.${auPath}.embedding_lock.api_key`)).toBe("legacy-plaintext-emb");

    // 再 save 一次，project.yaml 已不含明文
    await repo.save(loaded);
    const updatedYaml = await adapter.readFile(`${auPath}/project.yaml`);
    expect(updatedYaml).not.toContain("legacy-plaintext-llm");
    expect(updatedYaml).not.toContain("legacy-plaintext-emb");
    expect(updatedYaml).toContain("<secure>");
  });

  it("多 AU 的凭据用 au_id 做 namespace，互不干扰", async () => {
    const adapter = new MockAdapter();
    const repo = new FileProjectRepository(adapter);
    const auA = "fandoms/F/aus/A";
    const auB = "fandoms/F/aus/B";

    const pA = createProject({ au_id: auA, project_id: "pa", name: "A", fandom: "F" });
    pA.llm.api_key = "key-for-A";
    await repo.save(pA);

    const pB = createProject({ au_id: auB, project_id: "pb", name: "B", fandom: "F" });
    pB.llm.api_key = "key-for-B";
    await repo.save(pB);

    // 两个 AU 的 secure key 应该是独立的
    expect(await adapter.secureGet(`project.${auA}.llm.api_key`)).toBe("key-for-A");
    expect(await adapter.secureGet(`project.${auB}.llm.api_key`)).toBe("key-for-B");

    // 读回来互不污染
    const rA = await repo.get(auA);
    const rB = await repo.get(auB);
    expect(rA.llm.api_key).toBe("key-for-A");
    expect(rB.llm.api_key).toBe("key-for-B");
  });

  it("removeSecureStorage 清理该 AU 的凭据，不影响其他 AU", async () => {
    const adapter = new MockAdapter();
    const repo = new FileProjectRepository(adapter);
    const auA = "fandoms/F/aus/A";
    const auB = "fandoms/F/aus/B";

    const pA = createProject({ au_id: auA, project_id: "pa", name: "A", fandom: "F" });
    pA.llm.api_key = "key-for-A";
    await repo.save(pA);

    const pB = createProject({ au_id: auB, project_id: "pb", name: "B", fandom: "F" });
    pB.llm.api_key = "key-for-B";
    await repo.save(pB);

    await repo.removeSecureStorage(auA);

    // A 的凭据被清
    expect(await adapter.secureGet(`project.${auA}.llm.api_key`)).toBe(null);
    expect(await adapter.secureGet(`project.${auA}.embedding_lock.api_key`)).toBe(null);
    // B 的凭据保留
    expect(await adapter.secureGet(`project.${auB}.llm.api_key`)).toBe("key-for-B");
  });
});
