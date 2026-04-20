// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState } from 'react';
import { createFandom, createAu, deleteFandom, deleteAu } from '../../api/engine-client';

export type LibraryDeleteTarget = {
  type: 'fandom' | 'au';
  fandomDir: string;
  fandomName: string;
  auDir?: string;
  auName?: string;
} | null;

type UseLibraryMutationsOptions = {
  dataDir: string;
  loadFandoms: () => Promise<void>;
  onNavigate: (page: string, auPath?: string) => void;
  onError: (error: unknown) => void;
  onCreatedFandom?: (createdFandom: { name: string; dir_name: string }) => void;
  onCloseFandomModal?: () => void;
};

export function useLibraryMutations({
  dataDir,
  loadFandoms,
  onNavigate,
  onError,
  onCreatedFandom,
  onCloseFandomModal,
}: UseLibraryMutationsOptions) {
  const [isFandomModalOpen, setFandomModalOpen] = useState(false);
  const [isAuModalOpen, setAuModalOpen] = useState(false);
  const [creatingFandom, setCreatingFandom] = useState(false);
  const [creatingAu, setCreatingAu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newFandomName, setNewFandomName] = useState('');
  const [newAuName, setNewAuName] = useState('');
  const [selectedFandom, setSelectedFandom] = useState('');
  const [selectedFandomDir, setSelectedFandomDir] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<LibraryDeleteTarget>(null);

  const openFandomModal = () => {
    setFandomModalOpen(true);
  };

  const closeFandomModal = () => {
    setFandomModalOpen(false);
    onCloseFandomModal?.();
  };

  const openAuModal = (fandomName: string, fandomDir: string) => {
    setSelectedFandom(fandomName);
    setSelectedFandomDir(fandomDir);
    setAuModalOpen(true);
  };

  const openDeleteFandom = (fandomDir: string, fandomName: string) => {
    setDeleteTarget({ type: 'fandom', fandomDir, fandomName });
  };

  const openDeleteAu = (fandomDir: string, fandomName: string, auDir: string, auName: string) => {
    setDeleteTarget({ type: 'au', fandomDir, fandomName, auDir, auName });
  };

  const handleCreateFandom = async () => {
    if (!newFandomName.trim() || creatingFandom) return;
    setCreatingFandom(true);
    try {
      const createdFandom = await createFandom(newFandomName.trim());
      setFandomModalOpen(false);
      setNewFandomName('');
      await loadFandoms();
      onCreatedFandom?.(createdFandom);
    } catch (error) {
      onError(error);
    } finally {
      setCreatingFandom(false);
    }
  };

  const handleCreateAu = async () => {
    if (!newAuName.trim() || !selectedFandomDir || creatingAu) return;
    setCreatingAu(true);
    try {
      const fandomPath = `${dataDir}/fandoms/${selectedFandomDir}`;
      const auName = newAuName.trim();
      const createdAu = await createAu(selectedFandom, auName, fandomPath);
      setAuModalOpen(false);
      setNewAuName('');
      onNavigate('writer', createdAu.path);
    } catch (error) {
      onError(error);
    } finally {
      setCreatingAu(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      if (deleteTarget.type === 'fandom') {
        await deleteFandom(deleteTarget.fandomDir);
      } else {
        await deleteAu(deleteTarget.fandomDir, deleteTarget.auDir || deleteTarget.auName!);
      }
      setDeleteTarget(null);
      await loadFandoms();
    } catch (error) {
      onError(error);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return {
    isFandomModalOpen,
    isAuModalOpen,
    creatingFandom,
    creatingAu,
    deleting,
    newFandomName,
    newAuName,
    selectedFandom,
    deleteTarget,
    setNewFandomName,
    setNewAuName,
    setAuModalOpen,
    setDeleteTarget,
    openFandomModal,
    closeFandomModal,
    openAuModal,
    openDeleteFandom,
    openDeleteAu,
    handleCreateFandom,
    handleCreateAu,
    handleDelete,
  };
}
