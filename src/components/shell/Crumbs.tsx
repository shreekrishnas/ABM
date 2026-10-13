import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** Drill-down trail: every level up is one click away. The last item is the current page. */
export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol>
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i}>
              {it.href && !last ? <Link href={it.href}>{it.label}</Link> : <span aria-current={last ? "page" : undefined}>{it.label}</span>}
              {!last && <ChevronRight size={13} aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
