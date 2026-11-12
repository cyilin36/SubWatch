import { useTranslation } from 'react-i18next';
import { LayoutTemplate } from 'lucide-react';
import type { TemplateKind } from '@subwatch/shared';
import { Card } from '../ui';

/**
 * Replaces the generic entity form while a template is selected but has not
 * been applied yet. Rendering a blank form next to the template parameter card
 * makes it look like both have to be filled in.
 */
export function TemplatePendingCard({ kind }: { kind: TemplateKind }) {
  const { t } = useTranslation();
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <LayoutTemplate className="h-8 w-8 text-[var(--muted-foreground)]" aria-hidden />
      <p className="text-base font-medium">{t('templates.apply.pendingTitle')}</p>
      <p className="max-w-md text-sm text-[var(--muted-foreground)]">
        {t(`templates.apply.pendingHint.${kind}`)}
      </p>
      <p className="text-xs text-[var(--muted-foreground)]">{t('templates.apply.pendingSkip')}</p>
    </Card>
  );
}
