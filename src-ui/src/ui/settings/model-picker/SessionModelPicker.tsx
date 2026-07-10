// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState } from "react";
import { useTranslation } from "../../../i18n/useAppTranslation";
import { formatCtx, type PickerModelOption, type SessionLayer } from "./model-picker-utils";

export interface SessionModelPickerProps {
  model: string;
  /** 受控绑定（会话级临时切换）。 */
  onModelChange: (model: string) => void;
  /** 当前生效层级（badge 三态：会话临时 / AU 覆盖中 / 全局默认）。 */
  layer: SessionLayer;
  /** 当前生效供应商的可选模型（推荐 + 已启用 + 自定义合并）。空 = 纯手填。 */
  options: PickerModelOption[];
  disabled?: boolean;
}

const LAYER_BADGE_CLASS: Record<SessionLayer, string> = {
  session: "bg-warning/15 text-warning",
  au: "bg-info/15 text-info",
  global: "bg-rule-soft text-text/50",
};

/**
 * 会话级模型下拉（writer 侧栏 + 对话设置抽屉共用）：
 * 顶部生效层级 badge + 当前供应商推荐模型下拉 + 手填切换。
 * 取代原先直连 MODEL_PRESETS 静态清单的 optgroup select。
 */
export function SessionModelPicker({ model, onModelChange, layer, options, disabled }: SessionModelPickerProps) {
  const { t } = useTranslation();
  const [manual, setManual] = useState(false);

  const modelInOptions = options.some((o) => o.id === model);
  const useManualInput = manual || options.length === 0;

  const optionLabel = (o: PickerModelOption) =>
    o.ctx.value !== undefined ? `${o.displayName} · ${formatCtx(o.ctx.value)}` : o.displayName;

  return (
    <div className="flex flex-col gap-1.5">
      <span
        data-testid="session-layer-badge"
        className={`self-start rounded-full px-2 py-0.5 text-[10px] font-bold ${LAYER_BADGE_CLASS[layer]}`}
      >
        {t(`modelPicker.layer.${layer}`)}
      </span>

      {useManualInput ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            placeholder={t("modelPicker.manualModelPlaceholder")}
            disabled={disabled}
            className="h-11 min-w-0 flex-1 rounded-md border border-black/20 bg-background px-3 text-base text-text placeholder:text-text/50 outline-hidden focus:ring-1 focus:ring-accent dark:border-white/20 md:h-8 md:px-2 md:text-xs"
          />
          {options.length > 0 && (
            <button
              type="button"
              onClick={() => setManual(false)}
              disabled={disabled}
              className="shrink-0 rounded-md border border-black/20 bg-background px-2 text-xs text-text/70 hover:text-text dark:border-white/20"
            >
              {t("modelPicker.backToList")}
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <select
            value={modelInOptions ? model : ""}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={disabled}
            aria-label={t("common.labels.model")}
            className="h-11 min-w-0 flex-1 rounded-md border border-black/20 bg-background px-3 text-base text-text outline-hidden focus:ring-1 focus:ring-accent dark:border-white/20 md:h-8 md:px-2 md:text-xs"
          >
            {!modelInOptions && (
              <option value="" disabled>{model || t("modelPicker.selectModelHint")}</option>
            )}
            {options.map((o) => (
              <option key={o.id} value={o.id}>{optionLabel(o)}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setManual(true)}
            disabled={disabled}
            className="shrink-0 rounded-md border border-black/20 bg-background px-2 text-xs text-text/70 hover:text-text dark:border-white/20"
          >
            {t("modelPicker.manualInput")}
          </button>
        </div>
      )}
    </div>
  );
}
