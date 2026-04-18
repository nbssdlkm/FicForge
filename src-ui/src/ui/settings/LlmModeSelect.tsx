// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * LLM 模式下拉选择器 —— 消费 engine/capabilities.ts 的能力矩阵。
 *
 * 设计要点：
 *   - "有哪些模式可用"由引擎的 listGenerationModes(platform) 单一决定，
 *     UI 只是渲染，不再硬编码 <option value="api|local|ollama">。
 *   - coming_soon 的模式会渲染但 disabled（UI 保留未来路线图的可见性）。
 *   - desktop_only 的模式在非桌面端直接不渲染（不会误导用户）。
 *   - 非 api 模式可能带 hintKey，本组件负责把它翻译后显示在下方。
 *   - 未来新增模式（例如 Anthropic 原生 Messages）只需改 capabilities.ts，
 *     本组件和两个消费方 (GlobalSettingsModal / AuSettingsLayout) 零修改。
 */

import { useMemo } from 'react';
import { listGenerationModes, type LLMModeKey, type Platform } from '@ficforge/engine';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';
import { getEngine } from '../../api/engine-client';

interface LlmModeSelectProps {
  value: string;
  onChange: (next: LLMModeKey) => void;
  disabled?: boolean;
  className?: string;
  /** 可选：覆盖平台检测（主要用于测试）。默认从 engine adapter 读取。 */
  platform?: Platform;
}

export function LlmModeSelect({
  value,
  onChange,
  disabled,
  className,
  platform,
}: LlmModeSelectProps) {
  const { t } = useTranslation();

  const resolvedPlatform: Platform = useMemo(() => {
    if (platform) return platform;
    try {
      return getEngine().adapter.getPlatform();
    } catch {
      // engine 未初始化时（罕见）默认 web
      return 'web';
    }
  }, [platform]);

  const options = useMemo(
    () => listGenerationModes(resolvedPlatform),
    [resolvedPlatform],
  );

  // 当前选中模式的 hint key（如果有）
  const currentHint = options.find((o) => o.mode === value)?.availability.hintKey;

  return (
    <div className="flex flex-col gap-1.5">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as LLMModeKey)}
        disabled={disabled}
        className={
          className ??
          'h-11 rounded-md border border-black/20 bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent disabled:opacity-60 dark:border-white/20 md:h-10 md:text-sm'
        }
      >
        {options.map(({ mode, availability }) => (
          <option
            key={mode}
            value={mode}
            disabled={!availability.available}
          >
            {getEnumLabel('llm_mode', mode, mode)}
            {!availability.available
              ? ` (${t('common.status.comingSoon')})`
              : ''}
          </option>
        ))}
      </select>
      {/* 平台相关的提示（如 ollama 在移动端需要填局域网 IP） */}
      {currentHint && (
        <p className="text-xs leading-relaxed text-warning">{t(currentHint)}</p>
      )}
      {/* 模式本身的常规说明（沿用原有 i18n key） */}
      {!currentHint && (
        <p className="text-xs text-text/50">
          {t(`common.help.llmMode.${value}`)}
        </p>
      )}
    </div>
  );
}
