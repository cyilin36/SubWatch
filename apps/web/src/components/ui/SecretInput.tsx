import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SECRET_KEEP } from '@subwatch/shared';
import { cn } from '../../lib/utils';
import { Button, Input } from './primitives';

export interface SecretInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** True when the server returned a stored secret (masked as SECRET_KEEP). */
  hasStoredValue?: boolean;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  className?: string;
  invalid?: boolean;
  onBlur?: () => void;
}

/**
 * Password-style input with reveal toggle. When the server has a stored secret
 * it is represented by the shared SECRET_KEEP sentinel: the input shows a
 * placeholder and offers an explicit "change" action, so an untouched form
 * keeps the stored value.
 */
export function SecretInput({
  id,
  value,
  onChange,
  hasStoredValue = false,
  placeholder,
  autoComplete = 'new-password',
  disabled,
  className,
  invalid,
  onBlur,
}: SecretInputProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const keeping = hasStoredValue && value === SECRET_KEEP;

  if (keeping) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Input
          id={id}
          value=""
          placeholder="••••••••••••"
          disabled
          autoComplete="off"
          className="flex-1"
        />
        <Button variant="outline" size="sm" onClick={() => onChange('')}>
          {t('common.change')}
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        invalid={invalid}
        className="pr-11"
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-moonlight transition-colors hover:bg-ink/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/50"
        aria-label={visible ? 'Hide secret' : 'Show secret'}
        tabIndex={-1}
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}
