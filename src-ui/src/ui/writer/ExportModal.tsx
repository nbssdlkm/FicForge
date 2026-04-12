// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useRef, useState } from 'react';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { FileUp } from 'lucide-react';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';
import { exportChapters } from '../../api/engine-client';

/** Tauri 环境检测：window.__TAURI_INTERNALS__ 存在则为 Tauri 打包环境 */
const isTauri = () => typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

/** Capacitor 原生环境检测 */
const isCapacitor = () => typeof (window as any).Capacitor !== 'undefined'
  && (window as any).Capacitor.isNativePlatform?.();

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
    console.error('[Export] Tauri save failed:', e);
    // Fallback: 尝试浏览器下载
    try {
      saveWithBrowserDownload(blob, filename);
      return 'saved';
    } catch {
      return 'error';
    }
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
  const { t } = useTranslation();
  const { showToast } = useFeedback();
  const [format, setFormat] = useState<'md' | 'txt'>('md');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiDisclosure, setAiDisclosure] = useState(true);
  const abortRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      abortRef.current = true;
      setExporting(false);
      setError(null);
    } else {
      abortRef.current = false;
    }
  }, [isOpen]);

  const handleExport = async () => {
    setExporting(true);
    setError(null);
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
        else if (result === 'error') setError(t('export.saveFailed'));
        // 'cancelled': 用户取消对话框，不关闭 modal
      } else if (isCapacitor()) {
        // Capacitor 移动端：使用 Web Share API 分享文件
        const file = new File([blob], filename, { type: blob.type });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          onClose();
        } else {
          // Share API 不可用时写入 Documents 目录
          const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
          const text = await blob.text();
          await Filesystem.writeFile({
            path: filename,
            data: text,
            directory: Directory.Documents,
            encoding: Encoding.UTF8,
            recursive: true,
          });
          showToast(t('export.savedToDocuments'), 'success');
          onClose();
        }
      } else {
        // PWA / 浏览器：浏览器下载
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
        <div className="flex flex-col gap-3 mt-2">
          <label className="text-sm font-bold text-text/90">{t('export.formatLabel')}</label>
          <div className="flex gap-6">
            <label className="flex min-h-[44px] items-center gap-2 text-sm cursor-pointer hover:opacity-80">
              <input type="radio" name="exportFmt" checked={format === 'md'} onChange={() => setFormat('md')} className="text-accent focus:ring-accent accent-accent w-4 h-4" />
              {t('export.markdown')}
            </label>
            <label className="flex min-h-[44px] items-center gap-2 text-sm cursor-pointer hover:opacity-80">
              <input type="radio" name="exportFmt" checked={format === 'txt'} onChange={() => setFormat('txt')} className="text-accent focus:ring-accent accent-accent w-4 h-4" />
              {t('export.text')}
            </label>
          </div>
          <p className="text-xs text-text/50">{t('export.description')}</p>
        </div>

        {error && (
          <div className="text-sm text-error bg-error/10 rounded-lg p-3">{error}</div>
        )}

        <label className="flex min-h-[44px] items-start gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={aiDisclosure}
            onChange={e => {
              setAiDisclosure(e.target.checked);
              if (!e.target.checked) showToast(t('ethics.exportUncheckedWarning'), 'warning');
            }}
            className="mt-0.5 accent-accent w-3.5 h-3.5"
          />
          <span className="text-text/60">{t('ethics.exportAiLabel')}</span>
        </label>

        <Button variant="primary" className="w-full gap-2 shadow-md" onClick={handleExport} disabled={exporting}>
          <FileUp size={16}/> {exporting ? t('export.writing') : t('export.submit')}
        </Button>
      </div>
    </Modal>
  );
};
