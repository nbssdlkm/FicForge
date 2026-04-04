/**
 * check-i18n-sync.ts
 *
 * Compares all locale JSON files under src/locales/ and reports missing keys.
 * Exit code 1 if any language is out of sync.
 *
 * Usage:  npx tsx scripts/check-i18n-sync.ts
 * Hook:   Add to package.json scripts → "predev": "npx tsx scripts/check-i18n-sync.ts"
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCALES_DIR = path.resolve(__dirname, "../src/locales");

function collectKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...collectKeys(v as Record<string, unknown>, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

function main() {
  const files = fs
    .readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (files.length < 2) {
    console.log("Only one locale file found — nothing to compare.");
    process.exit(0);
  }

  const locales: Record<string, Set<string>> = {};
  for (const file of files) {
    const lang = file.replace(".json", "");
    const content = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf-8")
    );
    locales[lang] = new Set(collectKeys(content));
  }

  const allKeys = new Set<string>();
  for (const keys of Object.values(locales)) {
    for (const k of keys) allKeys.add(k);
  }

  let hasErrors = false;

  for (const [lang, keys] of Object.entries(locales)) {
    const missing = [...allKeys].filter((k) => !keys.has(k)).sort();
    if (missing.length > 0) {
      hasErrors = true;
      console.error(`\n❌ ${lang}.json is missing ${missing.length} key(s):`);
      for (const k of missing) {
        console.error(`   - ${k}`);
      }
    }
  }

  if (hasErrors) {
    console.error("\n⚠️  i18n files are out of sync. Please fix the missing keys above.");
    process.exit(1);
  } else {
    console.log(`✅ All ${files.length} locale files are in sync (${allKeys.size} keys each).`);
    process.exit(0);
  }
}

main();
