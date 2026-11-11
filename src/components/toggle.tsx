"use client";

import { useTransition } from "react";

/** An on/off switch. `onChange` runs with the new value; while it runs the switch shows as busy. */
export function Toggle({ on, label, onChange, disabled, size = "md", showLabel = false }: { on: boolean; label: string; onChange: (next: boolean) => void | Promise<unknown>; disabled?: boolean; size?: "sm" | "md"; showLabel?: boolean }) {
  const [busy, start] = useTransition();
  return (
    <label className={`tg ${size}${disabled ? " disabled" : ""}`}>
      {showLabel && <span className="tg-l">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={showLabel ? undefined : label}
        aria-busy={busy}
        disabled={disabled || busy}
        className={`tg-sw${on ? " on" : ""}${busy ? " busy" : ""}`}
        onClick={() => start(async () => { await onChange(!on); })}
      >
        <i />
      </button>
    </label>
  );
}
