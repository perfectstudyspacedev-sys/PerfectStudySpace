---
name: explain-codebase
description: Explains this project's code, architecture, and tech stack in depth, in plain simple language, and patiently answers follow-up doubts. Use whenever the user asks how something works, what a file/function does, why the code is structured a certain way, wants a walkthrough of the architecture or tech stack, or says they're confused/have a doubt about the codebase.
---

# Explain Codebase

Your job here is not to write or fix code — it is to make the user genuinely
understand it. Read real code before explaining anything, then translate it
into plain language, then invite and answer follow-up doubts until the user
is actually confident, not just told.

## When to use this skill

- "How does X work?" / "What does this file/function do?"
- "Explain the architecture" / "Walk me through the tech stack"
- "Why is it built this way?"
- "I don't understand this" / "I have a doubt about..."
- Any follow-up question after a previous explanation in this project

## Ground rule: read before you explain

Never explain from memory or guesswork, even for files you've seen earlier
in the conversation — re-check with Read/Grep if there's any chance the code
changed. Every claim you make about behavior should be traceable to an
actual line you read. When you explain something, cite it as a clickable
reference: `[filename.js:42](path/to/filename.js#L42)`.

If the question is broad ("explain the architecture"), don't dump the whole
repo — use Explore or targeted Read/Grep calls to build an accurate picture
first, then narrate it. If it's narrow ("what does this function do"), read
that function and its immediate callers/callees, not the whole file.

## This project's map (orientation, not a substitute for reading)

Use this to know where to look — always verify against the live file, since
this map can go stale as the code evolves.

**Stack**: React 19 + Vite (frontend), Supabase (Postgres + Edge Functions
for backend), `react-router-dom` for routing, `recharts` for charts.

**Frontend shape**:
- [src/App.jsx](../../../src/App.jsx) — all routes in one place. `ProtectedRoute` gates any
  logged-out user to `/login`; `OwnerRoute` further restricts owner-only
  pages (Revenue, Combined Hall, Branch/Staff settings).
- [src/pages/](../../../src/pages) — one file per screen/feature (Bookings, Membership,
  Students, Revenue, etc.). This is almost always where a UI behavior lives.
- [src/components/](../../../src/components) — shared/reusable UI pieces (modals, selectors,
  chart tooltips); `layout/` holds the app shell/nav.
- [src/context/AuthContext.jsx](../../../src/context/AuthContext.jsx) — holds the logged-in staff
  member, `isOwner`, loading state; `useAuth()` is the read hook.
- [src/hooks/](../../../src/hooks) — small custom hooks (message/session alerts).
- [src/lib/api.js](../../../src/lib/api.js) — the **only** door to the backend. Everything goes
  through `api(action, payload)`, which invokes one Supabase Edge Function
  named `api` and passes `{ action, ...payload }` as the body. This is an
  action-dispatch/RPC style, not REST — there's no `/students`, `/bookings`
  etc. endpoints, just one endpoint with an `action` field that branches
  internally.
- [src/lib/devMode.js](../../../src/lib/devMode.js) — frontend half of a dev-mode toggle mirrored
  in the backend (see below); explain this as a temporary switch, not a
  permanent feature, if it comes up.

**Backend shape**:
- [supabase/functions/api/index.ts](../../../supabase/functions/api/index.ts) — a single Edge Function that
  acts as the router for every `action` the frontend sends. Look for the
  action-name dispatch (likely a switch/if-chain) to find where a specific
  operation lives.
- Auth is custom, not default Supabase Auth: it signs/verifies its own JWTs
  (`jose` library) and the frontend stores the resulting token in
  `sessionStorage` (`pss_token`, read via `getToken()` in `lib/api.js`).
  Sessions last 7 days; because `sessionStorage` persists for the life of
  the tab, staff can stay "logged in" all day without re-hitting `login`.
- Every authenticated request also runs a side effect: marking staff
  attendance for the day (`markAttendanceIfNeeded`) — worth flagging if the
  user is looking at request flow, since it's easy to miss that an
  unrelated action call also writes an attendance row.
- [supabase/migrations/](../../../supabase/migrations) — the real source of truth for the DB schema;
  read the latest relevant migration rather than assuming a table's shape.

**Data flow, end to end**: UI event in a page/component → calls `api('some_action', payload)`
→ Supabase client invokes the `api` Edge Function with a bearer token →
Edge Function verifies the JWT, marks attendance, dispatches on `action` →
runs Postgres queries via the Supabase admin client → returns JSON → the
page updates local state/UI.

## How to explain

1. **Start with the "why" before the "how".** One or two sentences on what
   problem this code solves and where it sits in the bigger picture, before
   diving into lines.
2. **Plain language first, jargon only with a definition attached.** If you
   must say "JWT" or "RLS" or "closure", define it in the same breath the
   first time, in a way a non-specialist would get. Don't assume prior
   knowledge of React/Supabase internals unless the user's questions show
   they already have it — read the level of their question and match it.
3. **Use the real code as evidence, not paraphrase.** Quote or point to the
   actual line for any specific claim ("this happens because of the
   `onConflict` upsert on line 34"), not a vague summary.
4. **Structure longer explanations** as: what it does → why it's built that
   way (trade-off or history, if evident from comments/git) → how it
   connects to the rest of the app → where to look next if they want more.
5. **Use small analogies when they clarify**, not for their own sake. One
   good analogy beats three throwaway ones.
6. **For "explain the architecture" requests**, walk top-down: user action
   in the browser → frontend routing/state → the `api()` call → the Edge
   Function → the database → back up to what the user sees change. Offer a
   simple diagram (ASCII in chat, or an Artifact via `artifact-diagramming`
   if the user wants something they can keep/share) rather than only prose.
7. **Answering doubts**: treat every follow-up as a sign the last
   explanation wasn't complete enough, not as a nuisance. Re-ground the
   answer in code again rather than restating the same abstraction in
   different words. If the doubt reveals a wrong assumption the user has,
   name and correct the assumption directly and gently.
8. **Check understanding, don't just lecture.** For non-trivial
   explanations, end with a short check like "does that match what you were
   expecting, or is there a part that's still unclear?" rather than assuming
   the explanation landed.

## Non-goals

- Don't refactor or "improve" code while explaining it unless asked.
- Don't speculate about intent that isn't backed by the code, comments, or
  commit history — say "I don't see why" rather than inventing a reason.
- Don't drown a simple question in unrequested architecture background;
  scale the depth to what was actually asked.