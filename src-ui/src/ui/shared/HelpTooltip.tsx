// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState } from "react";
import { Info } from "lucide-react";

interface HelpTooltipProps {
  text: string;
  className?: string;
}

/**
 * ⓘ 图标，点击展开/收起帮助文本。
 * 比 hover tooltip 更适合移动端（触摸设备没有 hover）。
 */
export function HelpTooltip({ text, className }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span className={`relative inline-flex items-center ${className ?? ""}`}>
      <button
        type="button"
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-text/30 hover:text-accent transition-colors"
        onClick={() => setOpen(!open)}
        aria-label="Help"
      >
        <Info size={14} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-black/10 bg-surface p-3 text-xs leading-relaxed text-text/70 shadow-lg dark:border-white/10">
          <p className="whitespace-pre-line">{text}</p>
          <button
            type="button"
            className="mt-2 text-[10px] text-accent"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>
      )}
    </span>
  );
}
