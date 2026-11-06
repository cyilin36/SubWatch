import { useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface CollapsibleProps {
  title: ReactNode;
  /** Short muted hint rendered on the summary row (hidden on small screens). */
  hint?: ReactNode;
  children: ReactNode;
  /** Render expanded on first paint. */
  defaultOpen?: boolean;
  /** Expand automatically as soon as it becomes true (e.g. a validation error). */
  forceOpen?: boolean;
  className?: string;
}

/**
 * Small native `<details>` disclosure styled like the rest of the form cards.
 * Used to tuck advanced options out of the default form flow.
 */
export function Collapsible({
  title,
  hint,
  children,
  defaultOpen = false,
  forceOpen = false,
  className,
}: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen || forceOpen);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setOpen(event.currentTarget.open);
  };

  return (
    <details
      open={open}
      onToggle={handleToggle}
      className={cn('rounded-lg border border-[var(--border)]', className)}
    >
      <summary
        className={cn(
          'flex cursor-pointer list-none select-none items-center gap-1.5 px-3 py-2',
          'text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]',
          'hover:text-[var(--foreground)] [&::-webkit-details-marker]:hidden',
        )}
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')}
          aria-hidden
        />
        <span className="min-w-0 flex-1">{title}</span>
        {hint ? (
          <span className="hidden min-w-0 truncate text-[11px] font-normal normal-case tracking-normal text-[var(--muted-foreground)] sm:inline">
            {hint}
          </span>
        ) : null}
      </summary>
      <div className="space-y-4 border-t border-[var(--border)] px-3 py-3">{children}</div>
    </details>
  );
}
