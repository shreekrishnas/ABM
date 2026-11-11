"use client";

import { Toggle } from "@/components/toggle";
import { switchModeAction } from "@/app/login/actions";

/** The Super Admin ↔ User switch in the top bar (shown only to people who can be Super Admin). */
export function SuperAdminSwitch({ on }: { on: boolean }) {
  return <Toggle on={on} label="Super Admin" showLabel size="sm" onChange={(next) => switchModeAction(next ? "super" : "user")} />;
}
