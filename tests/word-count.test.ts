import { describe, expect, it } from "vitest";
import { readWords } from "@/app/review/body-editor";

describe("draft word count", () => {
  it("counts what the prospect reads, not the unsubscribe footer", () => {
    expect(readWords("Hi Lena,\n\nShort note about vendor onboarding.\n\nTeam Manch\n\nUnsubscribe: reply STOP · 12 MG Road, Bengaluru")).toBe(9);
    expect(readWords("One two three — four")).toBe(4);
    expect(readWords("Worth a call?\n\nTeam Manch\n\nReply \"unsubscribe\" and I won't email again.")).toBe(5);
  });
});
