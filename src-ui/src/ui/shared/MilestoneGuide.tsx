import { X, Lightbulb } from 'lucide-react';
import { Button } from './Button';

interface MilestoneGuideProps {
  title: string;
  description: string;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  onDismiss: () => void;
}

export function MilestoneGuide({
  title,
  description,
  primaryAction,
  secondaryAction,
  onDismiss,
}: MilestoneGuideProps) {
  return (
    <div className="bg-accent/5 border border-accent/20 rounded-lg px-4 py-3 mx-4 mt-2 mb-1">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Lightbulb size={18} className="text-accent shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium text-text/90">{title}</div>
            <div className="text-xs text-text/60 leading-relaxed">{description}</div>
            {(primaryAction || secondaryAction) && (
              <div className="flex items-center gap-2 pt-1">
                {primaryAction && (
                  <Button variant="primary" size="sm" className="text-xs h-7 px-3" onClick={primaryAction.onClick}>
                    {primaryAction.label}
                  </Button>
                )}
                {secondaryAction && (
                  <Button variant="ghost" size="sm" className="text-xs h-7 px-3" onClick={secondaryAction.onClick}>
                    {secondaryAction.label}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
        <button
          className="shrink-0 p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text/30 hover:text-text/60 transition-colors"
          onClick={onDismiss}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
