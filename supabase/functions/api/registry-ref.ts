// The joined registry, for domain handlers that run another registry action (approvals, payment
// confirmation, portal holds). actions.ts sets it once at start-up; importing it from here avoids
// an import cycle between actions.ts and the domains.
import type { ActionDef } from "./registry.ts";

let registry: Map<string, ActionDef> | null = null;
export function setRegistry(r: Map<string, ActionDef>) { registry = r; }
export function actionDef(name: string): ActionDef {
  const def = registry?.get(name);
  if (!def) throw new Error(`Action ${name} is not registered`);
  return def;
}
