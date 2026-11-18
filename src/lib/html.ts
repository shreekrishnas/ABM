// A small JSX-to-HTML serializer for pages served as plain HTML from a route handler (Home).
// Next refuses react-dom/server there, and loading it at run time fails on Vercel (the package is
// not in the function bundle), so the page's elements are written out here instead.
import type { ReactNode } from "react";

type El = { type: unknown; props: Record<string, unknown> };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RENAME: Record<string, string> = { className: "class", htmlFor: "for", charSet: "charset", crossOrigin: "crossorigin", httpEquiv: "http-equiv", tabIndex: "tabindex", autoComplete: "autocomplete" };
// SVG presentation attributes written in camelCase in JSX; viewBox and preserveAspectRatio stay as they are.
const KEEP_CASE = new Set(["viewBox", "preserveAspectRatio"]);

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function attrName(k: string): string {
  if (RENAME[k]) return RENAME[k];
  if (k.startsWith("data-") || k.startsWith("aria-") || KEEP_CASE.has(k)) return k;
  return k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function styleText(style: Record<string, unknown>): string {
  return Object.entries(style)
    .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== "")
    .map(([k, v]) => `${k.startsWith("--") ? k : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${String(v)}`)
    .join(";");
}

function attrs(props: Record<string, unknown>): string {
  let out = "";
  for (const [k, v] of Object.entries(props)) {
    if (k === "children" || k === "key" || k === "ref" || k === "dangerouslySetInnerHTML") continue;
    if (v === null || v === undefined || v === false || typeof v === "function") continue;
    if (k === "style" && typeof v === "object") {
      const css = styleText(v as Record<string, unknown>);
      if (css) out += ` style="${escapeHtml(css)}"`;
      continue;
    }
    out += v === true ? ` ${attrName(k)}=""` : ` ${attrName(k)}="${escapeHtml(String(v))}"`;
  }
  return out;
}

/** Writes JSX (plain elements, fragments and plain function components) as an HTML string. */
export function renderHtml(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return escapeHtml(String(node));
  if (Array.isArray(node)) return node.map(renderHtml).join("");
  const el = node as unknown as El;
  if (typeof el !== "object" || !("type" in el)) return "";
  const props = el.props ?? {};
  if (typeof el.type === "function") return renderHtml((el.type as (p: unknown) => ReactNode)(props));
  if (typeof el.type !== "string") return renderHtml(props.children as ReactNode); // Fragment
  const tag = el.type;
  const open = `<${tag}${attrs(props)}>`;
  if (VOID.has(tag)) return open;
  const inner = props.dangerouslySetInnerHTML as { __html?: string } | undefined;
  return `${open}${inner?.__html ?? renderHtml(props.children as ReactNode)}</${tag}>`;
}
