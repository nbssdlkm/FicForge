// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 共享进度条组件，提取自 ImportProgressStep。 */

interface ProgressBarProps {
  /** 0-100 */
  percent: number;
  className?: string;
}

export function ProgressBar({ percent, className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={`h-3 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10 ${className ?? ""}`}>
      <div
        className="h-full rounded-full bg-accent transition-all duration-300"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
