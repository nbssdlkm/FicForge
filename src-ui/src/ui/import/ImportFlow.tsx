// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useRef } from 'react';
import { Modal } from '../shared/Modal';
import { FileSelectStep } from './FileSelectStep';
import { PreviewStep } from './PreviewStep';
import { CompletionStep } from './CompletionStep';
import { uploadImportFile, confirmImport, type ChapterPreview, type ImportConfirmResponse } from '../../api/engine-client';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';

export function ImportFlow({
  isOpen,
  onClose,
  auPath,
  onComplete,
}: {
  isOpen: boolean;
  onClose: () => void;
  auPath: string;
  onComplete: () => void;
}) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const flowRequestIdRef = useRef(0);
  const [step, setStep] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [completionBusy, setCompletionBusy] = useState(false);
  const [chapters, setChapters] = useState<ChapterPreview[]>([]);
  const [splitMethod, setSplitMethod] = useState('');
  const [fullChapters, setFullChapters] = useState<{ chapter_num: number; title: string; content: string }[]>([]);
  const [result, setResult] = useState<ImportConfirmResponse | null>(null);

  const resetFlowState = () => {
    flowRequestIdRef.current += 1;
    setStep(0);
    setUploading(false);
    setConfirming(false);
    setCompletionBusy(false);
    setChapters([]);
    setSplitMethod('');
    setFullChapters([]);
    setResult(null);
  };

  const handleFileSelected = async (file: File) => {
    const requestId = ++flowRequestIdRef.current;
    setUploading(true);
    try {
      const resp = await uploadImportFile(file);
      if (requestId !== flowRequestIdRef.current) return;
      setChapters(resp.chapters);
      setSplitMethod(resp.split_method);
      // 保存完整章节内容（upload 只返回 preview，confirm 需要完整内容）
      // 这里必须和 uploadImportFile 使用同一套文本归一化逻辑，
      // 否则预览切分和真正导入会不一致。
      const text = await readImportText(file);
      if (requestId !== flowRequestIdRef.current) return;
      const fullChs = buildFullChapters(text, resp.chapters);
      setFullChapters(fullChs);
      setStep(1);
    } catch (error) {
      if (requestId !== flowRequestIdRef.current) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (requestId === flowRequestIdRef.current) {
        setUploading(false);
      }
    }
  };

  const handleConfirm = async () => {
    const requestId = ++flowRequestIdRef.current;
    setConfirming(true);
    try {
      const resp = await confirmImport({
        au_path: auPath,
        chapters: fullChapters,
        split_method: splitMethod,
      });
      if (requestId !== flowRequestIdRef.current) return;
      setResult(resp);
      setStep(2);
    } catch (error) {
      if (requestId !== flowRequestIdRef.current) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (requestId === flowRequestIdRef.current) {
        setConfirming(false);
      }
    }
  };

  const handleStartWriting = () => {
    resetFlowState();
    onClose();
    onComplete();
  };

  const handleClose = () => {
    if (uploading || confirming || completionBusy) return;
    resetFlowState();
    onClose();
  };

  const handleBackToFileSelect = () => {
    if (confirming) return;
    flowRequestIdRef.current += 1;
    setConfirming(false);
    setStep(0);
  };

  const stepTitle = step === 0
    ? t('import.title')
    : step === 1
    ? t('import.previewTitle')
    : t('import.completionTitle');

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`${stepTitle}  ${step + 1}/3`}>
      {step === 0 && (
        <FileSelectStep onNext={handleFileSelected} uploading={uploading} />
      )}
      {step === 1 && (
        <PreviewStep
          chapters={chapters}
          splitMethod={splitMethod}
          onConfirm={handleConfirm}
          onBack={handleBackToFileSelect}
          confirming={confirming}
        />
      )}
      {step === 2 && result && (
        <CompletionStep
          auPath={auPath}
          totalChapters={result.total_chapters}
          charactersFound={result.characters_found}
          onStartWriting={handleStartWriting}
          onBusyChange={setCompletionBusy}
        />
      )}
    </Modal>
  );
}

async function readImportText(file: File): Promise<string> {
  const rawText = await file.text();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'html' || ext === 'htm') {
    const { parse_html } = await import('@ficforge/engine');
    return parse_html(rawText);
  }
  return rawText;
}

/**
 * 从归一化后的文本 + 预览切分结果构造完整章节内容。
 * upload 只返回 preview（前 100 字），confirm 需要完整内容。
 * 按章节标题在原文中定位并截取。处理重复标题和不匹配的情况。
 */
function buildFullChapters(
  text: string,
  previews: ChapterPreview[],
): { chapter_num: number; title: string; content: string }[] {
  if (previews.length === 0) return [];
  if (previews.length === 1) {
    return [{ chapter_num: 1, title: previews[0].title, content: text }];
  }

  // 找每章标题在原文中的位置（处理重复标题：从上一次匹配位置之后开始搜索）
  const positions: { idx: number; ch: ChapterPreview }[] = [];
  let searchFrom = 0;
  for (const ch of previews) {
    const idx = text.indexOf(ch.title, searchFrom);
    if (idx >= 0) {
      positions.push({ idx, ch });
      searchFrom = idx + ch.title.length;
    }
    // 标题找不到时跳过（不中断后续章节）
  }

  if (positions.length === 0) {
    // 所有标题都找不到 → 全文作为一章
    return [{ chapter_num: 1, title: previews[0].title, content: text }];
  }

  return positions.map((pos, i) => {
    const start = pos.idx;
    const end = i + 1 < positions.length ? positions[i + 1].idx : text.length;
    return {
      chapter_num: pos.ch.chapter_num,
      title: pos.ch.title,
      content: text.slice(start, end).trim(),
    };
  });
}
