// The shared vocabulary of the JARVIS engine: every way in (chat, the background loop, events)
// describes work as a tool call with a context, and every call is decided by the same policy.
import type { z } from "zod";
import type { Role } from "@/lib/roles";

/** 0 read · 1 acts freely · 2 acts then tells · 3 asks first */
export type Level = 0 | 1 | 2 | 3;
export type Origin = "chat" | "loop" | "event";
export type ActionStatus = "planned" | "awaiting_approval" | "running" | "done" | "failed" | "cancelled" | "undone";

export interface AgentContext {
  /** The client the work is for. Every tool runs scoped to this client only. */
  sellerId: string;
  /** Who is acting: a person's email, or jarvis@system. */
  actor: string;
  origin: Origin;
  /** The person's standing (absent for background work). */
  me?: { superAdmin: boolean; superAdminClients: string[] | null; clients: { id: string; role: Role }[] } | null;
  conversationId?: string | null;
  /** The event or message that caused this call; part of the idempotency key. */
  trigger?: string;
  /** Highest level this way in may run directly. Chat in step 1: 0 (read-only). */
  maxLevel: Level;
}

export interface AgentTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  input: S;
  level: Level;
  /** Minimum client role for a person to run it (Super Admins covering the client always may). */
  minRole: Role;
  /** Spends money (research, data lookups, AI). Checked against the client's budget first. */
  estimateCostUsd?: (input: z.infer<S>) => number;
  /** Can be reversed by a later undo action. Anything sent outside the app never is. */
  reversible: boolean;
  /** Reaches a person outside (email, LinkedIn): suppression is always checked. */
  contactsPeople?: boolean;
  /** Which company / person the call is about, for the log and the account context. */
  target?: (input: z.infer<S>) => { accountId?: string | null; contactId?: string | null };
  run: (input: z.infer<S>, ctx: AgentContext) => Promise<unknown>;
  undo?: (result: unknown, ctx: AgentContext) => Promise<void>;
}

export const SYSTEM_ACTOR = "jarvis@system";
