#!/usr/bin/env node
// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Remote Android build pipeline.
 *
 * Why this exists:
 *   The local Windows host's NIO Selector path is permanently broken by an
 *   OS-level AF_UNIX hook (residual WFP filter from a previously-uninstalled
 *   AV; ruled out every active suspect, gave up). Gradle daemon can't start.
 *   Local `npm run android:install` errors with
 *     "java.io.IOException: Unable to establish loopback connection".
 *   See .claude/skills/android-test/SKILL.md for full diagnosis.
 *
 *   Workaround: Ubuntu server (192.168.1.101) builds the APK, syncthing
 *   delivers it to D:\sync\, this script does the local adb install. adb
 *   uses TCP, unaffected.
 *
 * Steps:
 *   1. git push current branch to origin (Ubuntu pulls from there)
 *   2. adb device check (fail fast if Mate 60 not connected)
 *   3. ssh trigger Ubuntu build script (build-android-remote.sh)
 *   4. wait for syncthing to deliver APK + md5 to D:\sync\
 *   5. adb install -r + launch
 *
 * Usage:
 *   npm run android:install:remote
 *
 * Requires:
 *   - SSH key auth to nbssdlkm@192.168.1.101 (set up at ~/.ssh/id_ed25519)
 *   - syncthing running on both Windows and Ubuntu (D:\sync ↔ ~/sync)
 *   - Mate 60 connected via USB with debugging on
 *   - Ubuntu has ~/ficforge/build-android-remote.sh + keystore in place
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---- Configuration ----

const SSH_HOST = "nbssdlkm@192.168.1.101";
const REMOTE_BUILD_SCRIPT = "~/ficforge/build-android-remote.sh";
const SYNC_APK_PATH = "D:\\sync\\ficforge-debug.apk";
const SYNC_MD5_PATH = "D:\\sync\\ficforge-debug.apk.md5";
const ADB = "C:\\Android\\Sdk\\platform-tools\\adb.exe";
const APP_ID = "com.ficforge.app";

const SYNC_TIMEOUT_MS = 90_000;     // wait at most 90s for syncthing
const SYNC_POLL_INTERVAL_MS = 2000;

// ---- Helpers ----

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

function step(num, total, msg) {
  console.log(`\n[${num}/${total}] ${msg}`);
}

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: projectRoot, ...opts });
}

function getCurrentBranch() {
  return execSync("git branch --show-current", { cwd: projectRoot }).toString().trim();
}

