// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it } from "vitest";
import { initEngine } from "../engine-instance";
import { getProjectCapabilities } from "../engine-project";
import { getSettingsSecretCapabilities } from "../engine-settings";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";

describe("engine secret storage capabilities", () => {
  beforeEach(() => {
    initEngine(new MockAdapter(), "");
  });

  it("reports current adapter-backed settings secret storage capabilities", async () => {
    await expect(getSettingsSecretCapabilities()).resolves.toEqual({
      backend: "memory",
      encrypted_at_rest: false,
      persistence: "memory_only",
    });
  });

  it("surfaces the same capability shape for project queries", async () => {
    await expect(getProjectCapabilities("/mock/au")).resolves.toEqual({
      secret_storage: {
        backend: "memory",
        encrypted_at_rest: false,
        persistence: "memory_only",
      },
    });
  });
});
