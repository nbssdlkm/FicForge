import { useEffect, useRef, useState } from 'react';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { FileUp } from 'lucide-react';
import { useTranslation } from '../../i18n/useAppTranslation';
import { exportChapters } from '../../api/importExport';

export const ExportModal = ({ isOpen, onClose, auPath }: { isOpen: boolean, onClose: () => void, auPath: string }) => {
  const { t } = useTranslation();
  const [format, setFormat] = useState<'md' | 'txt'>('md');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const { blob, filename } = await exportChapters({ au_path: auPath, format });
      if (abortRef.current) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onClose();
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
            <label className="flex items-center gap-2 text-sm cursor-pointer hover:opacity-80">
              <input type="radio" name="exportFmt" checked={format === 'md'} onChange={() => setFormat('md')} className="text-accent focus:ring-accent accent-accent w-4 h-4" />
              {t('export.markdown')}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer hover:opacity-80">
              <input type="radio" name="exportFmt" checked={format === 'txt'} onChange={() => setFormat('txt')} className="text-accent focus:ring-accent accent-accent w-4 h-4" />
              {t('export.text')}
            </label>
          </div>
          <p className="text-xs text-text/50">{t('export.description')}</p>
        </div>

        {error && (
          <div className="text-sm text-error bg-error/10 rounded-lg p-3">{error}</div>
        )}

        <Button variant="primary" className="w-full gap-2 shadow-md" onClick={handleExport} disabled={exporting}>
          <FileUp size={16}/> {exporting ? t('export.writing') : t('export.submit')}
        </Button>
      </div>
    </Modal>
  );
};
