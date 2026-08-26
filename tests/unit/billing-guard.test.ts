import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Where the plan guard is — and, just as importantly, where it is NOT.
 *
 * AC-S2 and AC-S3 are half a rule each. "Refuse new records" is the easy half
 * and is proved in tests/unit/plan-limits.test.ts. The other half — "never lock
 * the data you already have" — cannot be proved by a pure function, because it
 * is a statement about which call sites exist. A guard added one file too wide
 * would stop a landlord recording the rent they were just handed in cash, and
 * every unit test in the suite would still pass.
 *
 * So this reads the source. It is the same technique as
 * tests/unit/server-actions-guard.test.ts and it exists for the same reason:
 * the failure mode is quiet, review-proof, and expensive.
 *
 * It also covers the billing actions themselves, which the older guard cannot
 * see — that one scans app/(dashboard)/<dir>/actions.ts one level deep, and
 * billing lives at settings/billing/actions.ts.
 */

const BILLING_ACTIONS = 'app/(dashboard)/settings/billing/actions.ts'

/** Create paths that must refuse when the plan says so (AC-S2, AC-S3, D22). */
const GUARDED = [
  ['app/(dashboard)/units/actions.ts', 'createUnitAction', 'unit'],
  ['app/(dashboard)/properties/actions.ts', 'createPropertyAction', 'property'],
  ['app/(dashboard)/tenants/actions.ts', 'createTenantAction', 'tenant'],
  ['app/(dashboard)/leases/actions.ts', 'createLeaseAction', 'lease'],
  ['app/(dashboard)/invoices/actions.ts', 'issueInvoicesAction', 'invoice'],
] as const

/**
 * Paths that must NEVER refuse, whatever the subscription says. Each one is a
 * sentence from AC-S2 or AC-S3 turned into a file name.
 */
const MUST_STAY_OPEN = [
  // "you can still record payments" — the money already owed to the landlord.
  'app/(dashboard)/payments/actions.ts',
  // "your residents keep their portal" — the resident is not our customer and
  // must never be caught by our billing relationship with their landlord.
  'app/(portal)/portal/maintenance/actions.ts',
  // Maintenance moves through its states whatever the plan is doing.
  'app/(dashboard)/maintenance/actions.ts',
  // Rates are edited, not created in volume, and an unpriced period blocks
  // invoicing entirely (D17) — a trial ending must not strand a landlord there.
  'app/(dashboard)/tariffs/actions.ts',
] as const

function source(path: string): string {
  return readFileSync(path, 'utf8')
}

function actionBody(path: string, name: string): string {
  const text = source(path)
  const start = text.indexOf(`export async function ${name}(`)
  expect(start, `${name} not found in ${path}`).toBeGreaterThan(-1)
  const next = text.indexOf('\nexport async function ', start + 1)
  return text.slice(start, next === -1 ? undefined : next)
}

describe('the plan guard is on every create path (AC-S2, AC-S3)', () => {
  it.each(GUARDED)('%s › %s asks for an allowance to create a %s', (path, name, kind) => {
    const body = actionBody(path, name)
    expect(body).toContain('checkCreateAllowance')
    expect(body).toContain(`checkCreateAllowance('${kind}')`)
    // The answer has to be acted on, not merely fetched.
    expect(body).toMatch(/if \(!allowance\.allowed\) return \{ error: allowance\.message \}/)
  })

  it.each(GUARDED)('%s imports the guard from lib/stripe/entitlement', (path) => {
    expect(source(path)).toContain("import { checkCreateAllowance } from '@/lib/stripe/entitlement'")
  })
})

describe('the guard is nowhere near the data a landlord already has', () => {
  it.each(MUST_STAY_OPEN)('%s never refuses on the plan', (path) => {
    // AC-S2: "never lock the data you already have." AC-S3 repeats it: viewing,
    // recording payments and the resident portal all keep working.
    expect(source(path)).not.toContain('checkCreateAllowance')
  })

  it('editing an invoice that was already issued is not a create', () => {
    const body = actionBody('app/(dashboard)/invoices/actions.ts', 'adjustInvoiceAction')
    expect(body).not.toContain('checkCreateAllowance')
  })

  it('ending a lease is not a create either', () => {
    const body = actionBody('app/(dashboard)/leases/actions.ts', 'endLeaseAction')
    expect(body).not.toContain('checkCreateAllowance')
  })

  it('updates and deletes are never guarded', () => {
    for (const [path] of GUARDED) {
      const text = source(path)
      for (const match of text.matchAll(/export async function ((?:update|delete)\w+)\(/g)) {
        const name = match[1]
        if (!name) continue
        expect(actionBody(path, name), `${path} › ${name}`).not.toContain('checkCreateAllowance')
      }
    }
  })
})

describe('the billing actions themselves', () => {
  const text = source(BILLING_ACTIONS)
  const names = [...text.matchAll(/export async function (\w+)\(/g)].map((m) => m[1])

  it('there are actions to check', () => {
    expect(names.length).toBeGreaterThan(0)
  })

  it.each(names)('%s establishes the caller on the server', (name) => {
    expect(actionBody(BILLING_ACTIONS, name!)).toContain('await requireOperator()')
  })

  it.each(names)('%s refuses anyone who is not the owner', (name) => {
    // A Server Action is an HTTP endpoint with a stable id. "The button was not
    // rendered for managers" is not an access rule; this is.
    const body = actionBody(BILLING_ACTIONS, name!)
    expect(body).toMatch(/identity\.role !== 'owner'/)
  })

  it('never takes an organization from the request', () => {
    expect(text).not.toMatch(/formData\.get\(\s*['"]org(_id|Id)['"]\s*\)/)
  })

  it('writes nothing to the subscription itself', () => {
    // Every write goes through the webhook or the reconcile sweep as the service
    // role. `authenticated` holds only SELECT on subscriptions (migration 0700),
    // asserted in supabase/tests/subscription_trial.test.sql.
    expect(text).not.toMatch(/from\(['"]subscriptions['"]\)/)
    expect(text).not.toContain('supabase/admin')
  })
})

describe('the guard resolves the caller itself (D19)', () => {
  const text = source('lib/stripe/entitlement.ts')

  it('checkCreateAllowance takes nothing but the kind of record', () => {
    // An org id parameter is the failure D19 exists to prevent: a limit you can
    // step around by naming a different organization is not a limit.
    expect(text).toContain('export async function checkCreateAllowance(kind: CreateKind)')
  })

  it('no exported function accepts an organization id', () => {
    for (const match of text.matchAll(/export async function \w+\(([^)]*)\)/g)) {
      expect(match[1] ?? '').not.toMatch(/orgId/)
    }
  })

  it('never writes to the subscription it reads', () => {
    for (const verb of ['.insert(', '.update(', '.upsert(', '.delete(']) {
      expect(text, verb).not.toContain(verb)
    }
  })
})

describe('the service-role client stays where it is allowed', () => {
  it.each([
    'app/(dashboard)/settings/billing/page.tsx',
    'app/(dashboard)/settings/billing/actions.ts',
    'lib/stripe/entitlement.ts',
    'lib/stripe/checkout.ts',
    'lib/stripe/client.ts',
    'lib/stripe/plans.ts',
    'lib/stripe/provisioning.ts',
    'lib/stripe/events.ts',
    'lib/stripe/reconcile.ts',
    'lib/domain/plan-limits.ts',
  ])('%s does not import it', (path) => {
    // eslint enforces this too (no-restricted-imports). Both, because the rule
    // is only as good as the ignore list next to it, and this batch is the one
    // that adds a second directory to that list.
    expect(source(path)).not.toContain('supabase/admin')
  })
})
