import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useTranslation } from 'react-i18next';
import { Check, Languages } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { useAuth } from '../../providers/AuthProvider';

const MENU_CONTENT = 'glass-popover z-[70] min-w-40 overflow-hidden p-1.5';
const MENU_ITEM =
  'flex cursor-pointer select-none items-center justify-between gap-3 rounded-btn px-3 py-2 text-sm text-ink/85 outline-none transition-colors data-[highlighted]:bg-ink/10 data-[highlighted]:text-ink';

/** Language switcher shared by the night nav, the auth layout and error screens. */
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
        <button
          type="button"
          aria-label={t('nav.language')}
          title={t('nav.language')}
          className="rounded-full p-2 text-moonlight transition-colors hover:bg-ink/10 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink/60"
        >
          <Languages className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={10} className={MENU_CONTENT}>
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
                <Check className="h-3.5 w-3.5 text-moonlight" aria-hidden />
              ) : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Small brand header used by centered layouts (auth, connection errors). */
export function LayoutBrand({ appName }: { appName: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      <BrandMark />
      <div className="min-w-0">
        <p className="truncate text-body font-medium leading-tight text-ink">{appName}</p>
        <p className="truncate text-[11px] tracking-[0.14em] text-moonlight uppercase">{t('app.tagline')}</p>
      </div>
    </div>
  );
}
