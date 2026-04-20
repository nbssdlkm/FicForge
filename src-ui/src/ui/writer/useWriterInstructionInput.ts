// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useRef, useState } from 'react';
import { readSavedInstructionText, saveInstructionText } from '../../utils/writerStorage';

type UseWriterInstructionInputOptions = {
  auPath: string;
  currentChapterNum: number;
};

export function useWriterInstructionInput({
  auPath,
  currentChapterNum,
}: UseWriterInstructionInputOptions) {
  const [instructionText, setInstructionText] = useState('');
  const instructionInputRef = useRef<HTMLInputElement | null>(null);
  const instructionSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 自主 watch auPath + currentChapterNum：0 或切 AU → 清空；有章节 → 从 storage 读。
  // 原来这段由 bootstrap.loadData 通过 bridge 反调 loadInstructionFromStorage，
  // 现改为 hook 自己响应，消除 instructionInputBridgeRef。
  useEffect(() => {
    if (!currentChapterNum) {
      setInstructionText('');
      return;
    }
    setInstructionText(readSavedInstructionText(auPath, currentChapterNum));
  }, [auPath, currentChapterNum]);

  useEffect(() => {
    if (!currentChapterNum) return;
    if (instructionSaveRef.current) {
      clearTimeout(instructionSaveRef.current);
    }
    instructionSaveRef.current = setTimeout(() => {
      saveInstructionText(auPath, currentChapterNum, instructionText);
      instructionSaveRef.current = null;
    }, 500);

    return () => {
      if (instructionSaveRef.current) {
        clearTimeout(instructionSaveRef.current);
        instructionSaveRef.current = null;
        saveInstructionText(auPath, currentChapterNum, instructionText);
      }
    };
  }, [instructionText, auPath, currentChapterNum]);

  const focusInstructionInput = useCallback(() => {
    window.setTimeout(() => {
      instructionInputRef.current?.focus();
    }, 0);
  }, []);

  return {
    instructionText,
    setInstructionText,
    instructionInputRef,
    focusInstructionInput,
  };
}
