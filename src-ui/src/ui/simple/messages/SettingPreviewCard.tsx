// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { memo, useState, useEffect, useRef } from "react";
import { AlertCircle, ChevronDown, ChevronUp, FileText } from "lucide-react";
import type { SimpleSettingPreviewMessage } from "../types";
import { Card } from "../../shared/Card";
import { Button } from "../../shared/Button";
import { Spinner } from "../../shared/Spinner";
import { useTranslation } from "../../../i18n/useAppTranslation";
import { readLore } from "../../../api/engine-client";

interface SettingPreviewCardProps {
  message: SimpleSettingPreviewMessage;
  auPath: string;
  fandomPath?: string;
  onToggleExpanded: (messageId: string) => void;
}

function SettingPreviewCardImpl({
  message,
  auPath,
  fandomPath,
  onToggleExpanded,
}: SettingPreviewCardProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const parts = message.filePath.split("/");
  const category = parts[0] ?? "";
  const filename = parts.slice(1).join("/") || message.filePath;
  const isFandom = category === "core_characters" || category === "core_worldbuilding";
  const missingFandomPath =
    isFandom && !fandomPath
      ? t("simple.previewCard.noFandomPath", { defaultValue: "请提供 fandomPath" })
      : null;

  useEffect(() => {
    if (!message.expanded) return;
    if (content !== null || loading || error !== null) return;
    if (missingFandomPath) return;
    setLoading(true);
    setError(null);
    readLore({
      au_path: isFandom ? undefined : auPath,
      fandom_path: isFandom ? fandomPath : undefined,
      category,
      filename,
    })
      .then((result) => {
        if (!mountedRef.current) return;
        setContent(result.content);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (!mountedRef.current) return;
        setError(err.message);
        setLoading(false);
      });
  }, [message.expanded, content, loading, error, missingFandomPath, auPath, fandomPath, category, filename, isFandom]);

  const charCount = content ? content.length : 0;

  const Header = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-gold-bright">
        <FileText size={11} />
        {t("simple.previewCard.settingEyebrow", { defaultValue: "Lore" })}
      </span>
      <span className="break-all font-display text-[13px] font-semibold not-italic tracking-normal text-text">
        {message.filePath}
      </span>
      {charCount > 0 && (
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-faint">
          {t("simple.previewCard.charCount", { defaultValue: "{{n}} chars", n: charCount })}
        </span>
      )}
      <Button
        tone="neutral"
        fill="plain"
        size="sm"
        onClick={() => onToggleExpanded(message.id)}
        className="ml-auto font-mono text-[10px] uppercase tracking-[0.08em]"
      >
        {message.expanded ? <ChevronUp size={12} className="mr-1" /> : <ChevronDown size={12} className="mr-1" />}
        {message.expanded
          ? t("simple.previewCard.collapse", { defaultValue: "折叠" })
          : t("simple.previewCard.expand", { defaultValue: "展开" })}
      </Button>
    </div>
  );

  if (!message.expanded) {
    return <Card className="px-4 py-3">{Header}</Card>;
  }

  return (
    <Card className="flex flex-col gap-3 px-4 py-3">
      {Header}
      {missingFandomPath && (
        <div className="flex items-start gap-2 rounded-sm border border-error/40 bg-error/8 px-3 py-2 font-serif text-xs text-error">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{missingFandomPath}</span>
        </div>
      )}
      {loading && (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-sm border border-error/40 bg-error/8 px-3 py-2 font-serif text-xs text-error">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{t("simple.previewCard.loadFailed", { defaultValue: "加载失败：{{message}}", message: error })}</span>
        </div>
      )}
      {content !== null && !loading && !error && !missingFandomPath && (
        <>
          <div
            className="whitespace-pre-wrap break-words font-serif text-text/90"
            style={{ fontSize: "var(--ff-body-fs, 14px)", lineHeight: "var(--ff-body-lh, 1.75)" }}
          >
            {content}
          </div>
          <div className="flex justify-end border-t border-rule pt-2">
            <Button
              tone="neutral"
              fill="plain"
              size="sm"
              onClick={() => onToggleExpanded(message.id)}
              className="font-mono text-[10px] uppercase tracking-[0.08em]"
            >
              <ChevronUp size={12} className="mr-1" />
              {t("simple.previewCard.collapse", { defaultValue: "折叠" })}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

export const SettingPreviewCard = memo(SettingPreviewCardImpl);
