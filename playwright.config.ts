import { defineConfig, devices } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'

/**
 * Which port this checkout's dev server uses.
 *
 * `next dev` does NOT pick the port up from .env.local — that file is loaded
 * for application code, after the server has already bound a port — so the
 * value is read here and passed to the CLI explicitly. Without that, two
 * worktrees both land on 3000 and `reuseExistingServer` silently attaches this
 * suite to the OTHER stream's application: green tests against the wrong code.
 */
function resolvePort(): number {
  if (process.env.PORT) return Number(process.env.PORT)
  if (existsSync('.env.local')) {
    const match = readFileSync('.env.local', 'utf8').match(/^\s*PORT\s*=\s*(\d+)\s*$/m)
    if (match?.[1]) return Number(match[1])
  }
  return 3000
}

const PORT = resolvePort()
const baseURL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Explicit --port, not an env var: see resolvePort above.
    command: `pnpm dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
