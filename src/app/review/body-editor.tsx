"use client";

import { useState } from "react";

/** Count the words a prospect reads: the body up to the unsubscribe/footer lines. */
export function readWords(body: string): number {
  const cut = body.search(/\n\s*(reply\s+["“]?(unsubscribe|stop)|unsubscribe|to stop receiving|opt out)/i);
  const text = cut >= 0 ? body.slice(0, cut) : body;
  return text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}

/** The draft body, tall enough to read in full, with a live word count against the account's limit. */
export function BodyEditor({ name, initial, limit }: { name: string; initial: string; limit: number | null }) {
  const [value, setValue] = useState(initial);
  const words = readWords(value);
  const over = limit != null && words > limit;
  // Tall enough for the whole email, counting long lines that wrap (~60 characters a line).
  const rows = Math.min(36, Math.max(8, value.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 60)), 0) + 1));
  return (
    <>
      <textarea name={name} value={value} onChange={(e) => setValue(e.target.value)} className="glass-textarea dz-body-text" rows={rows} aria-describedby="dz-words" />
      <span id="dz-words" className={`dz-words${over ? " over" : ""}`}>{words} words{limit != null ? (over ? ` · over the ${limit}-word limit in the tone rules` : ` · limit ${limit}`) : ""}</span>
    </>
  );
}
