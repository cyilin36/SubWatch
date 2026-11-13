import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '../../lib/utils';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  ariaLabel?: string;
}

export function Switch({ checked, onCheckedChange, disabled, id, className, ariaLabel }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-pill border transition-colors duration-300',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-night',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-[rgba(124,156,196,0.55)] bg-[rgba(124,156,196,0.6)]'
          : 'border-white/15 bg-white/10',
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-[0_2px_8px_rgba(3,7,18,0.55)] transition-transform duration-300',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
