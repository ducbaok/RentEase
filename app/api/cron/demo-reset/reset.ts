/**
 * The nightly demo reset (D23) — orchestration only.
 *
 * WHAT IT DOES, IN ORDER
 * Deletes every business row belonging to the demo organization, then re-inserts
 * the deterministic dataset from dataset.ts. Delete-then-insert rather than a
 * clever upsert: whatever a visitor did during the day — created a property,
 * deleted an invoice, half-finished a lease — is gone, and what is left is
 * exactly what buildDemoDataset() describes. That is the only definition of
 * "reset" that survives contact with a public demo.
 *
 * IDEMPOTENCY (the acceptance test for this file)
 * Running it twice leaves the database in the state one run leaves it in. It
 * holds for a stronger reason than "the second run overwrites the first": the
 * dataset is a pure function of the anchor day and every row carries a fixed
 * id, so two runs on the same day produce the same rows down to their primary
 * keys.
 *
 * D23 CONSTRAINT 3 — every delete is bound to the demo org
 * There is no `delete()` in this file without `.eq('org_id', DEMO_ORG_ID)`. The
 * service-role client bypasses RLS entirely (that is why only cron and webhooks
 * may import it), so the database will not stop a query that forgets the
 * filter. The filter is the whole safety mechanism, and it is applied in one
 * helper rather than eleven times by hand — a missed `.eq` cannot hide in a
 * list of near-identical lines.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH
 * Auth accounts. The demo owner and manager sign in with credentials that must
 * survive the reset, and creating auth users is not this job's business — the
 * local fixture (supabase/seed.sql) creates them, and production creates them
 * once via the runbook. If they are missing, the reset still rebuilds the data
 * and says so in its summary rather than failing.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { todayUtc } from '@/lib/domain/invoice-status'
import {
  buildDemoDataset,
  DEMO_MANAGER_EMAIL,
  DEMO_ORG_ID,
  DEMO_ORG_NAME,
  DEMO_OWNER_EMAIL,
  DEMO_PERIOD_END,
  DEMO_PLAN,
  DEMO_SUBSCRIPTION_STATUS,
  type DemoDataset,
} from './dataset'

type Admin = ReturnType<typeof createAdminClient>

/**
 * Children before parents.
 *
 * `leases.tenant_id` is ON DELETE RESTRICT — deliberately, so a resident with a
 * lease cannot be erased by accident — which means leases must go before
 * tenants. The rest would cascade, but they are listed anyway: a cascade is a
 * database detail that can be changed by a later migration, while this order is
 * a statement of intent that stays readable.
 */
const DELETE_ORDER = [
  'reminder_logs',
  'payments',
  'audit_logs',
  'invoices',
  'meter_readings',
  'maintenance_requests',
  'leases',
  'tenants',
  'units',
  'properties',
  'tariffs',
] as const

export interface DemoResetSummary {
  anchor: string
  orgId: string
  /** Rows removed, by table. */
  deleted: Record<string, number>
  /** Rows written, by table. */
  inserted: Record<string, number>
  /** False when the demo operator accounts are absent — data is still rebuilt. */
  operatorAccountsPresent: boolean
  /** Warnings worth seeing in a cron log without being failures. */
  notes: string[]
}

/** The one place `org_id = demo` is spelled, so it cannot be forgotten anywhere else. */
async function deleteDemoRows(supabase: Admin, table: string): Promise<number> {
  const { data, error } = await supabase
    .from(table as 'properties')
    .delete()
    .eq('org_id', DEMO_ORG_ID)
    .select('id')

  if (error) throw new Error(`clearing ${table} failed: ${error.message}`)
  return data?.length ?? 0
}

async function insertRows(
  supabase: Admin,
  table: string,
  rows: readonly object[],
): Promise<number> {
  if (rows.length === 0) return 0
  const { error } = await supabase.from(table as 'properties').insert(rows as never)
  if (error) throw new Error(`seeding ${table} failed: ${error.message}`)
  return rows.length
}

/**
 * The organization and its subscription, re-asserted every run.
 *
 * D23 constraint 2 lives here: the demo is put back on the top plan with an
 * active subscription that ends in 2099, so it can never lock itself behind an
 * expired trial or a plan limit no matter what a visitor did or what the
 * Stripe-side code decides tomorrow.
 */
