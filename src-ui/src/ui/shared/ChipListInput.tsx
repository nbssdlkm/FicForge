// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * 名单胶囊输入 —— 从 AuLoreLayout 的角色别名输入抽取的共享展示组件（M3 批一）。
 * 交互契约（与原实现逐像素一致）：Enter / 逗号提交草稿；草稿为空时 Backspace 回删末项；
 * 胶囊 × 删除；触控尺寸 44px（md 断点缩小）。
 *
 * 展示组件只收 value + 语义回调（state 住在调用方 hook 里），不违反 hook 铁律
 * （规则约束的是 hook 收 setter，不是组件收回调）。
 */

export type ChipListInputProps = {
  label: string;
  values: string[];
  inputValue: string;
  onInputChange: (v: string) => void;
  /** Enter/逗号提交草稿（调用方负责去重/清洗/清空草稿）。 */
  onCommit: () => void;
  onRemoveAt: (index: number) => void;
  /** 草稿为空时按 Backspace 回删末项。 */
  onPopLast: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** 输入联想（datalist）；无则不渲染。 */
  suggestions?: string[];
  /** datalist 需要全局唯一 id；提供 suggestions 时必填。 */
  suggestionsId?: string;
};

export function ChipListInput({
  label,
  values,
  inputValue,
  onInputChange,
  onCommit,
  onRemoveAt,
  onPopLast,
  placeholder,
  disabled,
  suggestions,
  suggestionsId,
}: ChipListInputProps) {
  const listId = suggestions && suggestions.length > 0 ? suggestionsId : undefined;
  return (
    <div className="flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-lg border border-black/10 bg-surface/30 px-3 py-2 dark:border-white/10 md:min-h-[36px]">
      <span className="mr-1 text-xs font-sans text-text/50 md:text-xs">{label}</span>
      {values.map((value, i) => (
        <span
          key={value}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-accent/10 px-3 py-1 text-sm font-sans text-accent md:min-h-0 md:rounded-md md:px-2 md:py-0.5 md:text-xs"
        >
          {value}
          <button
            type="button"
            className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-accent/60 transition-colors hover:text-error md:-mr-1 md:h-5 md:w-5"
            onClick={() => onRemoveAt(i)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="min-w-[80px] flex-1 bg-transparent text-xs font-sans outline-hidden placeholder:text-text/30"
        placeholder={placeholder}
        value={inputValue}
        list={listId}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === ",") && inputValue.trim()) {
            e.preventDefault();
            onCommit();
          }
          if (e.key === "Backspace" && !inputValue && values.length > 0) {
            onPopLast();
          }
        }}
        disabled={disabled}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions!.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
}
