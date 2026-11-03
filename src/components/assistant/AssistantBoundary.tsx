"use client";

// Keeps an error inside the assistant from taking down the page (it lives in the root
// layout, outside the pages' own error screens), and reports it so it can be fixed.

import { Component, type ReactNode } from "react";
import { reportAssistantClientError } from "./actions";

export class AssistantBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  componentDidCatch(e: unknown, info: { componentStack?: string | null }) {
    reportAssistantClientError(e instanceof Error ? `${e.name}: ${e.message}` : String(e), (info.componentStack ?? "").slice(0, 1500)).catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="assistant-panel glass-modal" role="alert" style={{ height: "auto", padding: "var(--sp-4)" }}>
        <div className="mb-2 font-semibold">The assistant hit an error</div>
        <p className="secondary mb-3 text-sm">{this.state.error}</p>
        <button className="btn btn-secondary" onClick={() => this.setState({ error: null })}>Reopen the assistant</button>
      </div>
    );
  }
}
