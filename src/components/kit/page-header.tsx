import type { ReactNode } from "react";

/** One H1 per page: title 24/32, description ≤72ch, at most one primary and two secondary actions. */
export function PageHeader({ title, description, actions, meta }: { title: string; description?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="k-ph">
      <div className="k-ph-text">
        <h1 className="k-ph-title">{title}</h1>
        {description && <p className="k-ph-desc">{description}</p>}
        {meta && <div className="k-ph-meta">{meta}</div>}
      </div>
      {actions && <div className="k-ph-actions">{actions}</div>}
    </header>
  );
}
