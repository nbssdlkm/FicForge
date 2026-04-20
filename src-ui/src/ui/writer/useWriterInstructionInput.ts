// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useRef } from 'react';
import { saveInstructionText } from '../../utils/writerStorage';

type UseWriterInstructionInputOptions = {
  auPath: string;
  currentChapterNum: number;
  instructionText: string;
};

export function useWriterInstructionInput({
  auPath,
  currentChapterNum,
  instructionText,
}: UseWriterInstructionInputOptions) {
  const instructionInputRef = useRef<HTMLInputElement | null>(null);
  const instructionSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    instructionInputRef,
    focusInstructionInput,
  };
}
