import { Toaster } from 'sonner';
import { useAuth } from '../../providers/AuthProvider';

/**
 * Sonner renders outside the component tree it toasts for, so its colours are
 * passed as the design tokens and re-resolved whenever the appearance changes.
 */
export function GlassToaster() {
  const { resolvedTheme } = useAuth();
  return (
    <Toaster
      position="top-right"
      theme={resolvedTheme}
      closeButton
      toastOptions={{
        classNames: { toast: 'glass-popover' },
        style: {
          background: 'var(--color-glass-popover)',
          border: '1px solid var(--color-line)',
          borderRadius: '16px',
          color: 'var(--color-ink)',
          boxShadow: 'var(--shadow-popover)',
          backdropFilter: 'blur(40px) saturate(180%)',
        },
      }}
    />
  );
}
