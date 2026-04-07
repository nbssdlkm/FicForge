// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useRef, DragEvent } from 'react';
import { Button } from '../shared/Button';
import { Upload, FileText, Loader2 } from 'lucide-react';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';

const ACCEPTED = ['.txt', '.md', '.docx', '.html', '.htm'];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function FileSelectStep({
  onNext,
  uploading,
}: {
  onNext: (file: File) => void;
  uploading: boolean;
}) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    const ext = '.' + f.name.split('.').pop()?.toLowerCase();
    if (!ACCEPTED.includes(ext)) {
      showError(t('import.formatError'));
      return;
    }
    setFile(f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-text/60">{t('import.supportedFormats')}</p>

      <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
        <span className="shrink-0">⚠️</span>
        <span>{t('ethics.importWarning')}</span>
      </div>

      <div
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${dragOver ? 'border-accent bg-accent/5' : 'border-black/15 dark:border-white/15 hover:border-accent/50'}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <Upload size={32} className="mx-auto mb-3 text-text/30" />
        <p className="text-sm text-text/50">{t('import.dropzone')}</p>
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.md,.docx,.html,.htm"
          className="hidden"
          onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
        />
      </div>

      {file && (
        <div className="flex items-center gap-2 text-sm text-text/70 bg-surface/50 rounded-lg px-4 py-3 border border-black/5 dark:border-white/5">
          <FileText size={16} className="text-accent shrink-0" />
          <span>{t('import.selectedFile', { name: file.name, size: formatSize(file.size) })}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="primary" onClick={() => file && onNext(file)} disabled={!file || uploading}>
          {uploading ? <><Loader2 size={14} className="animate-spin mr-2" />{t('import.uploading')}</> : t('onboarding.common.next')}
        </Button>
      </div>
    </div>
  );
}
