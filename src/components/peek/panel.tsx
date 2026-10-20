// A preview drawer any list can open with ?peek=a_<accountId> or ?peek=p_<contactId>.
// It floats over the right edge, so a page needs no layout change to offer it.

import { CompanyPeek, PersonPeek } from "./peek";

/** `${path}?…&peek=a_<id>`, keeping the page's other params. */
export function peekHref(path: string, params: Record<string, string | undefined>, kind: "a" | "p", id: string) {
  const q = new URLSearchParams(Object.entries({ ...params, peek: `${kind}_${id}` }).filter(([, v]) => v) as [string, string][]);
  return `${path}?${q}`;
}

export function closeHref(path: string, params: Record<string, string | undefined>) {
  const q = new URLSearchParams(Object.entries(params).filter(([k, v]) => k !== "peek" && v) as [string, string][]);
  return q.size ? `${path}?${q}` : path;
}

export async function PeekPanel({ peek, close }: { peek: string | undefined; close: string }) {
  if (!peek) return null;
  const [kind, id] = [peek.slice(0, 1), peek.slice(2)];
  if (!id) return null;
  return <div className="peek-drawer">{kind === "p" ? await PersonPeek({ id, close }) : await CompanyPeek({ id, close })}</div>;
}
