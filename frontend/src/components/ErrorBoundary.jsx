import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="login-form" role="alert">
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h2>Something went wrong</h2>
          <p className="muted">The page hit an unexpected error. Reload to try again.</p>
          <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
