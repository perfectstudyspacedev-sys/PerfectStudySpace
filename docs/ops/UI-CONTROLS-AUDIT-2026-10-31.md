# UI controls audit — 31 October 2026

The reported branch menu inherited light text while Windows rendered a light native
popup. The previous layout review checked collapsed controls and missed the expanded
menu. This audit checks expanded controls and keyboard behavior as well as page layout.

| Before | After | Why |
| --- | --- | --- |
| Branch options could appear as pale text on white | In-page, explicitly themed branch listbox | Expanded options remain readable independent of native popup styling |
| Other native select options relied on platform defaults | Explicit option/optgroup colors with forced-colors support | Consistent contrast without overriding accessibility system colors |
| Branch switching depended on native-select behavior | Click, arrows, Home/End, typeahead, Enter and Escape supported | Both pointer and keyboard users can choose branches |
| An owner with one branch saw an empty branch heading | The active branch name is shown | The current scope remains visible |
| Notification panel could extend past a phone's left edge | Panel is anchored to the header inside viewport margins | Text and dismissal controls remain reachable |
| Several notification-count bubbles could collide | One total-count badge; type stays visible in the list | The header stays readable during alert bursts |
| Notification Escape/dismiss semantics were incomplete | Escape restores trigger focus; expanded state and descriptive dismiss labels added | Keyboard and assistive-technology behavior is explicit |
| Confirmations reused a heading ID and could lose keyboard focus | Unique heading IDs, dialog focus containment and focus restoration | Multiple dialogs have correct labels and predictable focus |
| Destructive confirmation initially focused the destructive action | Cancel is the default focus, unless an explicit field needs focus | Enter does not accidentally select the destructive action |
| Navigation/dialog closes could unlock the page while another overlay remained | Shared reference-counted body scroll lock | Overlapping overlays restore the prior scroll state correctly |
| Walk-in and end-session dialogs lacked consistent keyboard behavior | Dialog roles, initial focus, Escape and focus restoration; busy dismissal blocked | Daily workflows have the same modal behavior |
| Report chart grids required at least 340 pixels | Responsive grid minimum respects available width | Narrow phones can display the charts without page overflow |
| Referral link tables could expand the whole page | Dedicated horizontal table-scroll container | Wide URLs and columns scroll locally |
| Referral/certificate/family copy buttons could reject silently | Awaited clipboard writes and success/manual-copy feedback | Permission denial and unsupported browsers are handled |

## Verification

- Production build passed; final unit run passed all **128 tests in 10 files**.
- Full predeploy passed during this audit, including all **30 server suites**. No server
  code was changed. The earlier certificate-limit and seat-check-in concurrency failures
  remain documented; a passing run does not prove those intermittent defects repaired.
- Chrome exercised every one of the **22 main workspace routes**, along with signup,
  portal login, certificate and family pages: **53 recorded page/viewport checks**.
- Owner checks used 1440px desktop and 320/390px phones; tablet membership checks used
  768px. Staff mobile navigation and the end-session dialog were checked separately.
- Membership, Revenue, Food, Growth, Learning and Approvals secondary tabs were opened
  at phone width. Expanded branch-menu colors, pointer selection, keyboard selection,
  Escape and scope changes were checked, plus dialog focus/scroll restoration and
  mobile notification bounds. No runtime exceptions were recorded.
- Clipboard permission denial was simulated on the certificate and family pages. Both
  showed a manual-copy fallback without an unhandled promise rejection.
- These account/data checks used synthetic fixtures with Supabase requests intercepted;
  they did not sign into a real account, send messages, rotate real links, make payments
  or change business records. Actual public signup and login rendering are smoke checks
  after deployment, rather than a substitute for authenticated business-flow tests.

Deployment is frontend-only through `pss-ai/all-phases`. No Supabase SQL or Edge Function
deployment is required. Hard-refresh an existing browser tab to load the updated controls.
