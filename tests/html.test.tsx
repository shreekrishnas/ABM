import { describe, expect, it } from "vitest";
import { renderHtml } from "@/lib/html";

describe("renderHtml", () => {
  it("escapes text and attribute values", () => {
    expect(renderHtml(<p title={'a "b" <c>'}>{"x < y & z"}</p>)).toBe('<p title="a &quot;b&quot; &lt;c&gt;">x &lt; y &amp; z</p>');
  });

  it("renames React props and kebab-cases SVG attributes", () => {
    expect(renderHtml(<svg className="i" viewBox="0 0 12 12"><path strokeWidth="1.5" strokeLinecap="round" fillRule="evenodd" d="M1 1" /></svg>)).toBe(
      '<svg class="i" viewBox="0 0 12 12"><path stroke-width="1.5" stroke-linecap="round" fill-rule="evenodd" d="M1 1"></path></svg>',
    );
    expect(renderHtml(<meta charSet="utf-8" />)).toBe('<meta charset="utf-8">');
    expect(renderHtml(<link rel="preconnect" href="https://x.example" crossOrigin="" />)).toBe('<link rel="preconnect" href="https://x.example" crossorigin="">');
  });

  it("writes style objects, keeping custom properties", () => {
    expect(renderHtml(<div style={{ ["--ax" as string]: "24px", marginTop: 8 }} />)).toBe('<div style="--ax:24px;margin-top:8"></div>');
  });

  it("keeps data and aria attributes, drops false and null, writes true as empty", () => {
    expect(renderHtml(<span data-step aria-hidden="true" hidden={false} title={undefined} data-tone={3} />)).toBe('<span data-step="" aria-hidden="true" data-tone="3"></span>');
  });

  it("calls function components, flattens fragments and arrays, and writes raw inner HTML", () => {
    const B = ({ n }: { n: number }) => <b>{n}</b>;
    expect(renderHtml(<>{[1, 2].map((n) => <B key={n} n={n} />)}<script dangerouslySetInnerHTML={{ __html: "a<b" }} /></>)).toBe("<b>1</b><b>2</b><script>a<b</script>");
  });
});
