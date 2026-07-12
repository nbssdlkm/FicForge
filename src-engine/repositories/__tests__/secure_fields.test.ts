// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Secure fields 核心契约测试。
 *
 * 覆盖本轮审计 P0-3 的修复：
 * - 明文 → secure storage + 占位符（extract）
 * - 占位符 → secure storage 还原（restore 新格式）
 * - 旧明文 YAML → 自动迁移到 secure storage（restore 兼容路径）
 * - 删除 → 清理 secure storage（防孤儿 key）
 */

import { describe, it, expect, vi } from "vitest";
import {
  extractSecureFields,
  restoreSecureFields,
  removeSecureFields,
  SECURE_PLACEHOLDER,
  type SecureFieldSpec,
} from "../implementations/secure_fields.js";
import { MockAdapter } from "./mock_adapter.js";
import { SecretStoreReadError } from "../../platform/adapter.js";

/** 模拟 Keystore 瞬时故障：secureGet 抛错，set/remove 也失败（典型整库不可用）。 */
class OutageAdapter extends MockAdapter {
  outage = false;

  override async secureGet(key: string): Promise<string | null> {
    if (this.outage) throw new SecretStoreReadError(key, new Error("keystore outage"));
    return super.secureGet(key);
  }

  override async secureRemove(key: string): Promise<void> {
    if (this.outage) throw new Error("keystore outage");
    return super.secureRemove(key);
  }
}

interface TestObj {
  api_key: string;
  password: string;
  not_secret: string;
}

const specs: SecureFieldSpec<TestObj>[] = [
  {
    secureKey: "test.api_key",
    get: (o) => o.api_key,
    set: (o, v) => {
      o.api_key = v;
    },
  },
  {
    secureKey: "test.password",
    get: (o) => o.password,
    set: (o, v) => {
      o.password = v;
    },
  },
];

describe("extractSecureFields", () => {
  it("明文字段被搬到 secure storage，对象替换为占位符", async () => {
    const adapter = new MockAdapter();
    const obj: TestObj = { api_key: "sk-real", password: "hunter2", not_secret: "visible" };

    await extractSecureFields(obj, specs, adapter);

    expect(obj.api_key).toBe(SECURE_PLACEHOLDER);
    expect(obj.password).toBe(SECURE_PLACEHOLDER);
    expect(obj.not_secret).toBe("visible");
    expect(await adapter.secureGet("test.api_key")).toBe("sk-real");
    expect(await adapter.secureGet("test.password")).toBe("hunter2");
  });

  it("显式置空清除 secure storage 里的旧密钥，再读不会水合陈旧 key（TD-016 全量审阅）", async () => {
    const adapter = new MockAdapter();
    await adapter.secureSet("test.api_key", "sk-STALE");

    // 用户置空该字段后再次保存（如关闭 AU 覆盖）
    const obj: TestObj = { api_key: "", password: "", not_secret: "x" };
    await extractSecureFields(obj, specs, adapter);
    expect(await adapter.secureGet("test.api_key")).toBeNull();

    // 关键：再读回来不会被陈旧密钥水合，磁盘的「空」就是真的空
    const reread: TestObj = { api_key: "", password: "", not_secret: "x" };
    await restoreSecureFields(reread, specs, adapter);
    expect(reread.api_key).toBe("");
  });

  it("已是占位符的字段不回写 secure storage", async () => {
    const adapter = new MockAdapter();
    // 预先写入真实值
    await adapter.secureSet("test.api_key", "original");
    // 对象字段为占位符（表示"值已在 secure storage"）
    const obj: TestObj = { api_key: SECURE_PLACEHOLDER, password: "", not_secret: "" };

    await extractSecureFields(obj, specs, adapter);

    // 不应该把占位符写入 secure storage 覆盖真实值
    expect(await adapter.secureGet("test.api_key")).toBe("original");
  });

  it("空字段不动 secure storage", async () => {
    const adapter = new MockAdapter();
    const obj: TestObj = { api_key: "", password: "", not_secret: "" };

    await extractSecureFields(obj, specs, adapter);

    expect(await adapter.secureGet("test.api_key")).toBe(null);
    expect(await adapter.secureGet("test.password")).toBe(null);
  });
});

