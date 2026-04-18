// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Generic confirm/cancel dialog. Replaces ~15 repeated "simple confirm" Modal
 * patterns across the app. For dialogs that need custom body (e.g. form input),
 * keep using raw <Modal>.
 */

import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { useTranslation } from '../../i18n/useAppTranslation';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Use destructive tone on confirm button. Default false (accent). */
  destructive?: boolean;
  /** Disables buttons and shows spinner on confirm. Modal close is suppressed while loading. */
  loading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  loading = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <Modal isOpen={isOpen} onClose={loading ? () => {} : onClose} title={title}>
      {message ? (
        <div className="mt-2 text-sm leading-relaxed text-text/70">{message}</div>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button tone="neutral" fill="plain" onClick={onClose} disabled={loading}>
          {cancelLabel ?? t('common.actions.cancel')}
        </Button>
        <Button
          tone={destructive ? 'destructive' : 'accent'}
          fill="solid"
          onClick={() => { void onConfirm(); }}
          disabled={loading}
        >
          {loading ? <Spinner size="sm" className="mr-2" /> : null}
          {confirmLabel ?? t('common.actions.confirm')}
        </Button>
      </div>
    </Modal>
  );
}
