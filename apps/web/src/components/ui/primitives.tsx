import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertTriangle, Check, Copy, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn, errorMessage, localizeFieldError, type Tone } from '../../lib/utils';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'icon' | 'icon-sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--brand)] text-[var(--brand-foreground)] hover:brightness-110 active:brightness-95 shadow-sm',
  secondary:
    'bg-[var(--surface-muted)] text-[var(--foreground)] border border-[var(--border)] hover:bg-[var(--border)]',
  outline:
    'border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--surface-muted)]',
  ghost: 'bg-transparent text-[var(--foreground)] hover:bg-[var(--surface-muted)]',
  danger: 'bg-[var(--danger)] text-white hover:brightness-110 active:brightness-95 shadow-sm',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  icon: 'h-9 w-9',
  'icon-sm': 'h-8 w-8',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading = false, disabled, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--background)]',
        'disabled:pointer-events-none disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Input / Textarea
// ---------------------------------------------------------------------------

const FIELD_BASE =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)] ' +
  'placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)] ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        FIELD_BASE,
        'h-9',
        invalid && 'border-[var(--danger)] focus:ring-[var(--danger)]',
        className,
      )}
      {...props}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows = 4, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        FIELD_BASE,
        'min-h-[80px] py-2 leading-relaxed',
        invalid && 'border-[var(--danger)] focus:ring-[var(--danger)]',
        className,
      )}
      {...props}
    />
  );
});

// ---------------------------------------------------------------------------
// Tones / Badge
// ---------------------------------------------------------------------------

const TONE_COLORS: Record<Tone, string> = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  muted: 'var(--muted-foreground)',
  neutral: 'var(--foreground)',
};

export function toneStyle(tone: Tone): { color: string; backgroundColor: string; borderColor: string } {
  const color = TONE_COLORS[tone];
  return {
    color,
    backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 28%, transparent)`,
  };
}

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}

export function Badge({ tone = 'neutral', children, className, dot = false }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        className,
      )}
      style={toneStyle(tone)}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex flex-col gap-1 p-4 pb-2', className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <h2 className={cn('text-base font-semibold', className)}>{children}</h2>;
}

export function CardDescription({ className, children }: { className?: string; children?: ReactNode }) {
  return <p className={cn('text-sm text-[var(--muted-foreground)]', className)}>{children}</p>;
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-4 pt-2', className)}>{children}</div>;
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex items-center justify-end gap-2 border-t border-[var(--border)] p-3', className)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

export function Spinner({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-9 w-9' };
  return <Loader2 className={cn('animate-spin text-[var(--muted-foreground)]', sizes[size], className)} aria-hidden />;
}

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
      <Spinner size="lg" />
      {label ? <p className="text-sm text-[var(--muted-foreground)]">{label}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom border-collapse text-sm', className)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-[var(--surface-muted)]">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr className={cn('border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--surface-muted)]', className)}>
      {children}
    </tr>
  );
}

export function TH({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TD({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn('px-3 py-2.5 align-middle', className)}>
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// PageHeader
// ---------------------------------------------------------------------------

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, icon, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <div className="mt-0.5 shrink-0 text-[var(--brand)]">{icon}</div> : null}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? <div className="mb-3 text-[var(--muted-foreground)]">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-[var(--muted-foreground)]">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorState
// ---------------------------------------------------------------------------

export function ErrorState({
  error,
  title,
  onRetry,
  className,
}: {
  error?: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center',
        className,
      )}
    >
      <AlertTriangle className="mb-3 h-8 w-8 text-[var(--warning)]" aria-hidden />
      <p className="text-sm font-medium">{title ?? t('errors.loadFailed')}</p>
      {error ? (
        <p className="mt-1 max-w-lg break-words text-sm text-[var(--muted-foreground)]">{errorMessage(error)}</p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field (label + error + hint wrapper)
// ---------------------------------------------------------------------------

export interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, error, hint, required, children, className }: FieldProps) {
  const { t } = useTranslation();
  const message = error ? localizeFieldError(error, t) : '';
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-sm font-medium text-[var(--foreground)]">
          {label}
          {required ? <span className="ml-0.5 text-[var(--danger)]">*</span> : null}
        </label>
      ) : null}
      {children}
      {message ? <p className="text-xs text-[var(--danger)]">{message}</p> : null}
      {hint && !message ? <p className="text-xs text-[var(--muted-foreground)]">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

export function CopyButton({
  value,
  label,
  className,
  variant = 'outline',
  size = 'sm',
}: {
  value: string;
  label?: string;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const { t } = useTranslation();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('common.copied'), { icon: <Check className="h-4 w-4" /> });
    } catch {
      toast.error(t('common.copyFailed'));
    }
  };
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={() => {
        void copy();
      }}
      title={t('common.copy')}
    >
      <Copy className="h-3.5 w-3.5" aria-hidden />
      {label ?? t('common.copy')}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Alert banner
// ---------------------------------------------------------------------------

export function Alert({
  tone = 'warning',
  title,
  children,
  className,
  action,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const style = toneStyle(tone);
  return (
    <div
      className={cn('flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm', className)}
      style={style}
      role="alert"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title ? 'mt-0.5' : '', 'break-words opacity-90')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-[var(--surface-muted)]', className)} />;
}

export function CloseIcon() {
  return <X className="h-4 w-4" aria-hidden />;
}
