import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props { resetKey: string; children: React.ReactNode }
interface State { error: Error | null }

/**
 * Keeps one broken page from blanking the whole dashboard: the sidebar, top bar and alerts keep
 * working, the page shows what failed with "Try again" / "Reload". Navigating to another page
 * (resetKey changes) clears the error.
 */
export class ViewErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[view error]', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // A new deployment replaced the page's code while this tab was open: a reload fixes it
    const staleBundle = /dynamically imported module|Failed to fetch|Importing a module script failed|ChunkLoadError/i.test(error.message);
    return (
      <div role="alert" className="rounded-lg border p-5 font-mono text-xs space-y-3 border-rose-500/40 bg-rose-500/5">
        <div className="flex items-center gap-2 font-bold text-rose-500 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {staleBundle ? 'Scholario Ops was updated — reload to load the new version' : 'This page hit an error'}
        </div>
        <p className="opacity-80 break-words">{error.message || String(error)}</p>
        <p className="opacity-60 font-sans text-[11px]">
          The rest of the dashboard keeps working (monitoring runs on the server). Try again, or reload the page.
        </p>
        <div className="flex gap-2">
          {!staleBundle && (
            <button onClick={() => this.setState({ error: null })} className="px-3 py-1.5 rounded border border-current cursor-pointer hover:opacity-80">
              Try again
            </button>
          )}
          <button onClick={() => window.location.reload()} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 text-white cursor-pointer hover:bg-blue-700">
            <RefreshCw className="w-3.5 h-3.5" />Reload page
          </button>
        </div>
      </div>
    );
  }
}
