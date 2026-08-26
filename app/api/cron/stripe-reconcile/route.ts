/**
 * The reconcile endpoint (AC-S1) — two callers, one job.
 *
 *   THE NIGHTLY SWEEP presents CRON_SECRET and reconciles every organization.
 *   Same shape as the reminder cron (app/api/cron/reminders): a machine caller,
 *   no session, a shared secret as the whole of the access control.
 *
 *   AN OWNER presents nothing but their session cookie and reconciles ONLY
 *   their own organization. This exists because the moment a lost webhook is
 *   most visible is the moment somebody comes back from Stripe Checkout to a
 *   page that still says "trial". The billing page offers it as "Refresh from
 *   Stripe" and it is the same code, scoped to one org id that comes from the
 *   session and never from the request.
 *
 * WHY THE SECOND CALLER IS NOT A HOLE
 * It runs as the service role, so it deserves the suspicion. What it can be
 * made to do, though, is copy Stripe's own answer about the caller's own
 * organization into that organization's row. There is no input to bend: no
 * body is read, no org id is accepted, no value is chosen by the caller. The
 * worst an owner can achieve by pressing it repeatedly is learning the truth
 * about their own subscription sooner — and if that truth is "canceled", they
 * have just cancelled their own access.
 *
 * A manager is refused. They cannot read the billing relationship (RLS,
 * migration 0700) and must not be able to move it either.
 */

import { NextResponse } from 'next/server'
import { getIdentity } from '@/lib/auth'
import { optionalServerEnv } from '@/lib/env'
import { runStripeReconcile, StripeReconcileUnavailableError } from './job'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function presentedSecret(request: Request): string | null {
  const auth = request.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim()
  const header = request.headers.get('x-cron-secret')
  return header ? header.trim() : null
}

/** Length-independent equality, to avoid leaking the secret's length by timing. */
function secretMatches(presented: string, expected: string): boolean {
  if (presented.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < presented.length; i += 1) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

type Caller = { kind: 'cron' } | { kind: 'owner'; orgId: string } | { kind: 'refused'; status: number; error: string }

async function resolveCaller(request: Request): Promise<Caller> {
  const presented = presentedSecret(request)
  if (presented) {
    const expected = optionalServerEnv('CRON_SECRET')
    if (!expected) {
      return { kind: 'refused', status: 500, error: 'CRON_SECRET is not configured on the server.' }
    }
    if (!secretMatches(presented, expected)) {
      return { kind: 'refused', status: 401, error: 'Unauthorized.' }
    }
    return { kind: 'cron' }
  }

  const identity = await getIdentity()
  if (identity.kind !== 'operator') {
    return { kind: 'refused', status: 401, error: 'Unauthorized.' }
  }
  if (identity.role !== 'owner') {
    return {
      kind: 'refused',
      status: 403,
      error: 'Only the account owner can refresh the subscription.',
    }
  }
  return { kind: 'owner', orgId: identity.orgId }
}

async function handle(request: Request): Promise<Response> {
  const caller = await resolveCaller(request)
  if (caller.kind === 'refused') {
    return NextResponse.json({ error: caller.error }, { status: caller.status })
  }

  try {
    const summary = await runStripeReconcile(
      caller.kind === 'owner' ? { orgId: caller.orgId } : {},
    )
    return NextResponse.json({ scope: caller.kind === 'owner' ? 'organization' : 'all', ...summary })
  } catch (error) {
    if (error instanceof StripeReconcileUnavailableError) {
      // Not configured is not broken. 503 says "ask again when it is", which is
      // exactly right for a server running the trial with no Stripe key (D21).
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    return NextResponse.json(
      {
        error: 'The reconcile failed.',
        detail: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 },
    )
  }
}

export async function GET(request: Request): Promise<Response> {
  return handle(request)
}

export async function POST(request: Request): Promise<Response> {
  return handle(request)
}
