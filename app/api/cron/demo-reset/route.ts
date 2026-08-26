/**
 * The nightly demo-reset endpoint (D23).
 *
 * Same shape as the reminder cron next door, and for the same reasons: a route
 * handler because the caller is a machine, public by URL and therefore gated by
 * a shared secret, and safe to trigger twice because the job itself is
 * idempotent. The secret is the entire access control here — the job runs as
 * service role and bypasses RLS — so a missing CRON_SECRET is a
 * misconfiguration, never a reason to run anyway.
 *
 * This one destroys data on purpose, which is exactly why the secret matters
 * more here than on the reminder job. What it can destroy is bounded by
 * reset.ts: every delete names the demo organization.
 */

import { NextResponse } from 'next/server'
import { serverEnv } from '@/lib/env'
import { runDemoReset } from './reset'

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

  // Optional anchor override, so a test can pin the dataset to a known day.
  // Everything the reset produces is a function of it.
  const asOfParam = new URL(request.url).searchParams.get('as_of')
  if (asOfParam !== null && !AS_OF_PATTERN.test(asOfParam)) {
    return NextResponse.json(
      { error: `Invalid as_of "${asOfParam}". Expected YYYY-MM-DD.` },
      { status: 400 },
    )
  }

  const summary = await runDemoReset({ asOf: asOfParam ?? undefined })
  return NextResponse.json(summary, { status: 200 })
}

export async function GET(request: Request): Promise<Response> {
  return handle(request)
}

export async function POST(request: Request): Promise<Response> {
  return handle(request)
}
