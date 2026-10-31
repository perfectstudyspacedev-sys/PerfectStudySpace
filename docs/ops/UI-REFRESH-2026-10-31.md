# Workspace UI refresh — 31 October 2026

The staff app previously put every destination into one horizontally scrolling row.
Cards, headings, controls and animated highlights competed for attention, while wide
registration and settings layouts were awkward on phones.

This frontend update retains the black-and-gold identity and introduces:

- A searchable sidebar grouped into Daily work, Team & reports, Insights & decisions,
  and Settings. Visibility still follows the original role and feature-flag conditions.
- A compact branch/account header and mobile navigation with a backdrop, Escape close,
  focus containment and focus restoration. Pending signup badges remain available.
- Neutral card borders, quieter surfaces, consistent buttons, readable headings, form
  controls, table spacing, focus states, disabled states and reduced-motion handling.
- Registration sections for student details, plan and payment, with two-column fields
  on wide screens and single-column fields on phones. Existing validation and calculations
  are unchanged. Waitlist now uses the same tab treatment as the other membership views.
- A calmer seat map and dashboard, contained responsive grids on Food, Enquiries, Branches
  and Waitlist, and more readable Analyst conversations and example questions.
- Shared styling for public signup, login, student portal cards and bottom navigation.
- Immediate report chart rendering instead of replaying animations on each visit.

No database migrations, Supabase secrets or Edge Function deployments are required.
Cloudflare Pages rebuilds from `pss-ai/all-phases`.

## Verification

- Production build and all 123 unit tests passed. Five navigation regressions cover owner
  and staff access, disabled features, signup counts, food/stock rules and page search.
- Chrome checks used synthetic account/data fixtures and intercepted Supabase requests.
  No live sign-in, payment, signup or business mutation was performed by these checks.
- Checked Dashboard, Students, Memberships/registration, Analyst, Branches, Live sessions,
  Revenue and Reports at desktop width, plus tablet memberships and phone Students,
  public signup and portal login. Widths checked: 1440, 768, 390 and 320 pixels.
- The mobile menu opens, focuses search, keeps keyboard focus inside, closes with Escape
  or navigation, restores trigger focus and releases the body scroll lock. Sampled pages
  have no whole-page horizontal overflow or browser runtime exceptions.
- Full predeploy is **not a pass**: 29/30 server suites passed. This run failed
  `studentlife_test.ts`, X8, “two taps at the cap make one certificate, not two”, with
  `[429,429]`. The seat suite passed this time; its previously reproduced concurrent
  check-in race remains unresolved. No server code was changed by this UI refresh.

After deployment, hard-refresh the site and check an actual owner and staff account.
Verify branch selection, pending signup badge, table scrolling, registration's custom
plan/payment controls, dialogs and portal navigation on the intended test data.
