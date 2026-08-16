# Testing Rules

- Define what success means before implementing non-trivial behavior.
- Prefer tests that exercise real business behavior.
- Add regression coverage for important bug fixes.
- Unit test core logic.
- Integration test boundaries.
- Use E2E/browser tests for critical user journeys.
- Re-run the relevant test suite after changes.
- Do not hide failing tests with skips unless explicitly justified.
- Treat test failures as evidence, not noise.
