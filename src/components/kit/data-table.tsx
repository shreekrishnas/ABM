import type { ReactNode } from "react";
import { EmptyState, SkeletonRows } from "./feedback";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** 1 = always shown; 2 = hidden below 1024px; 3 = hidden below 1280px. */
  priority?: 1 | 2 | 3;
  align?: "left" | "right";
  /** Shown as the card's title on phones. */
  primary?: boolean;
}

/**
 * The one table. Owns its horizontal scroll (the page never scrolls sideways); below 768px each
 * row becomes a card with label/value pairs, so nothing is squeezed into a narrow column.
 */
export function DataTable<T>({ columns, rows, rowKey, empty, loading, caption }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty?: { title: string; text?: string; action?: ReactNode }; loading?: boolean; caption?: string }) {
  if (loading) return <div className="k-table-wrap"><SkeletonRows rows={6} /></div>;
  if (!rows.length) return <div className="k-table-wrap"><EmptyState title={empty?.title ?? "Nothing here yet"} text={empty?.text} action={empty?.action} /></div>;
  const cls = (c: Column<T>) => `p${c.priority ?? 1}${c.align === "right" ? " num" : ""}`;
  return (
    <div className="k-table-wrap">
      <table className="k-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={cls(c)}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => <td key={c.key} className={`${cls(c)}${c.primary ? " primary" : ""}`} data-label={c.header}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
