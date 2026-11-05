import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '../i18n';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/** Top-level error boundary so a render crash never leaves a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('SubWatch UI crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--background)] px-6 text-center text-[var(--foreground)]">
        <h1 className="text-xl font-semibold">{i18n.t('errorBoundary.title')}</h1>
        <p className="max-w-md text-sm text-[var(--muted-foreground)]">{i18n.t('errorBoundary.description')}</p>
        {this.state.message ? (
          <pre className="max-w-lg overflow-auto rounded-lg bg-[var(--surface-muted)] p-3 text-left text-xs">
            {this.state.message}
          </pre>
        ) : null}
        <button
          type="button"
          className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-[var(--brand-foreground)]"
          onClick={() => window.location.reload()}
        >
          {i18n.t('errorBoundary.reload')}
        </button>
      </div>
    );
  }
}
