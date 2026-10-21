// PSS-AI P2.4 A3 — onboarding: with pssai_auto_approve on, a new student picks a plan on the
// sign-up page and pays by UPI; the owner's confirmation registers them through the existing
// create_membership. (Built in P2c.)
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";

/** What confirming a registration payment runs. */
export async function registrationAction(_ctx: Ctx, _proof: any): Promise<{ name: string; payload: any } | { error: string }> {
  return { error: "Registration payments are not supported yet" };
}

export function handlers(): Record<string, Handler> {
  return {};
}
