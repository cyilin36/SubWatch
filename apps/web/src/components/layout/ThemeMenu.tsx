import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useTranslation } from 'react-i18next';
import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import type { Theme } from '@subwatch/shared';
import { cn } from '../../lib/utils';
import { useAuth } from '../../providers/AuthProvider';

const MENU_CONTENT = 'glass-popover z-[70] min-w-44 overflow-hidden p-1.5';
const MENU_ITEM =
  'flex cursor-pointer select-none items-center justify-between gap-3 rounded-btn px-3 py-2 text-sm text-ink/85 outline-none transition-colors data-[highlighted]:bg-ink/10 data-[highlighted]:text-ink';

const OPTIONS: { value: Theme; labelKey: string; icon: LucideIcon }[] = [
  { value: 'light', labelKey: 'theme.light', icon: Sun },
  { value: 'dark', labelKey: 'theme.dark', icon: Moon },
  { value: 'system', labelKey: 'theme.system', icon: Monitor },
];

/**
 * Appearance switcher: Night Glass, Day Glass, or follow the operating system.
 * The preference is stored per browser, so every member of a household can keep
 * their own.
 */
export function ThemeMenu({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { theme, resolvedTheme, setTheme } = useAuth();

  const TriggerIcon = theme === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t('nav.theme')}
          title={t('nav.theme')}
          className={cn(
            'rounded-full p-2 text-moonlight transition-colors hover:bg-ink/10 hover:text-ink',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink/60',
            className,
          )}
        >
          <TriggerIcon className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={10} className={MENU_CONTENT}>
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = theme === option.value;
            return (
              <DropdownMenu.Item
                key={option.value}
                className={MENU_ITEM}
                onSelect={() => setTheme(option.value)}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 text-moonlight" aria-hidden />
                  {t(option.labelKey)}
                </span>
                {active ? <Check className="h-3.5 w-3.5 text-moonlight" aria-hidden /> : null}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
