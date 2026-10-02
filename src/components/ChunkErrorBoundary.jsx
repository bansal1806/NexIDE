import { Component } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

// A lazily loaded chunk failed — almost always because a new version was deployed while
// this tab was open and the old chunk no longer exists.
const STALE_CHUNK = /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch|Loading chunk|Unable to preload/i;

export class ChunkErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`[${this.props.name || 'panel'}] failed to render:`, error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = STALE_CHUNK.test(String(error?.message || error));
    return (
      <div role="alert" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--text-secondary)', fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-primary)', fontWeight: 600 }}>
          <AlertTriangle size={14} />
          {stale ? 'NexIDE was updated' : `${this.props.name || 'This panel'} crashed`}
        </div>
        <div>
          {stale
            ? 'A new version was deployed while this tab was open. Save your work, then reload to continue.'
            : String(error?.message || error)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {stale ? (
            <button className="btn-modal-primary" onClick={() => window.location.reload()} id="btn-reload-app">
              <RefreshCw size={12} /> Reload
            </button>
          ) : (
            <button className="btn-modal-secondary" onClick={() => this.setState({ error: null })}>Try again</button>
          )}
        </div>
      </div>
    );
  }
}
