// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useSecretStorageCapabilities 能力探测（R4 测试 L4：此前零测试）。
 *
 * 两条主路 + 降级：
 *   - enabled=false → 不探测，恒 null。
 *   - settings 作用域（无 auPath）→ getSettingsSecretCapabilities。
 *   - project 作用域（有 auPath）→ getProjectCapabilities(auPath).secret_storage。
 *   - 探测失败（reject）→ catch 降级 null（不抛、不悬）。
 */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSecretStorageCapabilities } from "../useSecretStorageCapabilities";
import { getProjectCapabilities, getSettingsSecretCapabilities } from "../../api/engine-client";

vi.mock("../../api/engine-client", () => ({
  getProjectCapabilities: vi.fn(),
  getSettingsSecretCapabilities: vi.fn(),
}));

const CAPS = { backend: "os_keyring", encrypted_at_rest: true, persistence: "persistent" } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useSecretStorageCapabilities", () => {
  it("enabled=false → 不探测，返回 null", () => {
    const { result } = renderHook(() => useSecretStorageCapabilities({ enabled: false }));
    expect(result.current).toBeNull();
    expect(getSettingsSecretCapabilities).not.toHaveBeenCalled();
    expect(getProjectCapabilities).not.toHaveBeenCalled();
  });

  it("settings 作用域（无 auPath）成功 → 存 capabilities", async () => {
    vi.mocked(getSettingsSecretCapabilities).mockResolvedValue(CAPS);
    const { result } = renderHook(() => useSecretStorageCapabilities());
    await waitFor(() => expect(result.current).toEqual(CAPS));
    expect(getSettingsSecretCapabilities).toHaveBeenCalledTimes(1);
    expect(getProjectCapabilities).not.toHaveBeenCalled();
  });

  it("project 作用域（有 auPath）成功 → 取 result.secret_storage", async () => {
    vi.mocked(getProjectCapabilities).mockResolvedValue({ secret_storage: CAPS } as never);
    const { result } = renderHook(() => useSecretStorageCapabilities({ auPath: "au1" }));
    await waitFor(() => expect(result.current).toEqual(CAPS));
    expect(getProjectCapabilities).toHaveBeenCalledWith("au1");
    expect(getSettingsSecretCapabilities).not.toHaveBeenCalled();
  });

  it("探测失败（reject）→ catch 降级 null（不抛、不悬）", async () => {
    vi.mocked(getSettingsSecretCapabilities).mockRejectedValue(new Error("keyring 读失败"));
    const { result } = renderHook(() => useSecretStorageCapabilities());
    await waitFor(() => expect(getSettingsSecretCapabilities).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
