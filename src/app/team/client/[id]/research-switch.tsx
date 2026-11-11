"use client";

import { useState } from "react";
import { Toggle } from "@/components/toggle";
import { setResearchClientAction } from "../../actions";

/** Super Admin: live research (real web search and AI reading) on or off for this client. */
export function ResearchSwitch({ clientId, on, locked }: { clientId: string; on: boolean; locked?: boolean }) {
  const [state, setState] = useState(on);
  const [msg, setMsg] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Toggle on={state} label="Live research" showLabel disabled={locked} onChange={async (next) => { const r = await setResearchClientAction(clientId, next); setMsg(r?.message ?? ""); if (r?.ok) setState(next); }} />
      {msg && <span className="muted text-xs" role="status">{msg}</span>}
    </div>
  );
}
