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
      <div className="relative flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center text-ink">
        <div className="ambient-layer" aria-hidden>
          <div className="ambient-blob ambient-blob--moon" />
          <div className="ambient-blob ambient-blob--accent" />
          <div className="ambient-blob ambient-blob--deep" />
        </div>
        <div className="glass glass-panel relative w-full max-w-lg p-8 sm:p-10">
          <h1 className="text-subheading text-ink">{i18n.t('errorBoundary.title')}</h1>
          <p className="mt-3 text-body text-moonlight">{i18n.t('errorBoundary.description')}</p>
          {this.state.message ? (
            <pre className="glass-flat mt-6 max-w-lg overflow-auto p-4 text-left font-mono text-xs text-moonlight">
              {this.state.message}
            </pre>
          ) : null}
          <button
            type="button"
            className="cta mt-8 inline-flex h-11 items-center justify-center rounded-pill px-6 text-sm font-medium"
            onClick={() => window.location.reload()}
          >
            {i18n.t('errorBoundary.reload')}
          </button>
        </div>
      </div>
    );
  }
}
