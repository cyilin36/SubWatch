import { cn } from '../../lib/utils';

/**
 * SubWatch wordmark. Glass tile, champagne waveform: the only place the accent
 * colour appears outside the primary call to action.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-btn border border-white/20 bg-white/10',
        'shadow-[0_8px_24px_rgba(3,7,18,0.5),inset_0_1px_0_rgba(255,255,255,0.3)] backdrop-blur-xl',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-champagne">
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
