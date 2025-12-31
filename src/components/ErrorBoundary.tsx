// src/components/ErrorBoundary.tsx
// Error boundary to catch and display React render errors

import { Component, ReactNode, ErrorInfo } from "react";
import { FaExclamationTriangle, FaSync } from "react-icons/fa";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error("ErrorBoundary caught error:", error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            padding: 16,
            margin: 8,
            background: "rgba(255, 100, 100, 0.1)",
            border: "1px solid rgba(255, 100, 100, 0.3)",
            borderRadius: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
              color: "#ff6b6b",
            }}
          >
            <FaExclamationTriangle size={16} />
            <span style={{ fontWeight: "bold", fontSize: 14 }}>
              Something went wrong
            </span>
          </div>

          <div
            style={{
              fontSize: 11,
              color: "#888",
              marginBottom: 12,
              wordBreak: "break-word",
            }}
          >
            {this.state.error?.message || "An unexpected error occurred"}
          </div>

          {this.state.errorInfo && (
            <details style={{ marginBottom: 12 }}>
              <summary
                style={{
                  fontSize: 10,
                  color: "#666",
                  cursor: "pointer",
                  marginBottom: 4,
                }}
              >
                Error details
              </summary>
              <pre
                style={{
                  fontSize: 9,
                  color: "#666",
                  backgroundColor: "rgba(0,0,0,0.3)",
                  padding: 8,
                  borderRadius: 4,
                  overflow: "auto",
                  maxHeight: 100,
                  whiteSpace: "pre-wrap",
                }}
              >
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}

          <button
            onClick={this.handleReset}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              background: "rgba(77, 171, 247, 0.2)",
              border: "1px solid rgba(77, 171, 247, 0.4)",
              borderRadius: 4,
              color: "#4dabf7",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            <FaSync size={10} />
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