describe("restoreSecureFields", () => {
  it("占位符字段从 secure storage 还原", async () => {
    const adapter = new MockAdapter();
    await adapter.secureSet("test.api_key", "sk-real");
    const obj: TestObj = { api_key: SECURE_PLACEHOLDER, password: SECURE_PLACEHOLDER, not_secret: "" };

    await restoreSecureFields(obj, specs, adapter);

    expect(obj.api_key).toBe("sk-real");
    expect(obj.password).toBe(""); // 读不到 → 置空
  });

  it("旧版本明文自动迁移到 secure storage（实现无感升级）", async () => {
    const adapter = new MockAdapter();
    // 模拟 "旧 YAML 直接存的明文" 被读进对象
    const obj: TestObj = { api_key: "legacy-plain-key", password: "legacy-pw", not_secret: "" };

    await restoreSecureFields(obj, specs, adapter);

    // 明文保留在对象里（下一次 save 才会触发 extractSecureFields 换成占位符）
    expect(obj.api_key).toBe("legacy-plain-key");
    // 但 secure storage 已经有备份，下一次 save 时 extract 不会丢数据
    expect(await adapter.secureGet("test.api_key")).toBe("legacy-plain-key");
    expect(await adapter.secureGet("test.password")).toBe("legacy-pw");
  });

  it("空字段尝试从 secure storage 读取（新设备首次加载）", async () => {
    const adapter = new MockAdapter();
    await adapter.secureSet("test.api_key", "from-another-device");
    // 新解析的 yaml 里字段为空（如本地无配置文件，但 secure storage 被恢复了）
    const obj: TestObj = { api_key: "", password: "", not_secret: "" };

    await restoreSecureFields(obj, specs, adapter);

    expect(obj.api_key).toBe("from-another-device");
  });

  // ── 审计 H8 核心不变量：读失败 ≠ 空值，保存绝不因读失败删已存 secret ──────
  it("读失败时占位符字段保持占位符（不置空）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const adapter = new OutageAdapter();
      await adapter.secureSet("test.api_key", "sk-real");
      adapter.outage = true;

      const obj: TestObj = { api_key: SECURE_PLACEHOLDER, password: "", not_secret: "" };
      await restoreSecureFields(obj, specs, adapter);

      // 旧行为把读不到的占位符置空 —— 空值语义会在下次 save 时删掉真 key
      expect(obj.api_key).toBe(SECURE_PLACEHOLDER);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("Keystore 故障全周期：load（读失败）→ 用户保存 → 真 key 仍在 secure storage", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const adapter = new OutageAdapter();

      // 1) 正常时期：用户存过真 key（save 提取到 secure storage）
      const saved: TestObj = { api_key: "sk-precious", password: "", not_secret: "" };
      await extractSecureFields(saved, specs, adapter);
      expect(await adapter.kvGet("__secure__:test.api_key")).toBe("sk-precious");

      // 2) Keystore 故障期：加载设置（yaml 里是占位符，读失败）
      adapter.outage = true;
      const loaded: TestObj = { api_key: SECURE_PLACEHOLDER, password: "", not_secret: "" };
      await restoreSecureFields(loaded, specs, adapter);

      // 3) 瞬时故障已过去，用户没改任何东西直接保存（H8 事故路径）——
      //    危险的是加载期残留在内存里的字段值：旧代码把它置成 ""，
      //    此刻 Keystore 已恢复，extract 的空值分支会真的 remove 掉真 key
      adapter.outage = false;
      await extractSecureFields(loaded, specs, adapter);

      // 4) 真 key 必须还在 —— 这是本轮修复要守住的不变量
      expect(await adapter.secureGet("test.api_key")).toBe("sk-precious");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("读失败不拖垮整条加载链：其余字段照常还原", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const adapter = new MockAdapter();
      await adapter.secureSet("test.password", "pw-ok");
      const flakyGet = adapter.secureGet.bind(adapter);
      adapter.secureGet = async (key: string) => {
        if (key === "test.api_key") throw new SecretStoreReadError(key);
        return flakyGet(key);
      };

      const obj: TestObj = { api_key: SECURE_PLACEHOLDER, password: SECURE_PLACEHOLDER, not_secret: "" };
      await restoreSecureFields(obj, specs, adapter);

      expect(obj.api_key).toBe(SECURE_PLACEHOLDER); // 故障字段保持已存储语义
      expect(obj.password).toBe("pw-ok"); // 健康字段正常还原
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("完整 round-trip：save → restore 还原一致", async () => {
    const adapter = new MockAdapter();
    const original: TestObj = { api_key: "k1", password: "p1", not_secret: "visible" };

    // 模拟 save：先 extract，然后假装 obj 被 yaml dump + load 回来
    const copy = { ...original };
    await extractSecureFields(copy, specs, adapter);
    // yaml 里只剩占位符 → copy.api_key = <secure>

    // 模拟 load：从 yaml 解析得到新对象（带占位符），然后 restore
    const loaded: TestObj = { ...copy };
    await restoreSecureFields(loaded, specs, adapter);

    expect(loaded).toEqual(original);
  });
});

describe("removeSecureFields", () => {
  it("清理指定 key 的 secure storage", async () => {
    const adapter = new MockAdapter();
    await adapter.secureSet("test.api_key", "k1");
    await adapter.secureSet("test.password", "p1");
    await adapter.secureSet("test.other", "stay");

    await removeSecureFields(["test.api_key", "test.password"], adapter);

    expect(await adapter.secureGet("test.api_key")).toBe(null);
    expect(await adapter.secureGet("test.password")).toBe(null);
    // 不在列表中的不被误删
    expect(await adapter.secureGet("test.other")).toBe("stay");
  });

  it("removeSecureFields 是 best-effort：个别 key 不存在不抛错", async () => {
    const adapter = new MockAdapter();
    await adapter.secureSet("test.exists", "v");

    await expect(removeSecureFields(["test.exists", "test.does.not.exist"], adapter)).resolves.not.toThrow();

    expect(await adapter.secureGet("test.exists")).toBe(null);
  });
});
