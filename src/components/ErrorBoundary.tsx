import React from "react";
import { t, I18N } from "../i18n";
import { Button } from "./ui/Button";

interface State {
  error: Error | null;
}

/** Last line of defence: a render crash must not leave a blank page. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("uncaught render error:", error, info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div role="alert" className="w-full max-w-md space-y-3 rounded-lg border border-[var(--color-border)] p-6">
          <h1 className="text-xl font-bold">{t(I18N.ERROR_TITLE)}</h1>
          <p className="text-sm text-[var(--color-muted)]">{t(I18N.ERROR_DESC)}</p>
          <Button onClick={() => location.reload()}>{t(I18N.RELOAD)}</Button>
        </div>
      </div>
    );
  }
}
