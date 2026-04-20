// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useState } from 'react';
import { getChapterContent, getState, updateChapterContent, type StateInfo } from '../../api/engine-client';

type UseConfirmedChapterEditorOptions = {
  auPath: string;
  viewChapter?: number | null;
  state: StateInfo | null;
  fallbackContent: string;
  onClearViewChapter?: () => void;
  onStateChange: (state: StateInfo) => void;
  onDirtyBannerReset: () => void;
  onShowSuccess: (message: string) => void;
  onShowError: (error: unknown, fallback: string) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
};

export function useConfirmedChapterEditor({
  auPath,
  viewChapter,
  state,
  fallbackContent,
  onClearViewChapter,
  onStateChange,
  onDirtyBannerReset,
  onShowSuccess,
  onShowError,
  t,
}: UseConfirmedChapterEditorOptions) {
  const [viewingHistoryContent, setViewingHistoryContent] = useState<string | null>(null);
  const [viewingHistoryNum, setViewingHistoryNum] = useState<number | null>(null);
  const [editingConfirmed, setEditingConfirmed] = useState(false);
  const [editingContent, setEditingContent] = useState('');
  const [editingOriginalContent, setEditingOriginalContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    setEditingConfirmed(false);
    setEditingContent('');
    setEditingOriginalContent('');

    if (!viewChapter || !state) {
      setViewingHistoryContent(null);
      setViewingHistoryNum(null);
      return;
    }
    if (viewChapter >= state.current_chapter) {
      setViewingHistoryContent(null);
      setViewingHistoryNum(null);
      return;
    }

    let cancelled = false;
    getChapterContent(auPath, viewChapter).then((result: any) => {
      if (cancelled) return;
      const text = typeof result === 'string' ? result : result?.content || '';
      setViewingHistoryContent(text);
      setViewingHistoryNum(viewChapter);
    }).catch(() => {
      if (cancelled) return;
      setViewingHistoryContent(null);
      setViewingHistoryNum(null);
    });

    return () => {
      cancelled = true;
    };
  }, [viewChapter, auPath, state]);

  const clearHistoryView = () => {
    setViewingHistoryContent(null);
    setViewingHistoryNum(null);
    onClearViewChapter?.();
  };

  const startEditingConfirmed = () => {
    const sourceContent = viewingHistoryContent || fallbackContent;
    if (!sourceContent) return;
    setEditingOriginalContent(sourceContent);
    setEditingContent(sourceContent);
    setEditingConfirmed(true);
  };

  const cancelEditingConfirmed = () => {
    setEditingConfirmed(false);
    setEditingContent('');
    setEditingOriginalContent('');
  };

  const saveEditingConfirmed = async () => {
    if (!viewingHistoryNum || !state) return;
    setSavingEdit(true);
    try {
      await updateChapterContent(auPath, viewingHistoryNum, editingContent);
      const newState = await getState(auPath);
      onStateChange(newState);
      setViewingHistoryContent(editingContent);
      setEditingConfirmed(false);
      setEditingContent('');
      setEditingOriginalContent('');
      onDirtyBannerReset();
      onShowSuccess(t('writer.editSaveSuccess'));
    } catch (error) {
      onShowError(error, t('error_messages.unknown'));
    } finally {
      setSavingEdit(false);
    }
  };

  return {
    viewingHistoryContent,
    viewingHistoryNum,
    editingConfirmed,
    editingContent,
    editingOriginalContent,
    savingEdit,
    isViewingHistory: viewingHistoryContent !== null && viewingHistoryNum !== null,
    setEditingContent,
    clearHistoryView,
    startEditingConfirmed,
    cancelEditingConfirmed,
    saveEditingConfirmed,
  };
}
