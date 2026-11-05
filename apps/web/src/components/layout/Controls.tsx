import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useTranslation } from 'react-i18next';
import { Check, Languages, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '../ui';
import { useAuth } from '../../providers/AuthProvider';
import { cn } from '../../lib/utils';

const MENU_CONTENT =
  'z-[70] min-w-36 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 text-[var(--foreground)] shadow-lg';

const MENU_ITEM =
  'flex cursor-pointer select-none items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-[var(--surface-muted)]';

export function LanguageMenu() {
  const { t, i18n } = useTranslation();
  const { setLanguage } = useAuth();
  const options = [
    { value: 'zh-CN' as const, label: '中文' },
    { value: 'en' as const, label: 'English' },
  ];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('nav.language')} title={t('nav.language')}>
          <Languages className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className={MENU_CONTENT}>
          {options.map((option) => (
            <DropdownMenu.Item
              key={option.value}
              className={MENU_ITEM}
              onSelect={() => {
                void setLanguage(option.value);
              }}
            >
              <span>{option.label}</span>
              {i18n.language === option.value ? (
                <Check className="h-3.5 w-3.5 text-[var(--brand)]" aria-hidden />
              ) : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function ThemeMenu() {
  const { t } = useTranslation();
  const { theme, resolvedTheme, setTheme } = useAuth();
  const options = [
    { value: 'light' as const, labelKey: 'theme.light', icon: Sun },
    { value: 'dark' as const, labelKey: 'theme.dark', icon: Moon },
    { value: 'system' as const, labelKey: 'theme.system', icon: Monitor },
  ];
  const TriggerIcon = resolvedTheme === 'dark' ? Moon : Sun;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('nav.theme')}
          title={t('nav.theme')}
        >
          <TriggerIcon className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className={MENU_CONTENT}>
          {options.map((option) => {
            const Icon = option.icon;
            return (
              <DropdownMenu.Item
                key={option.value}
                className={MENU_ITEM}
                onSelect={() => setTheme(option.value)}
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4" aria-hidden />
                  {t(option.labelKey)}
                </span>
                {theme === option.value ? (
                  <Check className="h-3.5 w-3.5 text-[var(--brand)]" aria-hidden />
                ) : null}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function IconMenuSeparator() {
  return <span className="mx-0.5 h-5 w-px bg-[var(--border)]" aria-hidden />;
}

export function DropdownItem({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <DropdownMenu.Item className={cn(MENU_ITEM)} onSelect={onSelect}>
      {children}
    </DropdownMenu.Item>
  );
}
