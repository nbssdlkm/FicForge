// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import type { PlatformAdapter, SecretStorageCapabilities } from "./adapter.js";

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  getCapabilities(): SecretStorageCapabilities;
}

export function createAdapterSecretStore(adapter: PlatformAdapter): SecretStore {
  return {
    get: (key) => adapter.secureGet(key),
    set: (key, value) => adapter.secureSet(key, value),
    remove: (key) => adapter.secureRemove(key),
    async has(key) {
      return (await adapter.secureGet(key)) !== null;
    },
    getCapabilities: () => adapter.getSecretStorageCapabilities(),
  };
}
