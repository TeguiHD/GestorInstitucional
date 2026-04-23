import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center p-8 bg-background">
          <div className="max-w-md w-full rounded-xl border border-destructive/30 bg-destructive/5 p-6 space-y-3">
            <h1 className="text-lg font-semibold text-destructive">Algo salió mal</h1>
            <p className="text-sm text-muted-foreground">
              Ocurrió un error inesperado. Recarga la página para continuar.
            </p>
            <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-40 text-foreground">
              {this.state.error.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground"
            >
              Recargar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
