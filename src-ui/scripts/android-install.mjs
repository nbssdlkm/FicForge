#!/usr/bin/env node
// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Android dev install pipeline.
 *
 * Why this exists:
 *   `npx cap run android` is the "official" Capacitor command but on this
 *   Windows + Git Bash machine it fails to find gradlew (PATH quoting issue)
 *   and JAVA_HOME is not set globally. This script does the same 5 steps
 *   manually with the right env so it just works.
 *
 * Steps:
 *   1. vite build       — compile React app to dist/
 *   2. cap sync android — copy dist/ into android/app/src/main/assets/public
 *   3. gradlew assembleDebug — produce app-debug.apk
 *   4. adb install -r   — overwrite-install on connected device (preserves data)
 *   5. adb shell monkey — launch the app
 *
 * Usage:
 *   npm run android:install              # full pipeline
 *   npm run android:install -- --skip-build  # skip step 1 (faster iteration on Capacitor-only changes)
 *
 * Requires:
 *   - Android Studio installed (provides JBR at the path below)
 *   - Android SDK platform-tools (adb)
 *   - A connected device with USB debugging enabled (or running emulator)
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---- Configuration (machine-specific paths) ----

const JAVA_HOME = "C:\\Program Files\\Android\\Android Studio\\jbr";
// SDK relocated to C:\Android\Sdk (2026-04 reinstall after disk cleanup);
// previous default user-profile location no longer exists.
const ANDROID_HOME = "C:\\Android\\Sdk";
const ADB = `${ANDROID_HOME}\\platform-tools\\adb.exe`;
const APP_ID = "com.ficforge.app";

// ---- Helpers ----

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

function step(num, total, msg) {
  console.log(`\n[${num}/${total}] ${msg}`);
}

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, {
    stdio: "inherit",
    cwd: projectRoot,
    env: {
      ...process.env,
      JAVA_HOME,
      ANDROID_HOME,
      ANDROID_SDK_ROOT: ANDROID_HOME,
      Path: `${JAVA_HOME}\\bin;${ANDROID_HOME}\\platform-tools;${process.env.Path || process.env.PATH || ""}`,
    },
    ...opts,
  });
}

function preflight() {
  if (!existsSync(JAVA_HOME)) {
    console.error(`[error] JAVA_HOME path does not exist: ${JAVA_HOME}`);
    console.error(`        Open Android Studio → Settings → Build → Build Tools → Gradle to find your JBR location`);
    process.exit(1);
  }
  if (!existsSync(ANDROID_HOME)) {
    console.error(`[error] ANDROID_HOME path does not exist: ${ANDROID_HOME}`);
    console.error(`        Reinstall the Android SDK (Android Studio → SDK Manager) or update ANDROID_HOME in this script`);
    process.exit(1);
  }
  if (!existsSync(ADB)) {
    console.error(`[error] adb not found at: ${ADB}`);
    console.error(`        Run: ${ANDROID_HOME}\\cmdline-tools\\latest\\bin\\sdkmanager.bat platform-tools`);
    process.exit(1);
  }

  const devices = spawnSync(ADB, ["devices"], { encoding: "utf8" });
  const lines = devices.stdout.split("\n").filter((l) => l.includes("\tdevice"));
  if (lines.length === 0) {
    console.error("[error] No Android device connected.");
    console.error("        Connect a device with USB debugging on, or start an emulator.");
    console.error(`        Then re-run: ${ADB} devices`);
    process.exit(1);
  }
  console.log(`[ok] Found ${lines.length} device(s):`);
  lines.forEach((l) => console.log(`     ${l.trim()}`));
}

// ---- Pipeline ----

const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const totalSteps = skipBuild ? 4 : 5;
let stepNum = 0;

console.log("Android install pipeline");
console.log("========================\n");

preflight();

if (!skipBuild) {
  step(++stepNum, totalSteps, "vite build (compile React)");
  run("npm run build");
}

step(++stepNum, totalSteps, "cap sync android (copy dist/ into android project)");
run("npx cap sync android");

step(++stepNum, totalSteps, "gradlew assembleDebug (compile APK)");
const gradlewPath = resolve(projectRoot, "android", "gradlew.bat");
run(`"${gradlewPath}" assembleDebug`, { cwd: resolve(projectRoot, "android") });

step(++stepNum, totalSteps, "adb install (overwrite-install on device)");
run(`"${ADB}" install -r android/app/build/outputs/apk/debug/app-debug.apk`);

step(++stepNum, totalSteps, "adb shell monkey (launch app)");
run(`"${ADB}" shell monkey -p ${APP_ID} -c android.intent.category.LAUNCHER 1`);

console.log("\n[done] App should be running on your device.");
