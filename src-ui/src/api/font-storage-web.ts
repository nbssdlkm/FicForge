// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Web 平台字体二进制存储。
 * 使用独立 IndexedDB 数据库，不碰已有的 ficforge_fs。
 */

const FONT_DB_NAME = 'ficforge_fonts';
const FONT_STORE = 'blobs';
const FONT_DB_VERSION = 1;

function openFontDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FONT_DB_NAME, FONT_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FONT_STORE)) {
        db.createObjectStore(FONT_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeFontBlob(key: string, data: ArrayBuffer): Promise<void> {
  const db = await openFontDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FONT_STORE, 'readwrite');
    tx.objectStore(FONT_STORE).put(data, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getFontBlob(key: string): Promise<ArrayBuffer | null> {
  const db = await openFontDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FONT_STORE, 'readonly');
    const req = tx.objectStore(FONT_STORE).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function deleteFontBlob(key: string): Promise<void> {
  const db = await openFontDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FONT_STORE, 'readwrite');
    tx.objectStore(FONT_STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
