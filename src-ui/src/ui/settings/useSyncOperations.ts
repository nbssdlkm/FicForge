// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useRef, useCallback } from 'react';
import { updateSettings } from '../../api/engine-client';
import { syncAllAus, resolveFileConflict, testWebDAVConnection, type WebDAVConfig } from '../../api/engine-sync';
import { type ConflictItem } from '../shared/ConflictResolveModal';
import { useTranslation } from '../../i18n/useAppTranslation';

export function useSyncOperations(syncConfig: { url: string; username: string; password: string; remote_dir: string }) {
  const { t } = useTranslation();
  const requestIdRef = useRef(0);

  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncResultStatus, setSyncResultStatus] = useState<'idle' | 'success' | 'error' | 'conflicts'>('idle');
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [opsConflictDetails, setOpsConflictDetails] = useState<string[]>([]);
  const [syncTestStatus, setSyncTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  // 暂存非冲突错误，冲突解决后检查是否有残留
  const nonConflictErrorsRef = useRef<string[]>([]);

  // Map display path -> { auPath, filePath } for conflict resolution
  const conflictPathMapRef = useRef<Map<string, { auPath: string; filePath: string }>>(new Map());

  const handleTestWebDAV = useCallback(async () => {
    const reqId = ++requestIdRef.current;
    setSyncTestStatus('testing');
    try {
      const raw = syncConfig.url.trim();
      if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
        setSyncTestStatus('error');
        return;
      }
      const result = await testWebDAVConnection({
        url: raw,
        username: syncConfig.username,
        password: syncConfig.password,
        remote_dir: syncConfig.remote_dir,
      });
      if (reqId !== requestIdRef.current) return;
      setSyncTestStatus(result.success ? 'success' : 'error');
    } catch {
      if (reqId !== requestIdRef.current) return;
      setSyncTestStatus('error');
    }
  }, [syncConfig]);

  const handleSyncNow = useCallback(async (syncMode: 'none' | 'webdav', setLastSync: (val: string) => void) => {
    const syncRequestId = ++requestIdRef.current;
    setSyncing(true);
    setSyncMessage('');
    setSyncResultStatus('idle');
    try {
      const webdavConfig: WebDAVConfig = {
        url: syncConfig.url,
        username: syncConfig.username,
        password: syncConfig.password,
        remote_dir: syncConfig.remote_dir,
      };
      const result = await syncAllAus(webdavConfig);
      if (syncRequestId !== requestIdRef.current) return;
      // 暂存非冲突错误，供冲突解决后检查
      nonConflictErrorsRef.current = result.errors;
      // 格式化全部错误信息（不只第一条）
      const allErrorsMsg = result.errors.length > 0
        ? result.errors.length <= 3
          ? result.errors.join('; ')
          : `${result.errors.slice(0, 3).join('; ')} (+${result.errors.length - 3})`
        : '';
      if (result.fileConflicts.length > 0) {
        const map = new Map<string, { auPath: string; filePath: string }>();
        const items = result.fileConflicts.map(fc => {
          const displayPath = `${fc.auPath}/${fc.path}`;
          map.set(displayPath, { auPath: fc.auPath, filePath: fc.path });
          return { path: displayPath, localModified: fc.localModified, remoteModified: fc.remoteModified };
        });
        conflictPathMapRef.current = map;
        setConflicts(items);
        setConflictModalOpen(true);
        setSyncResultStatus('conflicts');
        // 冲突 + 错误并存时，两者都显示
        const msg = t('settings.sync.conflictsFound', { count: result.fileConflicts.length });
        setSyncMessage(allErrorsMsg ? `${msg} | ${allErrorsMsg}` : msg);
      } else if (result.errors.length > 0) {
        setSyncResultStatus('error');
        setSyncMessage(allErrorsMsg);
      } else if (result.opsConflicts && result.opsConflicts.length > 0) {
        setOpsConflictDetails(result.opsConflicts);
        setSyncResultStatus('conflicts');
        setSyncMessage(t('settings.sync.opsConflictsFound', { count: result.opsConflicts.length }));
      } else {
        // 完全成功——才更新 last_sync
        const now = new Date().toISOString();
        setLastSync(now);
        await updateSettings({
          sync: {
            mode: syncMode,
            webdav: { url: syncConfig.url, username: syncConfig.username, password: syncConfig.password, remote_dir: syncConfig.remote_dir },
            last_sync: now,
          },
        }).catch((err) => { console.warn('last_sync persist failed:', err); });
        setSyncResultStatus('success');
        setSyncMessage(t('settings.sync.syncSuccess'));
      }
    } catch (e: any) {
      if (syncRequestId !== requestIdRef.current) return;
      setSyncResultStatus('error');
      setSyncMessage(t('settings.sync.syncError', { message: e?.message || t('error_messages.unknown') }));
    } finally {
      if (syncRequestId === requestIdRef.current) {
        setSyncing(false);
      }
    }
  }, [syncConfig, t]);

  const handleResolveConflict = useCallback(async (path: string, choice: 'local' | 'remote') => {
    try {
      const webdavConfig: WebDAVConfig = { url: syncConfig.url, username: syncConfig.username, password: syncConfig.password, remote_dir: syncConfig.remote_dir };
      const entry = conflictPathMapRef.current.get(path);
      if (entry) {
        await resolveFileConflict(entry.auPath, entry.filePath, choice, webdavConfig);
      }
      // 函数式更新，避免快速连续点击时闭包过期
      let isEmpty = false;
      setConflicts(prev => {
        const remaining = prev.filter(c => c.path !== path);
        isEmpty = remaining.length === 0;
        return remaining;
      });
      if (isEmpty) {
        setConflictModalOpen(false);
        // 冲突全部解决后，检查是否有残留的非冲突错误
        if (nonConflictErrorsRef.current.length > 0) {
          setSyncResultStatus('error');
          const msgs = nonConflictErrorsRef.current;
          setSyncMessage(msgs.length <= 3 ? msgs.join('; ') : `${msgs.slice(0, 3).join('; ')} (+${msgs.length - 3})`);
        } else {
          setSyncResultStatus('success');
          setSyncMessage(t('settings.sync.syncSuccess'));
        }
      }
    } catch (e: any) {
      setSyncResultStatus('error');
      setSyncMessage(t('settings.sync.syncError', { message: e?.message || '' }));
    }
  }, [syncConfig, t]);

  const handleResolveAllConflicts = useCallback(async (choice: 'local' | 'remote') => {
    const webdavConfig: WebDAVConfig = { url: syncConfig.url, username: syncConfig.username, password: syncConfig.password, remote_dir: syncConfig.remote_dir };
    // 逐个解决，每成功一个就移除，避免部分失败后状态不一致
    const snapshot = [...conflicts];
    let lastError: string | null = null;
    for (const c of snapshot) {
      try {
        const entry = conflictPathMapRef.current.get(c.path);
        if (entry) {
          await resolveFileConflict(entry.auPath, entry.filePath, choice, webdavConfig);
        }
        setConflicts(prev => prev.filter(item => item.path !== c.path));
      } catch (e: any) {
        lastError = e?.message || '';
      }
    }
    if (lastError) {
      setSyncResultStatus('error');
      setSyncMessage(t('settings.sync.syncError', { message: lastError }));
    } else {
      setConflictModalOpen(false);
      // 冲突全部解决后，检查是否有残留的非冲突错误
      if (nonConflictErrorsRef.current.length > 0) {
        setSyncResultStatus('error');
        const msgs = nonConflictErrorsRef.current;
        setSyncMessage(msgs.length <= 3 ? msgs.join('; ') : `${msgs.slice(0, 3).join('; ')} (+${msgs.length - 3})`);
      } else {
        setSyncResultStatus('success');
        setSyncMessage(t('settings.sync.syncSuccess'));
      }
    }
  }, [conflicts, syncConfig, t]);

  const resetSyncState = useCallback(() => {
    setSyncing(false);
    setSyncMessage('');
    setSyncResultStatus('idle');
    setConflicts([]);
    setConflictModalOpen(false);
    setOpsConflictDetails([]);
    setSyncTestStatus('idle');
    nonConflictErrorsRef.current = [];
  }, []);

  return {
    // state
    syncing,
    syncMessage,
    syncResultStatus,
    conflicts,
    conflictModalOpen,
    setConflictModalOpen,
    opsConflictDetails,
    syncTestStatus,
    setSyncTestStatus,

    // handlers
    handleTestWebDAV,
    handleSyncNow,
    handleResolveConflict,
    handleResolveAllConflicts,
    resetSyncState,
  };
}
