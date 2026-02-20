import React from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, resetError: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  resetError = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.resetError);
      }

      return (
        <div
          style={{
            padding: '20px',
            background: '#fee',
            border: '2px solid #f99',
            borderRadius: '4px',
            color: '#c00',
            fontFamily: 'monospace',
            marginTop: '20px',
          }}
        >
          <h2>⚠️ Error in Component</h2>
          <details style={{ cursor: 'pointer', marginBottom: '12px' }}>
            <summary style={{ fontWeight: 'bold', marginBottom: '8px' }}>
              {this.state.error.message}
            </summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '12px', overflow: 'auto' }}>
              {this.state.error.stack}
            </pre>
          </details>
          <button
            onClick={this.resetError}
            style={{
              padding: '8px 16px',
              background: '#f99',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
