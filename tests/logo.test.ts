import { describe, expect, it } from "vitest";
import { logoFromInput } from "@/lib/logo";

describe("account logo input", () => {
  it("keeps an image link, turns a website into its icon, clears on blank, rejects junk", () => {
    expect(logoFromInput("https://cdn.example.com/brand/logo.svg")).toEqual({ url: "https://cdn.example.com/brand/logo.svg" });
    expect(logoFromInput("www.example.com")).toEqual({ url: "https://www.google.com/s2/favicons?domain=example.com&sz=128" });
    expect(logoFromInput("https://example.com/about")).toEqual({ url: "https://www.google.com/s2/favicons?domain=example.com&sz=128" });
    expect(logoFromInput("  ")).toEqual({ url: null });
    expect(logoFromInput("not a site")).toHaveProperty("error");
  });
});
