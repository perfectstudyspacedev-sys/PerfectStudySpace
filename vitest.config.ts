import { defineConfig } from 'vitest/config'

// Edge functions run in UTC; pin the tests to UTC too so date helpers that read local time
// (e.g. daysBetween) behave the same on every developer machine.
process.env.TZ = 'UTC'

export default defineConfig({
  test: {
    include: ['tests/money/**/*.test.ts', 'tests/registry/**/*.test.ts', 'tests/predeploy/**/*.test.ts'],
    environment: 'node',
  },
})
