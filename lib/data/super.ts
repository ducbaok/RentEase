/**
 * The product back office (D11 / D12) — data access for the `(super)` area.
 *
 * A super admin is the THIRD identity: a row in public.super_admins, never an
 * operator and never a resident. It exists so the people who run RentEase can
 * see who their customers are and what state their subscriptions are in,
 * without being able to open a single one of those customers' books.
 *
 * WHAT THIS CAN SEE, AND WHY IT IS SO LITTLE
 * Exactly two policies grant the super identity anything: `org_select_super` on
 * organizations and `subscriptions_super_select` on subscriptions (migration
 * 0700). There is no super policy on units, invoices, tenants or audit_logs, so
 * the account list below is the whole of the back office by construction — a
 * page that tried to show a per-org unit count would return zero rows rather
 * than leak one. That is deliberate: "list of orgs and their subscription
 * state" is what 10-requirements.md grants the role, and the database is where
 * that limit is enforced rather than in a page component.
 *
 * WHERE THE CHECK IS
 * requireSuperAdmin() runs here, in the query, not only in the layout — the
 * layout decides which chrome renders, and proxy.ts is explicitly not a
 * security boundary (20-architecture.md). Following D19's "prefer the 1B
 * shape", the identity is resolved by the function that does the reading, so
 * there is no caller who can call it wrongly. RLS underneath refuses anyway;
 * this is the layer that makes a mistake in the layout cost a wrong screen
 * instead of a wrong dataset.
 */

import { createClient } from '@/lib/supabase/server'
import { requireSuperAdmin } from '@/lib/auth'
import type { Database } from '@/lib/types/database'

type OrganizationRow = Database['public']['Tables']['organizations']['Row']
type SubscriptionRow = Database['public']['Tables']['subscriptions']['Row']

export type OrgPlan = Database['public']['Enums']['org_plan']
export type OrgStatus = Database['public']['Enums']['org_status']

export interface AccountSubscription {
  plan: OrgPlan
  /** Free text from Stripe ('trialing', 'active', 'past_due', 'canceled', …). */
  status: string
  /** ISO timestamp. For a trial this is when it runs out (D22). */
  periodEnd: string | null
  /** Whether Stripe knows about this account yet. The ids themselves stay put. */
  linkedToStripe: boolean
}

export interface AccountOverview {
  id: string
  name: string
  /** The plan recorded on the organization itself. */
  plan: OrgPlan
  status: OrgStatus
  currency: string
  createdAt: string
  /** Null when an org somehow has no subscription row at all — worth seeing. */
  subscription: AccountSubscription | null
}

/**
 * Every account on RentEase, newest first.
 *
 * organizations and subscriptions are fetched separately rather than embedded:
 * the two super policies are independent, so a join that silently dropped orgs
 * without a subscription row would hide exactly the accounts most worth
 * noticing. Joining in memory keeps the org list complete and makes a missing
 * subscription visible as `null`.
 */
export async function listAccounts(): Promise<AccountOverview[]> {
  await requireSuperAdmin()
  const supabase = await createClient()

  const [orgs, subs] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, name, plan, status, currency, created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('subscriptions')
      .select('org_id, plan, status, period_end, stripe_customer_id, stripe_sub_id'),
  ])

  if (orgs.error) throw new Error(orgs.error.message)
  if (subs.error) throw new Error(subs.error.message)

  const byOrg = new Map<string, Pick<
    SubscriptionRow,
    'org_id' | 'plan' | 'status' | 'period_end' | 'stripe_customer_id' | 'stripe_sub_id'
  >>((subs.data ?? []).map((row) => [row.org_id, row]))

  return ((orgs.data ?? []) as Array<
    Pick<OrganizationRow, 'id' | 'name' | 'plan' | 'status' | 'currency' | 'created_at'>
  >).map((org) => {
    const sub = byOrg.get(org.id)
    return {
      id: org.id,
      name: org.name,
      plan: org.plan,
      status: org.status,
      currency: org.currency,
      createdAt: org.created_at,
      subscription: sub
        ? {
            plan: sub.plan,
            status: sub.status,
            periodEnd: sub.period_end,
            linkedToStripe: Boolean(sub.stripe_customer_id || sub.stripe_sub_id),
          }
        : null,
    }
  })
}

export interface AccountTotals {
  accounts: number
  /** Accounts by subscription status, biggest group first. */
  byStatus: Array<{ status: string; count: number }>
  /** Accounts whose subscription row is missing entirely. */
  withoutSubscription: number
}

/** Counts derived from the same rows the table shows — no second query, no second truth. */
export function summarise(accounts: AccountOverview[]): AccountTotals {
  const counts = new Map<string, number>()
  let withoutSubscription = 0

  for (const account of accounts) {
    if (!account.subscription) {
      withoutSubscription += 1
      continue
    }
    const status = account.subscription.status
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }

  return {
    accounts: accounts.length,
    byStatus: [...counts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => (b.count - a.count) || a.status.localeCompare(b.status)),
    withoutSubscription,
  }
}
