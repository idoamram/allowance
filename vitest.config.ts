import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Parallel agent sessions run in git worktrees under .claude/worktrees/. Without this
    // the suite collects every lane's in-progress copy of every test — slow, and it fails
    // on code that is mid-edit in another branch.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**', '**/.next/**'],
  },
})
