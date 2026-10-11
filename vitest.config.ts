// Unit tests for the pure logic: merging likes and lists, token parsing, the home shelf memory.
// Run with `npm test`. The UI is checked in the browser preview instead.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
