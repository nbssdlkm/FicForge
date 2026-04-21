// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 字体管理器 — 下载、缓存、@font-face 注入。
 * 跨平台支持 Tauri / Capacitor / Web。
 */

import { isTauri, isCapacitor } from '../utils/platform';
import { FONT_MANIFEST, SYSTEM_FONTS, type FontManifestEntry } from '../config/font-manifest';
import { getEngine, isEngineReady } from './engine-client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FONTS_SUBDIR = 'fonts';
const DOWNLOADED_KV_KEY = 'ficforge.fonts.downloaded';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FontDownloadStatus = 'not-downloaded' | 'downloading' | 'downloaded' | 'error';

/** fontId -> version */
export type DownloadedFontsMap = Record<string, string>;

// Track blob URLs to revoke on cleanup (Web platform)
const _blobUrls: string[] = [];

// ---------------------------------------------------------------------------
// Platform fetch (reuses pattern from engine-sync.ts)
// ---------------------------------------------------------------------------

async function getPlatformFetch(): Promise<typeof fetch> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch;
  }
  return globalThis.fetch.bind(globalThis);
}

// ---------------------------------------------------------------------------
// Downloaded fonts KV tracking
// ---------------------------------------------------------------------------

export async function get_downloaded_fonts(): Promise<DownloadedFontsMap> {
  if (!isEngineReady()) return {};
  try {
    const raw = await getEngine().adapter.kvGet(DOWNLOADED_KV_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function set_downloaded_fonts(map: DownloadedFontsMap): Promise<void> {
  if (!isEngineReady()) return;
  await getEngine().adapter.kvSet(DOWNLOADED_KV_KEY, JSON.stringify(map));
}

// ---------------------------------------------------------------------------
// Platform-specific binary write
// ---------------------------------------------------------------------------

async function write_font_binary_tauri(fontId: string, filename: string, data: Uint8Array): Promise<void> {
  const { appDataDir } = await import("@tauri-apps/api/path");
  const { writeFile, mkdir, exists } = await import("@tauri-apps/plugin-fs");
  const base = await appDataDir();
  const dir = `${base}${FONTS_SUBDIR}/${fontId}`;
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(`${dir}/${filename}`, data);
}

async function write_font_binary_capacitor(fontId: string, filename: string, data: Uint8Array): Promise<void> {
  const { Filesystem, Directory, Encoding: _Encoding } = await import("@capacitor/filesystem");
  const dir = `${FONTS_SUBDIR}/${fontId}`;
  try { await Filesystem.mkdir({ path: dir, directory: Directory.Data, recursive: true }); } catch { /* may exist */ }
  // Capacitor binary write needs base64
  const base64 = arrayBufferToBase64(data.buffer);
  await Filesystem.writeFile({ path: `${dir}/${filename}`, data: base64, directory: Directory.Data });
}

async function write_font_binary_web(fontId: string, filename: string, data: Uint8Array): Promise<void> {
  const { storeFontBlob } = await import("./font-storage-web");
  await storeFontBlob(`${fontId}/${filename}`, data.buffer);
}

async function write_font_binary(fontId: string, filename: string, data: Uint8Array): Promise<void> {
  if (isTauri()) return write_font_binary_tauri(fontId, filename, data);
  if (isCapacitor()) return write_font_binary_capacitor(fontId, filename, data);
  return write_font_binary_web(fontId, filename, data);
}

// ---------------------------------------------------------------------------
// Platform-specific local font URL (for @font-face src)
// ---------------------------------------------------------------------------

async function get_local_font_url_tauri(fontId: string, filename: string): Promise<string> {
  const { appDataDir } = await import("@tauri-apps/api/path");
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  const base = await appDataDir();
  return convertFileSrc(`${base}${FONTS_SUBDIR}/${fontId}/${filename}`);
}

async function get_local_font_url_capacitor(fontId: string, filename: string): Promise<string> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { uri } = await Filesystem.getUri({ path: `${FONTS_SUBDIR}/${fontId}/${filename}`, directory: Directory.Data });
  // Capacitor.convertFileSrc converts file:// to WebView-accessible URL
  const win = window as unknown as { Capacitor?: { convertFileSrc?: (src: string) => string } };
  return win.Capacitor?.convertFileSrc?.(uri) ?? uri;
}

async function get_local_font_url_web(fontId: string, filename: string): Promise<string> {
  const { getFontBlob } = await import("./font-storage-web");
  const buf = await getFontBlob(`${fontId}/${filename}`);
  if (!buf) throw new Error(`Font blob not found: ${fontId}/${filename}`);
  const url = URL.createObjectURL(new Blob([buf], { type: 'font/woff2' }));
  _blobUrls.push(url);
  return url;
}

async function get_local_font_url(fontId: string, filename: string): Promise<string> {
  if (isTauri()) return get_local_font_url_tauri(fontId, filename);
  if (isCapacitor()) return get_local_font_url_capacitor(fontId, filename);
  return get_local_font_url_web(fontId, filename);
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export async function download_font(
  entry: FontManifestEntry,
  onProgress?: (weightsDone: number, weightsTotal: number) => void,
): Promise<void> {
  const fetchFn = await getPlatformFetch();
  const total = entry.weights.length;
  let done = 0;

  for (const weight of entry.weights) {
    const filename = entry.files[weight];
    if (!filename) throw new Error(`Missing file for weight ${weight} in ${entry.id}`);
    const url = `${entry.baseUrl}/${filename}`;
    const resp = await fetchFn(url);
    if (!resp.ok) throw new Error(`Failed to download ${url}: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    await write_font_binary(entry.id, filename, new Uint8Array(buf));
    done++;
    onProgress?.(done, total);
  }

  // Update KV tracking
  const map = await get_downloaded_fonts();
  map[entry.id] = entry.version;
  await set_downloaded_fonts(map);
}

// ---------------------------------------------------------------------------
// @font-face injection
// ---------------------------------------------------------------------------

export async function inject_font_face(entry: FontManifestEntry): Promise<void> {
  remove_font_face(entry.id);

  let css = '';
  for (const weight of entry.weights) {
    const filename = entry.files[weight];
    const url = await get_local_font_url(entry.id, filename);
    css += `@font-face {
  font-family: 'FicForge-${entry.id}';
  font-weight: ${weight};
  font-style: normal;
  font-display: swap;
  src: url('${url}') format('woff2');
}\n`;
  }

  const style = document.createElement('style');
  style.id = `ficforge-font-${entry.id}`;
  style.textContent = css;
  document.head.appendChild(style);
}

export function remove_font_face(fontId: string): void {
  const existing = document.getElementById(`ficforge-font-${fontId}`);
  if (existing) existing.remove();
  // Revoke blob URLs to free memory (Web platform)
  for (const url of _blobUrls) {
    URL.revokeObjectURL(url);
  }
  _blobUrls.length = 0;
}

// ---------------------------------------------------------------------------
// CSS family string
// ---------------------------------------------------------------------------

/**
 * Returns a CSS font-family value for the given font ID.
 * System fonts return their configured stack.
 * Downloaded fonts return 'FicForge-{id}' + fallbacks.
 */
export function get_font_css_family(fontId: string): string {
  const sys = SYSTEM_FONTS.find(f => f.id === fontId);
  if (sys) return sys.stack;

  const entry = FONT_MANIFEST.find(f => f.id === fontId);
  if (entry) {
    return [`'FicForge-${entry.id}'`, ...entry.fallback].join(', ');
  }

  // Unknown font, fall back to system serif
  return SYSTEM_FONTS[0]?.stack ?? 'serif';
}

// ---------------------------------------------------------------------------
// Initialization (call once on app start)
// ---------------------------------------------------------------------------

export async function init_active_font(fontId: string): Promise<void> {
  // System fonts need no injection
  if (SYSTEM_FONTS.some(f => f.id === fontId)) return;

  const entry = FONT_MANIFEST.find(f => f.id === fontId);
  if (!entry) return;

  const downloaded = await get_downloaded_fonts();
  if (!downloaded[entry.id]) return;

  await inject_font_face(entry);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Process in chunks to avoid call stack overflow
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
