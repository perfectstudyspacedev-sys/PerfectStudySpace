# Self-sign-up routing fix — 30 October 2026

An existing link such as `https://perfectstudyspace.pages.dev/join/<code>` could reload
itself forever when `VITE_SIGNUP_SITE_URL=https://perfectstudyspace.pages.dev/join`.
The staff app redirected to the same URL instead of displaying the public form.

Public `/join/<code>` routes now load JoinApp directly and render the form without
redirecting or loading the staff app. Previously shared short `/<12-character-code>`
links also work. Referral links use `/join/<code>?r=<ref>` on either hosting arrangement.

Copy-link buttons default to the current deployment's `/join` route. An explicit
`VITE_SIGNUP_SITE_URL` remains supported:

| Hosting | Build variable |
| --- | --- |
| Current Pages deployment | Unset, `https://perfectstudyspace.pages.dev`, or `https://perfectstudyspace.pages.dev/join` |
| Separate join host | `https://join.perfectstudyspace.in` |

This is a frontend-only fix. No Supabase SQL, secret changes, branch-code rotations or
backend redeployment are required. Existing branch codes remain valid. Deploy the
fixed frontend before expecting the live site's routing to change.

Verification performed on the production build locally with the live backend:

- The supplied link resolves the 100 Feet Road branch and opens the form anonymously.
- One document request, no redirect loop, no staff app bundle and no runtime exceptions.
- Referral query survives; short links open the same form; invalid codes show an error.
- Staff and student login pages still open. No form or payment was submitted to production.
- Build and all 118 unit tests passed, including nine new signup-link regressions.
- Full predeploy remains failed: 29/30 server suites passed. The previously recorded
  concurrent seat check-in defect has not been changed by this frontend fix. Do not
  describe this run as a complete release pass.

After frontend deployment, open the existing branch link in an incognito tab, confirm
the branch name, submit a designated test registration, and confirm it appears under
Membership → Pending sign-ups. Complete that write test on the intended test backend
or with an explicitly designated test person.
