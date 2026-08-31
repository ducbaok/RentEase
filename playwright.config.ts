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
    /*
     * The meter photo tests need a provider that answers, and they must never
     * reach Anthropic — an end-to-end run would spend money and its result
     * would depend on a model's mood. This flag makes instrumentation.ts
     * install the scripted provider, which reads its answer out of the upload
     * itself (lib/ai/testing/scripted-provider.ts). Everything else in the run
     * is the real application.
     *
     * Merged over process.env by Playwright, so .env.local still applies.
     *
     * The one way to lose it is `reuseExistingServer` attaching to a `pnpm dev`
     * you started yourself, which was launched without the flag. Then the
     * camera button is absent and tests/e2e/meter-photo.spec.ts says so by
     * name rather than failing as a mystery.
     */
    env: { AI_FAKE_PROVIDER: '1' },
  },
})
