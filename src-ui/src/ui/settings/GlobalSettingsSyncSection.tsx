// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState } from 'react';
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from '../../i18n/useAppTranslation';
import type { useSyncOperations } from './useSyncOperations';

export type GlobalSettingsSyncSectionProps = {
  syncMode: 'none' | 'webdav';
  setSyncMode: (mode: 'none' | 'webdav') => void;
  syncUrl: string;
  setSyncUrl: (url: string) => void;
  syncUsername: string;
  setSyncUsername: (username: string) => void;
  syncPassword: string;
  setSyncPassword: (password: string) => void;
  syncRemoteDir: string;
  setSyncRemoteDir: (dir: string) => void;
  lastSync: string | null;
  setLastSync: (v: string | null) => void;
  syncOps: ReturnType<typeof useSyncOperations>;
};

export function GlobalSettingsSyncSection({
  syncMode,
  setSyncMode,
  syncUrl,
  setSyncUrl,
  syncUsername,
  setSyncUsername,
  syncPassword,
  setSyncPassword,
  syncRemoteDir,
  setSyncRemoteDir,
  lastSync,
  setLastSync,
  syncOps,
}: GlobalSettingsSyncSectionProps) {
  const { t } = useTranslation();
  const [syncHelpOpen, setSyncHelpOpen] = useState(false);

  const {
    syncing, syncMessage, syncResultStatus, opsConflictDetails,
    syncTestStatus, setSyncTestStatus,
    handleTestWebDAV, handleSyncNow,
  } = syncOps;

  return (
    <div className="space-y-4 border-t border-black/10 pt-5 dark:border-white/10">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text/90">{t('settings.sync.title')}</h3>
        <Button tone="neutral" fill="plain" size="sm" className="text-xs text-accent" onClick={() => setSyncHelpOpen(!syncHelpOpen)}>
          {syncHelpOpen ? t('common.actions.close') : t('settings.sync.helpButton')}
        </Button>
      </div>

      {syncHelpOpen && (
        <div className="rounded-xl border border-info/20 bg-info/5 p-4 text-sm text-text/90 space-y-3">
          <p className="font-medium text-text/90">{t('settings.sync.help.intro')}</p>
          <div>
            <p className="font-medium">{t('settings.sync.help.option1Title')}</p>
            <p className="text-xs text-text/70 mt-1">{t('settings.sync.help.option1Desc')}</p>
          </div>
          <div>
            <p className="font-medium">{t('settings.sync.help.option2Title')}</p>
            <p className="text-xs text-text/70 mt-1">{t('settings.sync.help.option2Desc')}</p>
          </div>
          <div className="rounded-lg bg-background/60 p-3 text-xs space-y-1">
            <p className="font-medium text-text/70">{t('settings.sync.help.stepsTitle')}</p>
            <p>{t('settings.sync.help.step1')}</p>
            <p>{t('settings.sync.help.step2')}</p>
            <p>{t('settings.sync.help.step3')}</p>
            <p>{t('settings.sync.help.step4')}</p>
          </div>
          <div className="text-xs text-text/50 space-y-1">
            <p>{t('settings.sync.help.syncScope')}</p>
            <p>{t('settings.sync.help.notSynced')}</p>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text/90">{t('settings.sync.modeLabel')}</label>
        <select
          value={syncMode}
          onChange={(e) => { setSyncMode(e.target.value as 'none' | 'webdav'); setSyncTestStatus('idle'); }}
          className="h-11 w-full rounded-md border border-black/20 bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent dark:border-white/20 md:h-10 md:w-48 md:text-sm"
        >
          <option value="none">{t('settings.sync.modeNone')}</option>
          <option value="webdav">WebDAV</option>
        </select>
      </div>

      {syncMode === 'webdav' && (
        <div className="space-y-3 rounded-xl border border-black/10 bg-surface/30 p-4 dark:border-white/10">
          <Input label={t('settings.sync.serverUrl')} value={syncUrl} onChange={(e) => setSyncUrl(e.target.value)} placeholder="https://dav.jianguoyun.com/dav/" />
          <Input label={t('settings.sync.username')} value={syncUsername} onChange={(e) => setSyncUsername(e.target.value)} />
          <Input label={t('settings.sync.password')} type="password" value={syncPassword} onChange={(e) => setSyncPassword(e.target.value)} />
          <Input label={t('settings.sync.remoteDir')} value={syncRemoteDir} onChange={(e) => setSyncRemoteDir(e.target.value)} placeholder="/FicForge/" />
          <div className="flex items-center gap-3">
            <Button
              tone="neutral" fill="outline"
              size="sm"
              onClick={handleTestWebDAV}
              disabled={!syncUrl.trim() || !syncUsername.trim() || syncTestStatus === 'testing'}
            >
              {syncTestStatus === 'testing' ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
              {t('settings.sync.testConnection')}
            </Button>
            {syncTestStatus === 'success' && <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 size={14} /> {t('settings.sync.connected')}</span>}
            {syncTestStatus === 'error' && <span className="flex items-center gap-1 text-xs text-error"><XCircle size={14} /> {t('settings.sync.failed')}</span>}
          </div>
          {lastSync && (
            <p className="text-xs text-text/50">{t('settings.sync.lastSync')}: {new Date(lastSync).toLocaleString()}</p>
          )}
          <Button
            tone="accent" fill="solid"
            size="sm"
            className="w-full"
            onClick={() => handleSyncNow(syncMode, setLastSync)}
            disabled={syncTestStatus !== 'success' || syncing}
          >
            {syncing ? <><Loader2 size={14} className="mr-1 animate-spin" />{t('settings.sync.syncing')}</> : t('settings.sync.syncNow')}
          </Button>
          {syncMessage && (
            <p className={`text-xs mt-2 ${syncResultStatus === 'success' ? 'text-success' : syncResultStatus === 'error' ? 'text-error' : 'text-text/70'}`}>
              {syncMessage}
            </p>
          )}
          {opsConflictDetails.length > 0 && (
            <div className="mt-2 space-y-1">
              {opsConflictDetails.map((detail, i) => (
                <div key={i} className="text-xs text-text/50">
                  {detail}
                </div>
              ))}
              <p className="text-xs text-text/50 mt-1">{t('settings.sync.opsConflictsMergedHint')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
