// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState } from 'react';
import { createAu } from '../../api/engine-client';

export type ImportSelectedFandom = { name: string; dir: string } | null;

type UseLibraryImportFlowOptions = {
  dataDir: string;
  loadFandoms: () => Promise<void>;
  onNavigate: (page: string, auPath?: string) => void;
  onError: (error: unknown) => void;
  onOpenFandomModal: () => void;
};

export function useLibraryImportFlow({
  dataDir,
  loadFandoms,
  onNavigate,
  onError,
  onOpenFandomModal,
}: UseLibraryImportFlowOptions) {
  const [isImportModalOpen, setImportModalOpen] = useState(false);
  const [resumeImportAfterFandomCreate, setResumeImportAfterFandomCreate] = useState(false);
  const [importAuPath, setImportAuPath] = useState('');
  const [importNewAuName, setImportNewAuName] = useState('');
  const [importSelectedFandom, setImportSelectedFandom] = useState<ImportSelectedFandom>(null);
  const [importCreatingAu, setImportCreatingAu] = useState(false);

  const resetImportSelection = () => {
    setImportAuPath('');
    setImportSelectedFandom(null);
    setImportNewAuName('');
  };

  const openImportPicker = () => {
    resetImportSelection();
    setImportModalOpen(true);
  };

  const closeImportFlow = () => {
    setImportModalOpen(false);
    resetImportSelection();
  };

  const requestCreateFandomFromImport = () => {
    setResumeImportAfterFandomCreate(true);
    closeImportFlow();
    onOpenFandomModal();
  };

  const cancelPendingImportResume = () => {
    setResumeImportAfterFandomCreate(false);
  };

  const handleCreatedFandom = (createdFandom: { name: string }) => {
    if (!resumeImportAfterFandomCreate) return;
    setImportAuPath('');
    setImportSelectedFandom({ name: createdFandom.name, dir: createdFandom.name });
    setImportNewAuName('');
    setImportModalOpen(true);
    setResumeImportAfterFandomCreate(false);
  };

  const selectImportFandom = (fandom: { name: string; dir: string }) => {
    setImportSelectedFandom(fandom);
    setImportNewAuName('');
  };

  const handleCreateImportAu = async (fandomDir: string) => {
    if (!importNewAuName.trim()) return;
    setImportCreatingAu(true);
    try {
      const fandomPath = `${dataDir}/fandoms/${fandomDir}`;
      const auName = importNewAuName.trim();
      await createAu(fandomDir, auName, fandomPath);
      await loadFandoms();
      setImportAuPath(`${fandomPath}/aus/${auName}`);
      setImportSelectedFandom(null);
      setImportNewAuName('');
    } catch (error) {
      onError(error);
    } finally {
      setImportCreatingAu(false);
    }
  };

  const handleImportComplete = (target?: string) => {
    const nextAuPath = importAuPath;
    closeImportFlow();
    onNavigate(target || 'writer', nextAuPath);
  };

  return {
    isImportModalOpen,
    importAuPath,
    importNewAuName,
    importSelectedFandom,
    importCreatingAu,
    setImportNewAuName,
    setImportSelectedFandom,
    setImportAuPath,
    selectImportFandom,
    openImportPicker,
    closeImportFlow,
    requestCreateFandomFromImport,
    cancelPendingImportResume,
    handleCreatedFandom,
    handleCreateImportAu,
    handleImportComplete,
  };
}
