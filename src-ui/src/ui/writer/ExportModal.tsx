// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useRef, useState } from 'react';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { FileUp } from 'lucide-react';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import { exportChapters, logCatch } from '../../api/engine-client';
import { isTauri, isCapacitor } from '../../utils/platform';

async function saveWithTauriDialog(blob: Blob, filename: string): Promise<'saved' | 'cancelled' | 'error'> {
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');

    const ext = filename.split('.').pop() || 'txt';
    const filePath = await save({
      defaultPath: filename,
      filters: [
        { name: ext === 'md' ? 'Markdown' : 'Text', extensions: [ext] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (!filePath) return 'cancelled';

    const arrayBuffer = await blob.arrayBuffer();
    await writeFile(filePath, new Uint8Array(arrayBuffer));
    return 'saved';
  } catch (e) {
    logCatch('export', 'Tauri save failed', e);
    return 'error';
  }
}

function saveWithBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const ExportModal = ({ isOpen, onClose, auPath }: { isOpen: boolean, onClose: () => void, auPath: string }) => {
  const { t, i18n } = useTranslation();
  const { showToast } = useFeedback();
  const [format, setFormat] = useState<'md' | 'txt'>('md');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiDisclosure, setAiDisclosure] = useState(true);
  const [pendingBrowserFallback, setPendingBrowserFallback] = useState<{ blob: Blob; filename: string } | null>(null);
  const abortRef = useRef(false);
  const browserFallbackLabel = i18n.resolvedLanguage === 'en' ? 'Download via browser' : '改用浏览器下载';

  useEffect(() => {
    if (!isOpen) {
      abortRef.current = true;
      setExporting(false);
      setError(null);
      setPendingBrowserFallback(null);
    } else {
      abortRef.current = false;
    }
  }, [isOpen]);

  const handleBrowserFallback = () => {
    if (!pendingBrowserFallback) return;
    try {
      saveWithBrowserDownload(pendingBrowserFallback.blob, pendingBrowserFallback.filename);
      setPendingBrowserFallback(null);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    setPendingBrowserFallback(null);
    abortRef.current = false;
    try {
      let { blob, filename } = await exportChapters({ au_path: auPath, format });
      if (abortRef.current) return;

      // Append AI disclosure if checked
      if (aiDisclosure) {
        const text = await blob.text();
        const disclaimer = t('ethics.exportDisclaimer');
        blob = new Blob([text + '\n\n---\n\n' + disclaimer + '\n'], { type: blob.type });
      }

      if (isTauri()) {
        const result = await saveWithTauriDialog(blob, filename);
        if (abortRef.current) return;
        if (result === 'saved') onClose();
        else if (result === 'error') {
          setError(t('export.saveFailed'));
          setPendingBrowserFallback({ blob, filename });
        }
      } else if (isCapacitor()) {
        // Capacitor mobile: prefer the platform share sheet when available.
        const file = new File([blob], filename, { type: blob.type });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          onClose();
        } else {
          // Fallback for mobile environments without share-sheet file support.
          const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
          const text = await blob.text();
          await Filesystem.writeFile({
            path: filename,
            data: text,
            directory: Directory.Documents,
            encoding: Encoding.UTF8,
            recursive: true,
          });
          showToast(t('export.savedToDocuments', { filename }), 'success');
          onClose();
        }
      } else {
        saveWithBrowserDownload(blob, filename);
        onClose();
      }
    } catch (e: unknown) {
      if (abortRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!abortRef.current) setExporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={exporting ? () => {} : onClose} title={t('export.title')}>
      <div className="space-y-6">
        <div className="mt-2 flex flex-col gap-3">
          <label className="text-sm font-bold text-text/90">{t('export.formatLabel')}</label>
          <div className="flex gap-6">
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm hover:opacity-80">
              <input type="radio" name="exportFmt" checked={format === 'md'} onChange={() => setFormat('md')} className="h-4 w-4 text-accent accent-accent focus:ring-accent" />
              {t('export.markdown')}
            </label>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm hover:opacity-80">
              <input type="radio" name="exportFmt" checked={format === 'txt'} onChange={() => setFormat('txt')} className="h-4 w-4 text-accent accent-accent focus:ring-accent" />
              {t('export.text')}
            </label>
          </div>
          <p className="text-xs text-text/50">{t('export.description')}</p>
        </div>

        {error && (
          <div className="rounded-lg bg-error/10 p-3 text-sm text-error">{error}</div>
        )}

        {pendingBrowserFallback && (
          <Button tone="neutral" fill="outline" className="w-full" onClick={handleBrowserFallback} disabled={exporting}>
            {browserFallbackLabel}
          </Button>
        )}

        <label className="flex min-h-[44px] cursor-pointer items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={aiDisclosure}
            onChange={e => {
              setAiDisclosure(e.target.checked);
              if (!e.target.checked) showToast(t('ethics.exportUncheckedWarning'), 'warning');
            }}
            className="mt-0.5 h-3.5 w-3.5 accent-accent"
          />
          <span className="text-text/70">{t('ethics.exportAiLabel')}</span>
        </label>

        <Button tone="accent" fill="solid" className="w-full gap-2 shadow-md" onClick={handleExport} disabled={exporting}>
          <FileUp size={16}/> {exporting ? t('export.writing') : t('export.submit')}
        </Button>
      </div>
    </Modal>
  );
};
