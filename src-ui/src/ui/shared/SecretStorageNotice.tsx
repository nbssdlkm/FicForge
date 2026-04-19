// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useTranslation } from "../../i18n/useAppTranslation";
import { useSecretStorageCapabilities } from "../../hooks/useSecretStorageCapabilities";
import { InlineBanner, type InlineBannerTone } from "./InlineBanner";

export function SecretStorageNotice({
  enabled = true,
  compact = false,
  className,
  auPath,
}: {
  enabled?: boolean;
  compact?: boolean;
  className?: string;
  auPath?: string;
}) {
  const { t } = useTranslation();
  const capabilities = useSecretStorageCapabilities({ enabled, auPath });

  if (!capabilities) return null;

  const tone: InlineBannerTone = capabilities.encrypted_at_rest ? "info" : "warning";
  const copy = getSecretStorageCopy(capabilities, t);

  return (
    <InlineBanner
      tone={tone}
      compact={compact}
      className={className}
      message={(
        <div className="space-y-1">
          <p className="font-semibold">{copy.title}</p>
          <p className="leading-relaxed text-current/80">{copy.body}</p>
        </div>
      )}
    />
  );
}

function getSecretStorageCopy(
  capabilities: {
    backend: "local_storage" | "local_storage_with_memory_fallback" | "memory" | "os_keyring";
    encrypted_at_rest: boolean;
    persistence: "persistent" | "best_effort" | "memory_only";
  },
  t: (key: string) => string,
) {
  if (capabilities.encrypted_at_rest) {
    return {
      title: t("security.secretStorage.encryptedTitle"),
      body: t("security.secretStorage.encryptedBody"),
    };
  }

  if (capabilities.persistence === "memory_only") {
    return {
      title: t("security.secretStorage.memoryOnlyTitle"),
      body: t("security.secretStorage.memoryOnlyBody"),
    };
  }

  if (capabilities.persistence === "best_effort") {
    return {
      title: t("security.secretStorage.bestEffortTitle"),
      body: t("security.secretStorage.bestEffortBody"),
    };
  }

  return {
    title: t("security.secretStorage.unencryptedTitle"),
    body: t("security.secretStorage.unencryptedBody"),
  };
}