async function ensureOrganization(supabase: Admin): Promise<void> {
  const { error: orgError } = await supabase.from('organizations').upsert(
    {
      id: DEMO_ORG_ID,
      name: DEMO_ORG_NAME,
      plan: DEMO_PLAN,
      status: 'active',
      currency: 'USD',
    },
    { onConflict: 'id' },
  )
  if (orgError) throw new Error(`restoring the demo organization failed: ${orgError.message}`)

  const { error: subError } = await supabase.from('subscriptions').upsert(
    {
      org_id: DEMO_ORG_ID,
      plan: DEMO_PLAN,
      status: DEMO_SUBSCRIPTION_STATUS,
      period_end: DEMO_PERIOD_END,
    },
    { onConflict: 'org_id' },
  )
  if (subError) throw new Error(`restoring the demo subscription failed: ${subError.message}`)
}

/**
 * The demo manager's user id, or null when the demo operators are not set up.
 *
 * `meter_readings.recorded_by` and `payments.recorded_by` point at auth.users,
 * so seeding them with an account that is not there would fail the whole run.
 * Rather than refuse, the reset records those rows with no author and notes it:
 * a demo with data and an unattributed payment is far more useful than no demo.
 *
 * LOOKED UP BY EMAIL, NOT BY ID, and that is the whole point of this function.
 * `supabase/seed.sql` can choose the ids it inserts, so locally the accounts do
 * land on the ids seed.sql picks. In a hosted project they are created
 * through the dashboard, which mints its own uuid and offers no way to pick one
 * — so an id lookup can never match there. It failed exactly that way on the
 * first production deploy: the accounts existed, the reset insisted they did
 * not, and every reading and payment was written with no author (B4-4).
 *
 * The email addresses are the stable identity across both environments.
 */
async function demoAuthorId(supabase: Admin): Promise<string | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, email')
    .in('email', [DEMO_OWNER_EMAIL, DEMO_MANAGER_EMAIL])

  if (error) throw new Error(`checking the demo operator accounts failed: ${error.message}`)
  if ((data?.length ?? 0) !== 2) return null

  const manager = data?.find((row) => row.email === DEMO_MANAGER_EMAIL)
  return manager?.id ?? null
}

export async function runDemoReset(
  options: { asOf?: string } = {},
): Promise<DemoResetSummary> {
  const anchor = options.asOf ?? todayUtc()
  const supabase = createAdminClient()
  const data: DemoDataset = buildDemoDataset(anchor)
  const notes: string[] = []

  await ensureOrganization(supabase)

  const author = await demoAuthorId(supabase)
  if (author === null) {
    notes.push(
      `The demo operator accounts (${DEMO_OWNER_EMAIL}, ${DEMO_MANAGER_EMAIL}) are missing, ` +
        'so readings and payments were seeded without an author. Create them once — ' +
        'supabase/seed.sql does it locally, docs/sot/80-deploy-runbook.md in production.',
    )
  }


  const deleted: Record<string, number> = {}
  for (const table of DELETE_ORDER) {
    deleted[table] = await deleteDemoRows(supabase, table)
  }

  const inserted: Record<string, number> = {}
  inserted.properties = await insertRows(supabase, 'properties', data.properties)
  inserted.units = await insertRows(supabase, 'units', data.units)
  inserted.tenants = await insertRows(supabase, 'tenants', data.tenants)
  inserted.leases = await insertRows(supabase, 'leases', data.leases)
  inserted.tariffs = await insertRows(supabase, 'tariffs', data.tariffs)
  inserted.meter_readings = await insertRows(
    supabase,
    'meter_readings',
    data.readings.map((row) => ({ ...row, recorded_by: author })),
  )

  // Issuing IS setting issued_at (D10). total_cents, paid_cents and status are
  // computed by the trigger on every write path, so writing them here would
  // either be ignored or — worse — briefly disagree with the arithmetic.
  inserted.invoices = await insertRows(
    supabase,
    'invoices',
    data.invoices.map(({ expectedTotalCents: _expectedTotalCents, ...row }) => row),
  )

  inserted.payments = await insertRows(
    supabase,
    'payments',
    data.payments.map((row) => ({ ...row, recorded_by: author })),
  )
  inserted.maintenance_requests = await insertRows(
    supabase,
    'maintenance_requests',
    data.maintenance,
  )

  return {
    anchor,
    orgId: DEMO_ORG_ID,
    deleted,
    inserted,
    operatorAccountsPresent: author !== null,
    notes,
  }
}
