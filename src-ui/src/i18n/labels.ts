// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import i18n from "../i18n";

function translateWithFallback(key: string, fallback: string): string {
  const value = i18n.t(key);
  return value === key ? fallback : value;
}

export function getEnumLabel(
  group: string,
  value: string | null | undefined,
  fallback = ""
): string {
  if (!value) return fallback;
  return translateWithFallback(`enums.${group}.${value}`, fallback || value);
}

export function getOriginRefLabel(originRef: string | null | undefined): string {
  if (!originRef) return "";
  if (originRef === "original") {
    return i18n.t("enums.origin_ref.original");
  }
  if (originRef.startsWith("fandom/")) {
    return i18n.t("enums.origin_ref.fandom", {
      name: originRef.slice("fandom/".length),
    });
  }
  return originRef;
}
