import { cn } from '../../lib/utils';

/**
 * SubWatch wordmark. Glass tile, accent waveform: the only place the accent
 * colour appears outside the primary call to action.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'brand-mark relative flex h-9 w-9 shrink-0 items-center justify-center rounded-btn',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-accent-ink">
        <path
          d="M3 12h4l2.5-6 4 12L16 12h5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
