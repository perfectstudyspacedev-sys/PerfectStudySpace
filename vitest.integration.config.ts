import { defineConfig } from 'vitest/config'

process.env.TZ = 'UTC'

// Appendix A part 2: runs against a local Supabase (`supabase start`, needs Docker). Each test
// skips itself when no local Supabase is reachable. Required before Phase 2 ships.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
})
