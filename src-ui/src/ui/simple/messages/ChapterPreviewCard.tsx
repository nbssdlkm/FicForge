// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { memo, useState, useEffect, useRef } from "react";
import { BookOpen } from "lucide-react";
import type { SimpleChapterPreviewMessage } from "../types";
import { Card } from "../../shared/Card";
import { Spinner } from "../../shared/Spinner";
import { useTranslation } from "../../../i18n/useAppTranslation";
import { getChapterContent } from "../../../api/engine-client";
import { ActionFooter, CardEyebrow, CardStatusBanner, ExpandToggle } from "./CardChrome";

interface ChapterPreviewCardProps {
  message: SimpleChapterPreviewMessage;
  auPath: string;
  onToggleExpanded: (messageId: string) => void;
}

function ChapterPreviewCardImpl({ message, auPath, onToggleExpanded }: ChapterPreviewCardProps) {
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

  useEffect(() => {
    if (!message.expanded) return;
    if (content !== null || loading || error !== null) return;
    setLoading(true);
    setError(null);
    getChapterContent(auPath, message.chapterNum)
      .then((text) => {
        if (!mountedRef.current) return;
        setContent(text);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (!mountedRef.current) return;
        setError(err.message);
        setLoading(false);
      });
  }, [message.expanded, content, loading, error, auPath, message.chapterNum]);

  const charCount = content ? content.length : 0;

  const Header = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <CardEyebrow icon={BookOpen}>{t("simple.previewCard.chapterEyebrow", { defaultValue: "Chapter" })}</CardEyebrow>
      <span className="font-display text-[14px] font-semibold not-italic tracking-normal text-text">
        {t("simple.previewCard.chapterNum", { defaultValue: "第 {{num}} 章", num: message.chapterNum })}
      </span>
      {charCount > 0 && (
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-faint">
          {t("simple.previewCard.charCount", { defaultValue: "{{n}} chars", n: charCount })}
        </span>
      )}
      <ExpandToggle
        expanded={message.expanded}
        onToggle={() => onToggleExpanded(message.id)}
        expandLabel={t("simple.previewCard.expand", { defaultValue: "展开" })}
        collapseLabel={t("simple.previewCard.collapse", { defaultValue: "折叠" })}
        className="ml-auto"
      />
    </div>
  );

  if (!message.expanded) {
    return <Card className="px-4 py-3">{Header}</Card>;
  }

  return (
    <Card className="flex flex-col gap-3 px-4 py-3">
      {Header}
      {loading && (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}
      {error && (
        <CardStatusBanner tone="error">
          {t("simple.previewCard.loadFailed", { defaultValue: "加载失败：{{message}}", message: error })}
        </CardStatusBanner>
      )}
      {content !== null && !loading && !error && (
        <>
          <div
            className="whitespace-pre-wrap break-words font-serif text-text/90"
            style={{ fontSize: "var(--ff-body-fs, 14px)", lineHeight: "var(--ff-body-lh, 1.75)" }}
          >
            {content}
          </div>
          <ActionFooter className="justify-end pt-2">
            <ExpandToggle
              expanded
              onToggle={() => onToggleExpanded(message.id)}
              expandLabel={t("simple.previewCard.collapse", { defaultValue: "折叠" })}
              collapseLabel={t("simple.previewCard.collapse", { defaultValue: "折叠" })}
            />
          </ActionFooter>
        </>
      )}
    </Card>
  );
}

export const ChapterPreviewCard = memo(ChapterPreviewCardImpl);
