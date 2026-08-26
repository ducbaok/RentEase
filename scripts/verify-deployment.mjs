#!/usr/bin/env node
/**
 * Post-deploy smoke check (D21).
 *
 * Not a test suite — the test suites already ran. This checks the handful of
 * things that are true on a laptop and can still be false in production,
 * because they depend on configuration rather than on code:
 *
 *   - the app is actually serving
 *   - the sign-in page renders (so Supabase's public config reached the build)
 *   - both cron endpoints are LOCKED: no secret means 401, never 200 and never
 *     500. A 500 here means CRON_SECRET is unset, which the cron platform would
 *     report as "the job failed" rather than "the job is unprotected"
 *   - the correct secret actually works, if one is supplied
 *   - no service-role key made it into the JavaScript the browser downloads
 *
 *   node scripts/verify-deployment.mjs --url https://app.example.com
 *   CRON_SECRET=… node scripts/verify-deployment.mjs --url https://app.example.com --run-crons
 *
 * `--run-crons` really runs them: it sends a reminder pass and rebuilds the demo
 * organization. Both are idempotent, and neither touches a paying customer's
 * data — but do it knowingly, and not while somebody is giving a demo.
 */

const args = process.argv.slice(2)
const flag = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const base = (flag('--url') ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
const runCrons = args.includes('--run-crons')
const secret = process.env.CRON_SECRET

if (!base) {
  console.error('Pass the deployment URL: --url https://app.example.com')
  process.exit(1)
}

let failures = 0
const pass = (message) => console.log(`  ok    ${message}`)
const fail = (message) => {
  console.log(`  FAIL  ${message}`)
  failures += 1
}

async function get(path, init) {
  try {
    return await fetch(`${base}${path}`, { redirect: 'manual', ...init })
  } catch (error) {
    fail(`${path} could not be reached: ${error.message}`)
    return null
  }
}

console.log(`Verifying ${base}\n`)

// --- the app is up ---------------------------------------------------------
const home = await get('/')
if (home) {
  if (home.status < 400) pass(`the site answers (HTTP ${home.status})`)
  else fail(`the site answered HTTP ${home.status}`)
}

// --- sign-in renders, which means the public Supabase config reached the build
const signIn = await get('/sign-in')
if (signIn) {
  const html = await signIn.text()
  if (signIn.status !== 200) {
    fail(`/sign-in answered HTTP ${signIn.status}`)
  } else if (!/name="password"/.test(html)) {
    fail('/sign-in rendered without its form — check NEXT_PUBLIC_SUPABASE_* in the build')
  } else {
    pass('/sign-in renders')
  }

  // The service-role key must never be inlined into a page. This is a cheap
  // check on one page rather than a guarantee, but it catches the one mistake
  // that matters: a secret renamed to NEXT_PUBLIC_ to "make it work".
  if (/service_role/.test(html)) {
    fail('the sign-in HTML mentions service_role — a server-only key may have been made public')
  } else {
    pass('no service-role key in the sign-in HTML')
  }
}

// --- the cron endpoints are locked ----------------------------------------
for (const path of ['/api/cron/reminders', '/api/cron/demo-reset']) {
  const unauthenticated = await get(path)
  if (!unauthenticated) continue

  if (unauthenticated.status === 401) {
    pass(`${path} refuses an unauthenticated request`)
  } else if (unauthenticated.status === 500) {
    fail(`${path} returned 500 — CRON_SECRET is probably unset, so the job cannot run at all`)
  } else if (unauthenticated.status === 404) {
    fail(`${path} is not deployed`)
  } else {
    fail(`${path} answered HTTP ${unauthenticated.status} without a secret — it should be 401`)
  }

  const wrongSecret = await get(path, { headers: { Authorization: 'Bearer not-the-secret' } })
  if (wrongSecret && wrongSecret.status !== 401) {
    fail(`${path} answered HTTP ${wrongSecret.status} to a WRONG secret — it should be 401`)
  }
}

// --- and the real secret opens them ---------------------------------------
if (runCrons) {
  if (!secret) {
    fail('--run-crons needs CRON_SECRET in the environment')
  } else {
    for (const path of ['/api/cron/reminders', '/api/cron/demo-reset']) {
      const response = await get(path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
      })
      if (!response) continue
      if (response.status === 200) {
        const summary = await response.json()
        pass(`${path} ran: ${JSON.stringify(summary).slice(0, 160)}`)
      } else {
        fail(`${path} answered HTTP ${response.status} to the correct secret: ${await response.text()}`)
      }
    }
  }
} else {
  console.log('  skip  running the cron jobs (pass --run-crons with CRON_SECRET to include them)')
}

console.log('')
if (failures > 0) {
  console.log(`${failures} problem${failures === 1 ? '' : 's'} found.`)
  process.exit(1)
}
console.log('Deployment looks healthy.')
