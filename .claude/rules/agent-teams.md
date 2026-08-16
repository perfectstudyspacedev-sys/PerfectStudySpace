# Agent Teams Rules

These rules exist because agent teams parallelise work inside **one shared filesystem**. The platform does not prevent teammates from destroying each other's work. These rules do.

## 1. One browser owner per mission — always

The gstack browse daemon is a single persistent Chromium session. Cookies, localStorage, and tabs carry over between commands. Two agents driving it concurrently corrupt each other's session state and produce phantom bugs.

**Browser-driving skills:** `/browse`, `/qa`, `/qa-only`, `/design-review`, `/canary`, `/benchmark`, `/scrape`, `/devex-review`, `/setup-browser-cookies`, `/open-gstack-browser`.

Default owner: **qa-browser-lead**. Everyone else messages them.

## 2. Auto-committing skills never run in a teammate

These fix and commit autonomously — correct solo, destructive in a team:

| Skill | Behaviour |
|---|---|
| `/review` | Auto-fixes obvious findings |
| `/qa` | Fixes bugs with atomic commits |
| `/design-review` | Up to 30 style commits |
| `/skillify` | Commits a synthesised script |
| `/ship` | Syncs main, pushes, opens PR |
| `/land-and-deploy` | Merges and deploys |

Run them in the **lead**, after every implementer has shut down. Teammates use the read-only variants: `/qa-only` instead of `/qa`, findings-reporting instead of `/review` fix mode.

## 3. Every implementer runs /freeze first

File ownership in agent teams is convention only. `/freeze <glob>` blocks Edit and Write outside a boundary and makes it real. It is accident prevention, not a sandbox — Bash paths like `sed` can still escape it.

Never `/unfreeze` to reach across a boundary. Message the owner instead.

## 4. Read-only roles have no Write or Edit

The `tools:` allowlist is the **only per-teammate restriction the platform actually enforces**. Reviewers, investigators, and QA carry no write tools. This is what makes it safe to run them in parallel with implementers.

`permissionMode:` in agent frontmatter does **not** apply — teammates inherit the lead's permission mode at spawn and it cannot be set per-teammate.

## 5. Skills are not bound per teammate

The `skills:` and `mcpServers:` frontmatter fields are **ignored** when a definition runs as a teammate. Teammates load skills from project and user settings, exactly like a normal session — every teammate sees the same pool.

Role specialisation therefore comes from the definition **body** (which skills to reach for), the **tools allowlist** (enforced), and the **ownership map** (convention plus `/freeze`).

## 6. Publish contracts early

If another teammate is blocked on your output — schema shape, API contract, design tokens — message it the moment it settles. Do not wait until your task completes. A blocked teammate burns context idling.

## 7. Report failures; do not route around them

Blocked by someone else's bug? Message them and the lead. Do not implement a workaround in your own files. Two workarounds around one bug is how a codebase rots.

## 8. Team sizing

Start at 3. Three focused teammates outperform five scattered ones. Token cost scales linearly per teammate; each has its own context window.

Use a team for: parallel review, competing-hypothesis debugging, cross-layer features, research.
Use a single session for: sequential work, same-file edits, routine tasks.
