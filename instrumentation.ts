/**
 * Runs once, in the server process, before it serves anything.
 *
 * Its only job is the end-to-end suite's provider. Playwright cannot call into
 * the Next server to install a test double, and F9 must not reach Anthropic
 * from a test run — so playwright.config.ts starts the dev server with
 * AI_FAKE_PROVIDER=1 and this hook puts the scripted provider in place before
 * the first request. Everything else about the run is the real application.
 *
 * Three conditions, in the order that makes the last one unreachable by
 * accident: the edge runtime imports this file too and has no Node built-ins; a
 * production build must never contain a working path to a test double, even one
 * behind an environment variable somebody could set; and without the flag a
 * developer's `pnpm dev` behaves exactly as it did before this file existed.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NODE_ENV === 'production') return
  if (process.env.AI_FAKE_PROVIDER !== '1') return

  const { installScriptedAiProvider } = await import('@/lib/ai/testing/scripted-provider')
  installScriptedAiProvider()
}
