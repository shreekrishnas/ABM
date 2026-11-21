// FormField ties its label, hint and error to the control. It must stay a shared component (no
// "use client"): Approvals renders it from a Server Component, and a client-only FormField cloned
// server-sent children into invalid elements, crashing the page on every email draft.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { FormField } from "@/components/kit";

describe("FormField", () => {
  it("links the label, hint and error to the control", () => {
    const html = renderToStaticMarkup(<FormField label="Subject" hint="Keep it short" error="Required field" required><input name="subject" /></FormField>);
    const id = html.match(/<input[^>]*\sid="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<label for="${id}">Subject`);
    expect(html).toContain(`aria-describedby="${id}-h ${id}-e"`);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-required="true"');
  });

  it("passes the id on to a custom control component", () => {
    const Box = (p: { id?: string; "aria-describedby"?: string }) => <textarea id={p.id} aria-describedby={p["aria-describedby"]} />;
    const html = renderToStaticMarkup(<FormField label="Body" hint="h"><Box /></FormField>);
    const id = html.match(/<textarea[^>]*\sid="([^"]+)"/)?.[1];
    expect(html).toContain(`<label for="${id}">Body`);
  });

  it("is not a client-only component, so server pages can use it", () => {
    const src = readFileSync("src/components/kit/form-field.tsx", "utf8");
    expect(src).not.toMatch(/^\s*["']use client["']/m);
    expect(readFileSync("src/components/kit/sticky-save-bar.tsx", "utf8")).toMatch(/^"use client"/);
  });
});
