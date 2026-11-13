import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { cn, prettyJson } from '../../lib/utils';
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
        className={cn('field px-4 py-3', className)}
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
    return <p className="text-body text-moonlight">{emptyText ?? t('common.none')}</p>;
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
              'glass-flat flex cursor-pointer items-start gap-3 px-4 py-3 text-sm transition-colors duration-300',
              checked
                ? 'border-white/40 bg-white/10'
                : 'hover:border-white/25 hover:bg-white/5',
            )}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(item.value)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-moonlight"
            />
            <span className="min-w-0">
              <span className="block truncate font-medium text-white">{item.label}</span>
              {item.description ? (
                <span className="block truncate text-xs text-moon-steel">{item.description}</span>
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
    <div className="space-y-3" id={id}>
      <div className="flex flex-wrap gap-2">
        {OFFSET_PRESETS.map((offset) => {
          const active = value.includes(offset);
          return (
            <button
              key={offset}
              type="button"
              onClick={() => toggle(offset)}
              className={cn(
                'rounded-pill border px-3.5 py-1.5 text-xs font-medium transition-colors duration-300',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
                active
                  ? 'border-white/40 bg-white/14 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]'
                  : 'border-white/15 text-moonlight hover:border-white/30 hover:bg-white/8 hover:text-white',
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
            className="rounded-pill border border-[rgba(124,156,196,0.4)] bg-[rgba(124,156,196,0.14)] px-3.5 py-1.5 text-xs font-medium text-moonlight transition-colors hover:bg-[rgba(124,156,196,0.24)]"
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
          className="h-10 w-32"
        />
        <Button variant="outline" size="sm" onClick={addCustom} disabled={customValue.trim() === ''}>
          {t('common.add')}
        </Button>
        {value.length > 0 ? (
          <span className="text-xs text-moon-steel">{[...value].sort((a, b) => b - a).join(', ')}</span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export function RootError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="glass-flat flex items-start gap-3 border-[rgba(240,128,127,0.4)] bg-[rgba(240,128,127,0.12)] px-4 py-3 text-sm text-[#f0807f]">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="break-words">{message}</span>
    </div>
  );
}

export function JsonPreview({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre
      className={cn(
        'glass-flat max-h-80 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-white/80',
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
    <section className={cn('glass p-6 sm:p-8', className)}>
      {title ? <h3 className="text-[18px] font-medium leading-snug text-white">{title}</h3> : null}
      {description ? <p className="mt-1.5 text-body text-moonlight">{description}</p> : null}
      <div className={cn(title || description ? 'mt-6' : '', 'space-y-5')}>{children}</div>
    </section>
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
      <p className="text-xs tracking-[0.08em] text-moon-steel">
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
      className={cn('glass-flat inline-flex flex-wrap items-center gap-1 rounded-btn p-1.5', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-btn px-4 py-2 text-sm font-medium transition-colors duration-300',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
            value === option.value
              ? 'bg-white/12 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]'
              : 'text-moonlight hover:text-white',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
