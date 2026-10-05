import type { Adapters } from "./types";
import { createMockAdapters } from "./mock";

// Real adapters plug in here once API keys exist. Stages only see the interfaces.
let instance: Adapters | null = null;

export function getAdapters(): Adapters {
  if (!instance) {
    const mode = process.env.ADAPTER_MODE ?? "mock";
    if (mode !== "mock") {
      throw new Error(`ADAPTER_MODE=${mode} has no live adapters wired yet — see docs/PLAN.md roadmap`);
    }
    instance = createMockAdapters();
  }
  return instance;
}

/** Tests inject their own adapters. */
export function setAdapters(a: Adapters | null) {
  instance = a;
}

export type { Adapters } from "./types";
