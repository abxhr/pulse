import { Component } from "react";
import { AlertTriangle } from "lucide-react";

// Class component is required here — componentDidCatch has no hook equivalent.
// Without this, any render error in a view unmounts the entire app to a blank
// screen instead of just that one page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Pulse view crashed:", error, info);
  }

  componentDidUpdate(prevProps) {
    // Clear the error automatically when the user navigates away (resetKey changes).
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-panel/80 p-8 text-center">
          <AlertTriangle className="text-effort" size={28} />
          <p className="font-display text-sm font-semibold text-txt">This page hit an error</p>
          <p className="max-w-sm text-xs text-muted">
            {String(this.state.error?.message || this.state.error)}
          </p>
          <button onClick={() => window.location.reload()}
            className="mt-1 rounded-lg border border-line bg-panel2 px-4 py-2 text-xs font-medium text-txt transition hover:border-recovery/40">
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