function fileMd5(path) {
  // Use certutil (built-in on Windows, no dependency) and parse out the hash line
  const out = execSync(`certutil -hashfile "${path}" MD5`, { encoding: "utf8" });
  // certutil output: line 1 is "MD5 hash of <path>:", line 2 is the hash, line 3 is "CertUtil: -hashfile completed successfully."
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // The hash line is exactly 32 hex chars
  const hashLine = lines.find((l) => /^[0-9a-f ]{32,}$/i.test(l));
  if (!hashLine) throw new Error(`certutil output unparseable:\n${out}`);
  return hashLine.replace(/\s+/g, "").toLowerCase();
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- Pipeline ----

const totalSteps = 5;
let stepNum = 0;

console.log("FicForge Android remote install pipeline");
console.log("========================================");
console.log("(Local Windows build is broken — see SKILL.md. Building on Ubuntu instead.)");

// ---- Step 1: push current branch ----
step(++stepNum, totalSteps, "git push current branch to origin");
const branch = getCurrentBranch();
console.log(`  branch: ${branch}`);

// Warn if there are uncommitted changes — they won't be in the build.
const dirtyStatus = execSync("git status --porcelain", { cwd: projectRoot }).toString().trim();
if (dirtyStatus) {
  console.log("  [warn] uncommitted changes (won't be in this build):");
  console.log(dirtyStatus.split("\n").map((l) => "    " + l).join("\n"));
}

try {
  run(`git push origin ${branch}`);
} catch (e) {
  console.error(`\n[error] git push failed.`);
  console.error(`  If upstream not set yet:  git push -u origin ${branch}`);
  console.error(`  If branch doesn't exist on remote, create it first.`);
  process.exit(1);
}

// ---- Step 2: device check ----
step(++stepNum, totalSteps, "adb device check");
const devices = spawnSync(ADB, ["devices"], { encoding: "utf8" });
const deviceLines = devices.stdout.split("\n").filter((l) => l.includes("\tdevice"));
if (deviceLines.length === 0) {
  console.error(`\n[error] No Android device connected.`);
  console.error(`  - Connect Mate 60 via USB`);
  console.error(`  - Enable USB debugging in 设置 → 系统 → 开发者选项`);
  console.error(`  - Tap "始终允许" if prompted on phone`);
  process.exit(1);
}
console.log(`  found ${deviceLines.length} device(s): ${deviceLines[0].trim()}`);

// ---- Step 3: ssh trigger Ubuntu build ----
step(++stepNum, totalSteps, `ssh ${SSH_HOST} → ${REMOTE_BUILD_SCRIPT} ${branch}`);
console.log("  (vite build + cap sync + gradle assembleDebug + cp to ~/sync/)");
console.log("  (~30-90s incremental, 3-5min cold)");

// Snapshot mtime BEFORE the build so step 4 can detect "actually fresh"
// instead of trusting whatever stale .apk + .md5 pair was already in D:\sync
// from a previous run. Without this, a self-consistent old pair (matching
// md5 with each other but predating this build) was passing verification
// and adb install was loading the previous APK.
const initialApkMtime = existsSync(SYNC_APK_PATH) ? statSync(SYNC_APK_PATH).mtimeMs : 0;
const initialMd5Mtime = existsSync(SYNC_MD5_PATH) ? statSync(SYNC_MD5_PATH).mtimeMs : 0;

const buildStart = Date.now();
try {
  run(`ssh ${SSH_HOST} "bash ${REMOTE_BUILD_SCRIPT} ${branch}"`);
} catch (e) {
  console.error(`\n[error] Ubuntu build failed. SSH back into the server and inspect:`);
  console.error(`  ssh ${SSH_HOST}`);
  console.error(`  cd ~/ficforge && bash build-android-remote.sh ${branch}`);
  process.exit(1);
}
const buildSec = ((Date.now() - buildStart) / 1000).toFixed(1);
console.log(`  build done in ${buildSec}s`);

// ---- Step 4: wait for syncthing ----
step(++stepNum, totalSteps, "wait for syncthing to deliver APK + md5");

const expectedMd5Path = SYNC_MD5_PATH;
const apkPath = SYNC_APK_PATH;

const syncDeadline = Date.now() + SYNC_TIMEOUT_MS;
let synced = false;
let expectedMd5 = null;

while (Date.now() < syncDeadline) {
  if (existsSync(apkPath) && existsSync(expectedMd5Path)) {
    try {
      const apkStat = statSync(apkPath);
      const md5Stat = statSync(expectedMd5Path);
      // Freshness gate: both files must have been updated since this build
      // started, otherwise syncthing hasn't delivered new artifacts yet
      // and we're looking at the previous build's leftover pair (which is
      // self-consistent — md5 matches APK — but stale).
      if (apkStat.mtimeMs > initialApkMtime && md5Stat.mtimeMs > initialMd5Mtime) {
        // md5 file format: "<hash>  <filename>\n"
        const md5Content = readFileSync(expectedMd5Path, "utf8").trim();
        expectedMd5 = md5Content.split(/\s+/)[0].toLowerCase();
        const actualMd5 = fileMd5(apkPath);
        if (actualMd5 === expectedMd5) {
          console.log(`  md5 verified: ${actualMd5}`);
          synced = true;
          break;
        }
        // md5 mismatch — APK still being copied/written. Wait.
      }
      // mtime not advanced past the build trigger yet — still waiting on syncthing
    } catch (e) {
      // file lock / partial write — keep retrying
    }
  }
  process.stdout.write(".");
  await sleep(SYNC_POLL_INTERVAL_MS);
}

if (!synced) {
  console.error(`\n[error] syncthing didn't deliver matching APK within ${SYNC_TIMEOUT_MS / 1000}s`);
  console.error(`  Expected md5: ${expectedMd5}`);
  console.error(`  APK path:     ${apkPath}`);
  console.error(`  Check syncthing UI on Windows (任务栏图标) and Ubuntu (http://localhost:8384)`);
  process.exit(1);
}

// ---- Step 5: adb install + launch ----
step(++stepNum, totalSteps, "adb install -r + launch");
run(`"${ADB}" install -r "${apkPath}"`);
run(`"${ADB}" shell monkey -p ${APP_ID} -c android.intent.category.LAUNCHER 1`);

console.log(`\n[done] App installed and launched on Mate 60. Look at the screen.`);
