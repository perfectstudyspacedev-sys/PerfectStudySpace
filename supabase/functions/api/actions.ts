// Joins the registry metadata to the domain handlers. Refuses to start if an action has no
// handler, a handler is not registered, or two domains claim the same action.
import { ACTION_META, type ActionDef, type Handler } from "./registry.ts";
import { setRegistry } from "./registry-ref.ts";
import { handlers as authHandlers } from "./domains/auth.ts";
import { handlers as branchesHandlers } from "./domains/branches.ts";
import { handlers as enquiriesHandlers } from "./domains/enquiries.ts";
import { handlers as foodHandlers } from "./domains/food.ts";
import { handlers as insightsHandlers } from "./domains/insights.ts";
import { handlers as membersHandlers } from "./domains/members.ts";
import { handlers as moneyHandlers } from "./domains/money.ts";
import { handlers as portalHandlers } from "./domains/portal.ts";
import { handlers as paymentsHandlers } from "./domains/payments.ts";
import { handlers as requestsHandlers } from "./domains/requests.ts";
import { handlers as onboardingHandlers } from "./domains/onboarding.ts";
import { handlers as chatHandlers } from "./domains/chat.ts";
import { handlers as outreachHandlers } from "./domains/outreach.ts";
import { handlers as noticesHandlers } from "./domains/notices.ts";
import { handlers as pricingHandlers } from "./domains/pricing.ts";
import { handlers as seatsHandlers } from "./domains/seats.ts";
import { handlers as leadsHandlers } from "./domains/leads.ts";
import { handlers as referralsHandlers } from "./domains/referrals.ts";
import { handlers as examsHandlers } from "./domains/exams.ts";
import { handlers as reportsHandlers } from "./domains/reports.ts";
import { handlers as sessionsHandlers } from "./domains/sessions.ts";
import { handlers as signupHandlers } from "./domains/signup.ts";
import { handlers as staffHandlers } from "./domains/staff.ts";
import { handlers as systemHandlers } from "./domains/system.ts";

const all: Record<string, Handler> = {};
for (const set of [authHandlers(), branchesHandlers(), enquiriesHandlers(), foodHandlers(), membersHandlers(), moneyHandlers(), reportsHandlers(), sessionsHandlers(), signupHandlers(), staffHandlers(), systemHandlers(), insightsHandlers(), portalHandlers(), paymentsHandlers(), requestsHandlers(), onboardingHandlers(), chatHandlers(), outreachHandlers(), noticesHandlers(), pricingHandlers(), seatsHandlers(), leadsHandlers(), referralsHandlers(), examsHandlers()]) {
  for (const [name, handler] of Object.entries(set)) {
    if (all[name]) throw new Error(`Action ${name} is handled twice`);
    all[name] = handler;
  }
}

export const REGISTRY = new Map<string, ActionDef>();
for (const meta of ACTION_META) {
  const handler = all[meta.name];
  if (!handler) throw new Error(`Registered action ${meta.name} has no handler`);
  REGISTRY.set(meta.name, { ...meta, handler });
}
for (const name of Object.keys(all)) {
  if (!REGISTRY.has(name)) throw new Error(`Action ${name} has a handler but is not registered`);
}
setRegistry(REGISTRY);
