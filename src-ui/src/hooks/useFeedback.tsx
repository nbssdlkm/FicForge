// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Modal } from "../ui/shared/Modal";
import { Toast } from "../ui/shared/Toast";
import { Button } from "../ui/shared/Button";
import { ApiError } from "../api/engine-client";
import { useTranslation } from "../i18n/useAppTranslation";

type ToastVariant = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
}

interface ErrorDialogState {
  message: string;
  actions: string[];
}

interface FeedbackContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
  showSuccess: (message: string) => void;
  showError: (error: unknown, fallbackMessage?: string) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

function getMessage(error: unknown, fallback: string): { message: string; actions: string[] } {
  if (error instanceof ApiError) {
    return {
      message: error.userMessage || error.message || fallback,
      actions: error.actions,
    };
  }
  if (error instanceof Error) {
    return {
      message: error.message || fallback,
      actions: [],
    };
  }
  return {
    message: fallback,
    actions: [],
  };
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<ErrorDialogState | null>(null);

  const removeToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, message, variant }]);
  }, []);

  const showSuccess = useCallback((message: string) => {
    showToast(message, "success");
  }, [showToast]);

  const showError = useCallback((error: unknown, fallbackMessage?: string) => {
    const fallback = fallbackMessage || t("error_messages.unknown");
    const { message, actions } = getMessage(error, fallback);
    // 日志记录完整错误信息，便于调试
    console.error("[FicForge] showError:", message, error);
    if (actions.length > 1) {
      setDialog({ message, actions });
      return;
    }
    showToast(message, "error");
  }, [showToast, t]);

  useEffect(() => {
    if (toasts.length === 0) return undefined;

    const timers = toasts.map((toast) =>
      window.setTimeout(() => removeToast(toast.id), 3500)
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [removeToast, toasts]);

  const value = useMemo<FeedbackContextValue>(
    () => ({
      showToast,
      showSuccess,
      showError,
    }),
    [showError, showSuccess, showToast]
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-full max-w-sm flex-col gap-3">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            tone={toast.variant}
            onClose={() => removeToast(toast.id)}
            className="self-end"
          />
        ))}
      </div>
      <Modal
        isOpen={dialog !== null}
        onClose={() => setDialog(null)}
        title={t("shared.feedback.errorTitle")}
      >
        <div className="space-y-4">
          <p className="text-sm text-text/90">{dialog?.message}</p>
          {dialog && dialog.actions.length > 0 && (
            <div className="space-y-2 rounded-lg border border-black/10 bg-surface/50 p-3 text-sm text-text/70 dark:border-white/10">
              <p className="font-medium text-text">{t("shared.feedback.actionsTitle")}</p>
              {dialog.actions.map((action) => (
                <p key={action}>• {action}</p>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button tone="accent" fill="solid" onClick={() => setDialog(null)}>
              {t("shared.feedback.acknowledge")}
            </Button>
          </div>
        </div>
      </Modal>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error("useFeedback must be used within FeedbackProvider");
  }
  return context;
}
