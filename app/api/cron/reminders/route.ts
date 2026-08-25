/**
 * The reminder cron endpoint (F6).
 *
 * A route handler, not a Server Action: cron is the one caller that is a
 * machine, not a browser. Any platform can drive it — Vercel Cron is just the
 * default trigger — because the job itself is idempotent (AC6.2), so being
 * called twice, or by something other than Vercel, changes nothing.
 *
 * It is public by URL, so it is gated by a shared secret. Without that, anyone
 * could trigger the job; with it, only whoever holds CRON_SECRET can. The
 * secret is accepted as `Authorization: Bearer <secret>` (what Vercel Cron
 * sends) or as an `x-cron-secret` header (for platforms that cannot set
 * Authorization). This gate is not RLS — the job runs as service role — so the
 * secret is the whole of the access control here, and a missing CRON_SECRET is
 * treated as a misconfiguration rather than an open door.
 */

import { NextResponse } from 'next/server'
import { serverEnv } from '@/lib/env'
import { runReminderJob } from './job'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AS_OF_PATTERN = /^\d{4}-\d{2}-\d{2}$/

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

async function handle(request: Request): Promise<Response> {
  let expected: string
  try {
    expected = serverEnv('CRON_SECRET')
  } catch {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on the server.' },
      { status: 500 },
    )
  }

  const presented = presentedSecret(request)
  if (!presented || !secretMatches(presented, expected)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  // Optional as_of override, mainly for backfills and tests. Defaults to today.
  const asOfParam = new URL(request.url).searchParams.get('as_of')
  if (asOfParam !== null && !AS_OF_PATTERN.test(asOfParam)) {
    return NextResponse.json(
      { error: `Invalid as_of "${asOfParam}". Expected YYYY-MM-DD.` },
      { status: 400 },
    )
  }

  const summary = await runReminderJob({ asOf: asOfParam ?? undefined })
  return NextResponse.json(summary, { status: 200 })
}

export async function GET(request: Request): Promise<Response> {
  return handle(request)
}

export async function POST(request: Request): Promise<Response> {
  return handle(request)
}
