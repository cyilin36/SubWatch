import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
  ariaLabel?: string;
  invalid?: boolean;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  id,
  name,
  className,
  ariaLabel,
  invalid,
}: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled} name={name}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn(
          'field flex h-11 items-center justify-between gap-2 px-4 text-left',
          'data-[placeholder]:text-moonlight',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-4 w-4 shrink-0 text-moonlight" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={8}
          className="glass-popover z-[60] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden p-1.5"
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-btn px-3 py-2 text-sm text-ink/85 outline-none',
                  'data-[highlighted]:bg-ink/10 data-[highlighted]:text-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                )}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ml-auto inline-flex items-center">
                  <Check className="h-3.5 w-3.5 text-moonlight" aria-hidden />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
