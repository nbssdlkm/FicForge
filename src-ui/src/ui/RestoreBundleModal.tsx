// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TD-015：从完整备份（.ffbundle.json）或原始 AU 文件夹恢复一篇文（含进度/事实/
 * 线索/聊天）。会**新建**一篇文，不动现有内容；RAG 检索索引不在备份内，恢复后下次
 * 打开时重建。主要用于简版 fork → 主 app 的数据迁回。
 */

import { useRef, useState } from 'react';
import { Archive, Upload } from 'lucide-react';
import { Modal } from './shared/Modal';
import { Button } from './shared/Button';
import { Input } from './shared/Input';
import { Spinner } from './shared/Spinner';
import { useTranslation } from '../i18n/useAppTranslation';
import { useFeedback } from '../hooks/useFeedback';
import { bundleFromRawFiles, logCatch, parseAuBundle, restoreAuBundle } from '../api/engine-client';
import { isCapacitor } from '../utils/platform';
import type { AuBundle } from '@ficforge/engine';

/** 一个 bundle 是否长得像 AU 根（有 project.yaml/state.yaml 或至少一章），用于挡住「选错上层文件夹」。 */
function looksLikeAuRoot(bundle: AuBundle): boolean {
  return Boolean(bundle.files['project.yaml'] || bundle.files['state.yaml']) || bundle.manifest.chapter_count > 0;
}

interface FandomLite {
  name: string;
  dir_name: string;
}

export function RestoreBundleModal({
  isOpen,
  onClose,
  fandoms,
  dataDir,
  onComplete,
}: {
  isOpen: boolean;
  onClose: () => void;
  fandoms: FandomLite[];
  dataDir: string;
  onComplete: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { showToast } = useFeedback();
  const [bundle, setBundle] = useState<AuBundle | null>(null);
  const [auName, setAuName] = useState('');
  const [fandomDir, setFandomDir] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rawRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setBundle(null);
    setAuName('');
    setError(null);
  };

  const close = () => {
    if (restoring) return;
    reset();
    onClose();
  };

  const onPickBundle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    try {
      const parsed = parseAuBundle(await file.text());
      setBundle(parsed);
      setAuName(parsed.manifest.au_name || file.name.replace(/\.ffbundle\.json$/i, '').replace(/\.json$/i, ''));
      setError(null);
    } catch (err) {
      setBundle(null);
      setError(t('restoreBundle.badFile', { message: err instanceof Error ? err.message : String(err) }));
    }
  };

  const onPickRaw = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (rawRef.current) rawRef.current.value = '';
    if (files.length === 0) return;
    try {
      const collected = await Promise.all(
        files.map(async (f) => {
          // 选文件夹时 webkitRelativePath = "选中目录/chapters/main/ch0001.md"，剥掉首段得 AU 内相对路径。
          const wrp = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
          const relpath = wrp ? wrp.split('/').slice(1).join('/') : f.name;
          return { relpath, content: await f.text() };
        }),
      );
      const built = bundleFromRawFiles(collected.filter((c) => c.relpath));
      if (built.manifest.file_count === 0) {
        setBundle(null);
        setError(t('restoreBundle.badFile', { message: 'empty' }));
        return;
      }
      // 挡住「选了 aus/ 或合集这种上层文件夹」——slice(1) 只剥一层会得到 au1/chapters/... 的歪结构。
      if (!looksLikeAuRoot(built)) {
        setBundle(null);
        setError(t('restoreBundle.notAuRoot'));
        return;
      }
      setBundle(built);
      setError(null);
    } catch (err) {
      setError(t('restoreBundle.badFile', { message: err instanceof Error ? err.message : String(err) }));
    }
  };

  const handleRestore = async () => {
    if (!bundle) return;
    const fandom = fandoms.find((f) => f.dir_name === fandomDir);
    if (!fandom) {
      setError(t('restoreBundle.noFandom'));
      return;
    }
    if (!auName.trim()) {
      setError(t('restoreBundle.nameRequired'));
      return;
    }
    setRestoring(true);
    setError(null);
    try {
      const fandomPath = `${dataDir}/fandoms/${fandom.dir_name}`;
      const result = await restoreAuBundle(fandom.name, fandomPath, auName.trim(), bundle);
      // 有文件被跳过 = 部分恢复，必须告警而非报「成功」，否则用户可能据此删掉唯一的原始备份。
      if (result.skipped.length > 0) {
        showToast(t('restoreBundle.partialWarning', { count: result.skipped.length }), 'warning');
      } else {
        showToast(t('restoreBundle.success', { name: auName.trim(), chapters: result.chapterCount }), 'success');
      }
      reset();
      await onComplete();
      onClose();
    } catch (err) {
      logCatch('restore-bundle', 'restore failed', err);
      // createAu 的「已存在」是裸英文引擎串，映射成可读的本地化提示让用户改名。
      const msg = err instanceof Error ? err.message : String(err);
      setError(/already exists/i.test(msg) ? t('restoreBundle.nameExists') : msg);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title={t('restoreBundle.title')}>
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-text/70">{t('restoreBundle.description')}</p>

        <div className="flex flex-col gap-2">
          <input ref={fileRef} type="file" accept=".json,application/json" onChange={onPickBundle} className="hidden" />
          <Button tone="neutral" fill="outline" className="w-full gap-2" onClick={() => fileRef.current?.click()} disabled={restoring}>
            <Upload size={16} /> {t('restoreBundle.pickFile')}
          </Button>
          {/* 选文件夹依赖 webkitdirectory —— 桌面/Web 可用，Capacitor 手机端不支持，
              在那会静默回退成单文件选择、丢掉目录结构。手机端直接隐藏，提示改用 bundle 文件。 */}
          {isCapacitor() ? (
            <p className="self-start text-xs text-text/40">{t('restoreBundle.rawDesktopOnly')}</p>
          ) : (
            <>
              <input
                ref={(el) => {
                  if (el) el.setAttribute('webkitdirectory', '');
                  rawRef.current = el;
                }}
                type="file"
                multiple
                onChange={onPickRaw}
                className="hidden"
              />
              <button
                type="button"
                className="self-start text-xs text-text/50 underline hover:text-text/80 disabled:opacity-50"
                onClick={() => rawRef.current?.click()}
                disabled={restoring}
              >
                {t('restoreBundle.pickRaw')}
              </button>
            </>
          )}
        </div>

        {bundle && (
          <div className="space-y-3 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm">
            <div className="flex items-center gap-2 text-text/80">
              <Archive size={16} />
              <span>{t('restoreBundle.summary', { chapters: bundle.manifest.chapter_count, files: bundle.manifest.file_count })}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-text/90">{t('restoreBundle.fandomLabel')}</label>
              <select
                value={fandomDir}
                onChange={(e) => setFandomDir(e.target.value)}
                className="h-10 rounded-md border border-black/10 bg-surface/50 px-2 text-sm dark:border-white/10"
                disabled={restoring}
              >
                <option value="">—</option>
                {fandoms.map((f) => (
                  <option key={f.dir_name} value={f.dir_name}>{f.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-text/90">{t('restoreBundle.nameLabel')}</label>
              <Input value={auName} onChange={(e) => setAuName(e.target.value)} disabled={restoring} className="bg-surface/50" />
            </div>
          </div>
        )}

        {error && <div className="rounded-lg bg-error/10 p-3 text-sm text-error">{error}</div>}

        <Button tone="accent" fill="solid" className="w-full gap-2" onClick={handleRestore} disabled={restoring || !bundle}>
          {restoring ? <Spinner size="md" /> : t('restoreBundle.submit')}
        </Button>
      </div>
    </Modal>
  );
}
