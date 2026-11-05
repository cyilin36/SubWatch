import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { cn, formatCentsInput, parseMoneyToCents, prettyJson } from '../../lib/utils';
import { OFFSET_PRESETS } from '../../lib/presets';
import { Button, Input } from '../ui';

// ---------------------------------------------------------------------------
// Tags / comma separated list input
// ---------------------------------------------------------------------------

function parseList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export interface TagsInputProps {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  invalid?: boolean;
  multiline?: boolean;
  className?: string;
}

/** Comma/newline separated list input (tags, email recipients, ...). */
export function TagsInput({ id, value, onChange, placeholder, invalid, multiline = false, className }: TagsInputProps) {
  const [text, setText] = useState(() => value.join(', '));

  useEffect(() => {
    const parsed = parseList(text);
    if (parsed.join('\u0000') !== value.join('\u0000')) {
      setText(value.join(', '));
    }
    // Only re-sync when the external value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (next: string) => {
    setText(next);
    onChange(parseList(next));
  };

  if (multiline) {
    return (
      <textarea
        id={id}
        rows={3}
        value={text}
        onChange={(event) => handleChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        className={cn(
          'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]',
          'placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]',
          invalid && 'border-[var(--danger)] focus:ring-[var(--danger)]',
          className,
        )}
      />
    );
  }

  return (
    <Input
      id={id}
      value={text}
      onChange={(event) => handleChange(event.target.value)}
      placeholder={placeholder}
      invalid={invalid}
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// Multi checkbox (channel selection, monitor selection)
// ---------------------------------------------------------------------------

export interface CheckboxItem {
  value: string;
  label: string;
  description?: string;
}

export function MultiCheckbox({
  items,
  value,
  onChange,
  emptyText,
  className,
}: {
  items: CheckboxItem[];
  value: string[];
  onChange: (next: string[]) => void;
  emptyText?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (items.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">{emptyText ?? t('common.none')}</p>;
  }
  const toggle = (itemValue: string) => {
    onChange(
      value.includes(itemValue) ? value.filter((entry) => entry !== itemValue) : [...value, itemValue],
    );
  };
  return (
    <div className={cn('grid gap-2 sm:grid-cols-2', className)}>
      {items.map((item) => {
        const checked = value.includes(item.value);
        return (
          <label
            key={item.value}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm transition-colors',
              checked
                ? 'border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_8%,transparent)]'
                : 'border-[var(--border)] hover:bg-[var(--surface-muted)]',
            )}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(item.value)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
            />
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.label}</span>
              {item.description ? (
                <span className="block truncate text-xs text-[var(--muted-foreground)]">{item.description}</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reminder offsets input
// ---------------------------------------------------------------------------

export function OffsetsInput({
  value,
  onChange,
  id,
}: {
  value: number[];
  onChange: (next: number[]) => void;
  id?: string;
}) {
  const { t } = useTranslation();
  const [customValue, setCustomValue] = useState('');

  const toggle = (offset: number) => {
    onChange(value.includes(offset) ? value.filter((entry) => entry !== offset) : [...value, offset].sort((a, b) => b - a));
  };

  const addCustom = () => {
    const parsed = Number(customValue);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650) return;
    if (!value.includes(parsed)) onChange([...value, parsed].sort((a, b) => b - a));
    setCustomValue('');
  };

  const customOffsets = value.filter((offset) => !OFFSET_PRESETS.includes(offset)).sort((a, b) => b - a);

  return (
    <div className="space-y-2" id={id}>
      <div className="flex flex-wrap gap-1.5">
        {OFFSET_PRESETS.map((offset) => {
          const active = value.includes(offset);
          return (
            <button
              key={offset}
              type="button"
              onClick={() => toggle(offset)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-foreground)]'
                  : 'border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-muted)]',
              )}
            >
              {t('common.days', { count: offset })}
            </button>
          );
        })}
        {customOffsets.map((offset) => (
          <button
            key={`custom-${offset}`}
            type="button"
            onClick={() => toggle(offset)}
            title={t('common.remove')}
            className="rounded-full border border-[var(--info)] bg-[color-mix(in_srgb,var(--info)_12%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--info)]"
          >
            {t('common.days', { count: offset })} ×
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          min={0}
          max={3650}
          value={customValue}
          onChange={(event) => setCustomValue(event.target.value)}
          placeholder={t('subscriptionForm.addOffset')}
          className="h-8 w-28"
        />
        <Button variant="outline" size="sm" onClick={addCustom} disabled={customValue.trim() === ''}>
          {t('common.add')}
        </Button>
        {value.length > 0 ? (
          <span className="text-xs text-[var(--muted-foreground)]">
            {[...value].sort((a, b) => b - a).join(', ')}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Amount input (major units <-> integer cents)
// ---------------------------------------------------------------------------

export function AmountInput({
  id,
  value,
  onChange,
  currency,
  placeholder,
  invalid,
  disabled,
}: {
  id?: string;
  value: number | null;
  onChange: (cents: number | null) => void;
  currency: string;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [text, setText] = useState(() => formatCentsInput(value));

  useEffect(() => {
    if (parseMoneyToCents(text) !== value) setText(formatCentsInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (next: string) => {
    setText(next);
    if (next.trim() === '') {
      onChange(null);
      return;
    }
    const cents = parseMoneyToCents(next);
    if (cents !== null) onChange(cents);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        onChange={(event) => handleChange(event.target.value)}
        placeholder={placeholder ?? '0.00'}
        invalid={invalid}
        disabled={disabled}
        className="pr-14"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">
        {currency}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export function RootError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-sm text-[var(--danger)]">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="break-words">{message}</span>
    </div>
  );
}

export function JsonPreview({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre
      className={cn(
        'max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-muted)] p-3 font-mono text-xs leading-relaxed',
        className,
      )}
    >
      {prettyJson(value)}
    </pre>
  );
}

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4', className)}>
      {title ? <h3 className="text-sm font-semibold">{title}</h3> : null}
      {description ? (
        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{description}</p>
      ) : null}
      <div className={cn(title || description ? 'mt-3' : '', 'space-y-4')}>{children}</div>
    </div>
  );
}

export function Pagination({
  page,
  pages,
  total,
  onPageChange,
  disabled,
}: {
  page: number;
  pages: number;
  total: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2">
      <p className="text-xs text-[var(--muted-foreground)]">
        {t('common.total', { total })} · {t('common.pageInfo', { page: Math.min(page + 1, Math.max(pages, 1)), pages: Math.max(pages, 1) })}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || page <= 0}
          onClick={() => onPageChange(page - 1)}
        >
          {t('common.previousPage')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || page >= pages - 1}
          onClick={() => onPageChange(page + 1)}
        >
          {t('common.nextPage')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented control (mode switches)
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      className={cn('inline-flex flex-wrap items-center gap-1 rounded-lg bg-[var(--surface-muted)] p-1', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]',
            value === option.value
              ? 'bg-[var(--surface)] text-[var(--foreground)] shadow-sm'
              : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
