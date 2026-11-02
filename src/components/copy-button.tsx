"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copies text to the clipboard. Copying records nothing: the person marks the message as sent separately. */
export function CopyButton({ text, className = "btn btn-secondary btn-sm" }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          /* clipboard blocked: the text is still selectable */
        }
      }}
      title="Copy to paste into LinkedIn (this does not mark it as sent)"
    >
      {done ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
    </button>
  );
}
