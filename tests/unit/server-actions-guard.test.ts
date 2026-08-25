import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every Server Action must establish who is asking on the SERVER.
 *
 * This is the promise the product is sold on — "one landlord cannot see
 * another landlord's data" — and the failure mode it guards against is quiet:
 * an action that takes an org id from the form, or forgets the check entirely,
 * looks completely normal in review and passes its own feature tests, because
 * the developer testing it only ever has one organization.
 *
 * Row-level security would still refuse the write, so a lapse here is not by
 * itself a leak. It is how a leak gets one layer closer, and it is cheap to
 * make impossible instead of merely unlikely.
 *
 * Two shapes are accepted, because Batch 1 produced both and both are sound:
 *   - the action calls requireOperator() and passes the org id down (1A), or
 *   - the data function it calls resolves the identity itself (1B).
 *
 * NEW code should prefer the second: an argument can be passed wrongly, while
 * a function that resolves its own caller cannot be called wrongly.
 */

const ACTIONS_DIR = 'app/(dashboard)'
const DATA_DIR = 'lib/data'

function readActionFiles(): Array<{ path: string; source: string }> {
  return readdirSync(ACTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(ACTIONS_DIR, entry.name, 'actions.ts'))
    .filter((path) => {
      try {
        readFileSync(path)
        return true
      } catch {
        return false
      }
    })
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
}

/** Data-layer functions that resolve the caller's identity themselves. */
function selfAuthenticatingDataFunctions(): Set<string> {
  const names = new Set<string>()
  for (const file of readdirSync(DATA_DIR).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(join(DATA_DIR, file), 'utf8')
    if (!source.includes('requireOperator')) continue
    for (const match of source.matchAll(/export async function (\w+)/g)) {
      if (match[1]) names.add(match[1])
    }
  }
  return names
}

function exportedActions(source: string): Array<{ name: string; body: string }> {
  const chunks = source.split(/\nexport async function /).slice(1)
  return chunks.map((chunk) => ({ name: chunk.slice(0, chunk.indexOf('(')), body: chunk }))
}

const actionFiles = readActionFiles()
const selfAuthenticating = selfAuthenticatingDataFunctions()

describe('server actions', () => {
  it('there are actions to check (the guard itself is not silently empty)', () => {
    expect(actionFiles.length).toBeGreaterThan(0)
    expect(actionFiles.flatMap((f) => exportedActions(f.source)).length).toBeGreaterThan(10)
  })

  for (const file of actionFiles) {
    for (const action of exportedActions(file.source)) {
      it(`${file.path} › ${action.name} resolves the organization server-side`, () => {
        if (action.body.includes('requireOperator')) return

        const called = [...action.body.matchAll(/await (\w+)\(/g)]
          .map((m) => m[1])
          .filter((name): name is string => Boolean(name))
        const authenticated = called.filter((name) => selfAuthenticating.has(name))

        expect(
          authenticated,
          `${action.name} neither calls requireOperator() itself nor calls a lib/data function that does. ` +
            `Add requireOperator() to the action, or move the identity lookup into the data function.`,
        ).not.toHaveLength(0)
      })
    }
  }

  it.each(actionFiles)('$path never takes an organization from the request', ({ source }) => {
    // An org id arriving in a form is attacker-controlled. It must always come
    // from the session instead.
    expect(source).not.toMatch(/formData\.get\(\s*['"]org(_id|Id)['"]\s*\)/)
  })
})
