/**
 * A provider whose answers are written on the photograph.
 *
 * The end-to-end suite has to prove two things about F9 that only exist once a
 * browser, a server action and a form are all in play: that a number read off a
 * photo lands in the box and is STILL not saved until somebody submits (AC9.1,
 * AC9.6), and that a provider having a bad day changes nothing about typing the
 * numbers in (AC9.4, AC9.5). Both need a provider that answers on demand, and
 * neither may spend money or depend on a network.
 *
 * The obvious shape — a fake installed by the test — does not survive the
 * process boundary: Playwright drives a browser, the provider lives in the Next
 * server. So the script travels the only way the test can already reach that
 * server, which is inside the upload itself. `page.setInputFiles` sends bytes
 * the test chose, this provider reads them, and the answer is whatever those
 * bytes asked for:
 *
 *   RENTEASE-FAKE electric=2650 water=3900 confidence=high
 *   RENTEASE-FAKE fail=network
 *
 * The payoff is that nothing is remembered between requests. There is no
 * "arrange" step to leak into the next test, no order to get right, and two
 * tests that want opposite answers can run in either sequence — the answer is a
 * function of the photo and nothing else.
 *
 * The answer is still put through the request's own schema before it is
 * returned, so this provider cannot produce something the real one could not.
 * A test cannot use it to sneak an impossible reading past the parser.
 */

import { setAiProvider } from '@/lib/ai/provider'
import type { AiProvider, AiRequest, AiResult, AiFailureReason } from '@/lib/ai/types'

/** The word that marks a photograph as a script rather than a meter. */
export const FAKE_MARKER = 'RENTEASE-FAKE'

const FAILURES: readonly AiFailureReason[] = ['no_provider', 'network', 'invalid_output', 'refused']

/** Reads the directive out of an upload, or null when there is none. */
function scriptIn(base64: string): string | null {
  let text: string
  try {
    text = Buffer.from(base64, 'base64').toString('utf8')
  } catch {
    return null
  }
  const at = text.indexOf(FAKE_MARKER)
  if (at === -1) return null
  return text.slice(at + FAKE_MARKER.length).split('\n')[0]?.trim() ?? ''
}

function fieldsOf(script: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const pair of script.split(/\s+/)) {
    const [key, value] = pair.split('=')
    if (key && value !== undefined) fields[key] = value
  }
  return fields
}

function numberOrNull(value: string | undefined): number | null {
  if (value === undefined || value === 'null') return null
  return Number(value)
}

export const scriptedProvider: AiProvider = {
  name: 'scripted',
  async run<T>(request: AiRequest<T>): Promise<AiResult<T>> {
    const image = request.images?.[0]
    const script = image ? scriptIn(image.data) : null

    if (script === null) {
      // A real photo of a real meter, handed to a server that has no model.
      // Saying so is more useful to whoever hit it than inventing a reading.
      return {
        ok: false,
        reason: 'invalid_output',
        message: `this server runs the scripted provider; the upload carries no ${FAKE_MARKER} line`,
      }
    }

    const fields = fieldsOf(script)

    const failure = FAILURES.find((reason) => reason === fields.fail)
    if (failure) return { ok: false, reason: failure, message: 'scripted failure' }

    // Through the caller's own schema, exactly as a real answer goes.
    const parsed = request.schema.safeParse({
      electric: numberOrNull(fields.electric),
      water: numberOrNull(fields.water),
      confidence: fields.confidence ?? 'high',
    })
    if (!parsed.success) {
      return { ok: false, reason: 'invalid_output', message: parsed.error.message }
    }

    return { ok: true, value: parsed.data }
  },
}

/**
 * Installs it, and refuses to exist in production.
 *
 * instrumentation.ts already checks NODE_ENV before importing this module; the
 * throw is here as well because the interesting version of this mistake is a
 * second caller added later by someone who did not read that check.
 */
export function installScriptedAiProvider(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The scripted AI provider is a test double and must never run in production.')
  }
  setAiProvider(scriptedProvider)
}
