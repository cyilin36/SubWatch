import { useTranslation } from 'react-i18next';
import { LayoutTemplate } from 'lucide-react';
import type { TemplateKind } from '@subwatch/shared';
import { EmptyState } from '../ui';

/**
 * Replaces the generic entity form while a template is selected but has not
 * been applied yet. Rendering a blank form next to the template parameter card
 * makes it look like both have to be filled in.
 */
export function TemplatePendingCard({ kind }: { kind: TemplateKind }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<LayoutTemplate className="h-7 w-7" aria-hidden />}
      title={t('templates.apply.pendingTitle')}
      description={
        <>
          <span className="block">{t(`templates.apply.pendingHint.${kind}`)}</span>
          <span className="mt-2 block text-xs text-moon-steel">{t('templates.apply.pendingSkip')}</span>
        </>
      }
    />
  );
}
