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
 * Recessed glass disclosure (`<details>`) for advanced options tucked out of
 * the default form flow. The summary row is keyboard reachable and keeps a
 * visible focus ring.
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
      className={cn('glass-flat group rounded-btn transition-colors duration-500 ease-glass', className)}
    >
      <summary
        className={cn(
          'flex cursor-pointer list-none select-none items-center gap-2 px-4 py-3',
          'type-label transition-colors duration-500 ease-glass hover:text-white',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-night',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 text-moonlight transition-transform duration-500 ease-glass',
            open && 'rotate-90',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1">{title}</span>
        {hint ? (
          <span className="hidden min-w-0 truncate text-xs font-normal normal-case tracking-normal text-moon-steel sm:inline">
            {hint}
          </span>
        ) : null}
      </summary>
      <div className="space-y-4 border-t border-white/10 px-4 py-4">{children}</div>
    </details>
  );
}
