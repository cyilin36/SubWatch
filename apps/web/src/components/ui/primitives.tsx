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

/**
 * Primary is the accent pill: the one accent action on a screen. Everything
 * else is glass or ghost, so the accent never has to compete with itself.
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'cta rounded-pill',
  secondary:
    'rounded-btn border border-ink/15 bg-ink/8 text-ink backdrop-blur-xl hover:border-ink/30 hover:bg-ink/14',
  outline:
    'rounded-btn border border-ink/15 bg-transparent text-ink hover:border-ink/30 hover:bg-ink/8',
  ghost: 'rounded-btn bg-transparent text-moonlight hover:bg-ink/8 hover:text-ink',
  danger:
    'rounded-btn border border-danger/40 bg-danger/12 text-danger hover:bg-danger/20',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-xs gap-1.5',
  md: 'h-10 px-5 text-sm gap-2',
  icon: 'h-10 w-10',
  'icon-sm': 'h-9 w-9',
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
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-[background-color,border-color,box-shadow,transform,color] duration-500 ease-glass',
        'disabled:pointer-events-none disabled:opacity-45',
        variant === 'primary'
          ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2 focus-visible:ring-offset-night-deep'
          : 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/50 focus-visible:ring-offset-2 focus-visible:ring-offset-night',
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
      className={cn('field h-11 px-4', className)}
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
      className={cn('field min-h-[96px] px-4 py-3 leading-relaxed', className)}
      {...props}
    />
  );
});

// ---------------------------------------------------------------------------
// Tones / Badge
// ---------------------------------------------------------------------------

const TONE_COLORS: Record<Tone, string> = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  info: 'var(--color-info)',
  muted: 'var(--color-tone-muted)',
  neutral: 'var(--color-ink)',
};

export function toneStyle(tone: Tone): { color: string; backgroundColor: string; borderColor: string } {
  const color = TONE_COLORS[tone];
  return {
    color,
    backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 34%, transparent)`,
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
        'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-0.5',
        'text-[11px] font-medium tracking-[0.04em]',
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
// Glass panel (Card)
// ---------------------------------------------------------------------------

export function Card({
  className,
  children,
  interactive = false,
}: {
  className?: string;
  children: ReactNode;
  interactive?: boolean;
}) {
  return (
    <div className={cn('glass relative', interactive && 'glass-interactive', className)}>{children}</div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex flex-col gap-1.5 p-6 pb-2', className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <h2 className={cn('text-[18px] font-medium leading-snug text-ink', className)}>{children}</h2>;
}

export function CardDescription({ className, children }: { className?: string; children?: ReactNode }) {
  return <p className={cn('text-body text-moonlight', className)}>{children}</p>;
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-6 pt-2', className)}>{children}</div>;
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex items-center justify-end gap-2 border-t border-ink/10 px-6 py-4', className)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat tile — key numbers on the dashboard
// ---------------------------------------------------------------------------

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** The single accent number on a page. */
  accent?: boolean;
  tone?: Tone;
  className?: string;
}

export function StatTile({ label, value, hint, accent = false, tone, className }: StatTileProps) {
  const color = accent ? 'var(--color-accent-ink)' : tone ? TONE_COLORS[tone] : 'var(--color-ink)';
  return (
    <div className={cn('glass-tile p-6', className)}>
      <p className="type-label">{label}</p>
      <p
        className="mt-3 text-[40px] font-semibold leading-none tracking-[-0.02em] tabular-nums"
        style={{ color }}
      >
        {value}
      </p>
      {hint ? <p className="mt-2 text-xs text-moonlight">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

export function Spinner({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-9 w-9' };
  return <Loader2 className={cn('animate-spin text-moonlight', sizes[size], className)} aria-hidden />;
}

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <Spinner size="lg" />
      {label ? <p className="type-label">{label}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom border-collapse text-sm text-ink/90', className)}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-ink/5">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr
      className={cn(
        'border-b border-ink/10 transition-colors duration-300 last:border-b-0 hover:bg-ink/5',
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TH({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn('type-label whitespace-nowrap px-4 py-3 text-left', className)}>
      {children}
    </th>
  );
}

export function TD({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn('px-4 py-3 align-middle', className)}>
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// PageHeader
// ---------------------------------------------------------------------------

export interface PageHeaderProps {
  /** Small uppercase eyebrow above the title. */
  label?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function PageHeader({ label, title, description, actions, icon, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {label ? <p className="type-label">{label}</p> : null}
        <div className={cn('flex min-w-0 items-center gap-3', label ? 'mt-2' : '')}>
          {icon ? <span className="shrink-0 text-moonlight">{icon}</span> : null}
          <h1 className="break-words text-[26px] font-semibold leading-[1.15] tracking-[-0.01em] text-ink sm:text-heading">
            {title}
          </h1>
        </div>
        {description ? (
          <p className="mt-2 max-w-2xl text-body text-moonlight">{description}</p>
        ) : null}
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
        'glass flex flex-col items-center justify-center px-8 py-14 text-center sm:py-16',
        className,
      )}
    >
      {icon ? (
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-[18px] border border-ink/15 bg-ink/5 text-moonlight">
          {icon}
        </div>
      ) : null}
      <p className="text-body-lg font-medium text-ink">{title}</p>
      {description ? <p className="mt-2 max-w-md text-body text-moonlight">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
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
      className={cn('glass flex flex-col items-center justify-center px-8 py-12 text-center', className)}
    >
      <AlertTriangle className="mb-4 h-9 w-9 text-warning" aria-hidden />
      <p className="text-body-lg font-medium text-ink">{title ?? t('errors.loadFailed')}</p>
      {error ? (
        <p className="mt-2 max-w-lg break-words text-body text-moonlight">{errorMessage(error)}</p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-6" onClick={onRetry}>
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
    <div className={cn('flex flex-col gap-2', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="type-label">
          {label}
          {required ? <span className="ml-1 text-danger">*</span> : null}
        </label>
      ) : null}
      {children}
      {message ? (
        <p className="text-xs text-danger" role="alert">
          {message}
        </p>
      ) : null}
      {hint && !message ? <p className="text-xs text-moonlight">{hint}</p> : null}
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
      className={cn('glass-flat flex items-start gap-3 rounded-btn px-4 py-3 text-sm', className)}
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
  return <div className={cn('animate-pulse rounded-btn bg-ink/[0.06]', className)} />;
}

export function CloseIcon() {
  return <X className="h-4 w-4" aria-hidden />;
}
