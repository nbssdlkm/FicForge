// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useState } from "react";
import { getSettingsSecretCapabilities, type SecretStorageCapabilities } from "../api/engine-client";
import { useActiveRequestGuard } from "./useActiveRequestGuard";

export function useSecretStorageCapabilities(enabled = true) {
  const requestGuard = useActiveRequestGuard(enabled ? "secret-storage-capabilities-enabled" : "secret-storage-capabilities-disabled");
  const [capabilities, setCapabilities] = useState<SecretStorageCapabilities | null>(null);

  useEffect(() => {
    if (!enabled) {
      setCapabilities(null);
      return;
    }

    const token = requestGuard.start();
    getSettingsSecretCapabilities()
      .then((next) => {
        if (!requestGuard.isStale(token)) {
          setCapabilities(next);
        }
      })
      .catch(() => {
        if (!requestGuard.isStale(token)) {
          setCapabilities(null);
        }
      });
  }, [enabled]);

  return capabilities;
}
