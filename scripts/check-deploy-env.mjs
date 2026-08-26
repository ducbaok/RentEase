#!/usr/bin/env node
/**
 * Pre-flight check for a deployment's environment variables (D21).
 *
 * Every one of these has a failure mode that only shows up in production and
 * looks like something else: a missing CRON_SECRET turns the reminder endpoint
 * into a 500 that a cron platform reports as "job failed"; a
 * SUPABASE_SERVICE_ROLE_KEY from the wrong project makes the nightly demo reset
 * delete the demo org out of a database that has no demo org; a
 * NEXT_PUBLIC_APP_URL still pointing at localhost puts "http://localhost:3000"
 * in the link inside a resident's overdue email.
 *
 * So this runs BEFORE the first deploy, and again after any change to the
 * variables, rather than waiting for one of those to be discovered by a tenant.
 *
 *   node scripts/check-deploy-env.mjs                 # checks the live shell
 *   node scripts/check-deploy-env.mjs --file .env.production
 *   node scripts/check-deploy-env.mjs --stage staging # test-mode Stripe is fine
 *   node scripts/check-deploy-env.mjs --no-billing    # billing deferred (D24)
 *
 * It never prints a value. Everything is reported as present/absent and by
 * shape, because the natural place to run this is a terminal in a screen share.
 */

import { existsSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const stage = flag('--stage') ?? 'production'
const file = flag('--file')

/**
 * Billing is deferred (D24): there is no Stripe account to configure yet, so
 * the two Stripe variables are absent by design rather than forgotten. This
 * flag says so out loud instead of letting the check be quietly ignored — and
 * when billing opens, dropping the flag turns them back into hard failures.
 */
const billingDeferred = args.includes('--no-billing')

if (!['production', 'staging'].includes(stage)) {
  console.error(`Unknown --stage "${stage}". Expected production or staging.`)
  process.exit(1)
}

/** Reads a dotenv-shaped file without adding a dependency for it. */
function readEnvFile(path) {
  if (!existsSync(path)) {
    console.error(`No such file: ${path}`)
    process.exit(1)
  }
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) continue
    env[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
  return env
}

const env = file ? readEnvFile(file) : process.env

const isHttpsUrl = (value) => /^https:\/\/[^\s/]+/.test(value)
const isSupabaseUrl = (value) => /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(value)

/**
 * `required` is what a deploy cannot work without. `warn` is what it can start
 * without but should not run without — a warning is not a pass, it is a
 * decision someone has to make out loud.
 */
const CHECKS = [
  {
    name: 'NEXT_PUBLIC_SUPABASE_URL',
    required: true,
    check: (value) =>
      isSupabaseUrl(value) || 'should be the project URL, https://<ref>.supabase.co',
  },
  {
    name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    required: true,
    check: (value) => value.length > 40 || 'looks too short to be the anon key',
  },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    required: true,
    check: (value) => {
      if (value.length <= 40) return 'looks too short to be the service-role key'
      if (value === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        return 'is the SAME as the anon key — the cron jobs would run without the privileges they need'
      }
      return true
    },
  },
  {
    name: 'NEXT_PUBLIC_APP_URL',
    required: true,
    check: (value) => {
      if (/localhost|127\.0\.0\.1/.test(value)) {
        return 'still points at localhost — this URL goes into every email a resident receives'
      }
      return isHttpsUrl(value) || 'should be the full https origin, with no trailing path'
    },
  },
  {
    name: 'CRON_SECRET',
    required: true,
    check: (value) => {
      if (value.length < 24) {
        return 'is short. It is the ONLY thing standing between the internet and a job that ' +
          'wipes the demo organization — use at least 24 random characters'
      }
      if (/^(local|dev|test|changeme|secret)/i.test(value)) {
        return 'looks like the development placeholder'
      }
      return true
    },
  },
  {
    name: 'RESEND_API_KEY',
    required: true,
    check: (value) =>
      value.startsWith('re_') || 'Resend keys start with re_; an empty key silently logs instead of sending',
  },
  {
    name: 'EMAIL_FROM',
    required: true,
    check: (value) => {
      if (!/@/.test(value)) return 'should contain an address, e.g. "RentEase <billing@yourdomain>"'
      if (/example\.(com|test)/.test(value)) return 'still uses an example domain'
      return true
    },
  },
  {
    name: 'STRIPE_SECRET_KEY',
    required: !billingDeferred,
    skip: billingDeferred,
    check: (value) => {
      if (!/^sk_(live|test)_/.test(value)) return 'should start with sk_live_ or sk_test_'
      if (stage === 'production' && value.startsWith('sk_test_')) {
        return 'is a TEST key on a production deploy — real subscriptions would never be charged'
      }
      if (stage === 'staging' && value.startsWith('sk_live_')) {
        return 'is a LIVE key on staging — a test checkout would charge a real card'
      }
      return true
    },
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET',
    required: !billingDeferred,
    skip: billingDeferred,
    check: (value) =>
      value.startsWith('whsec_') ||
      'should start with whsec_ — it is the endpoint signing secret from the Stripe dashboard, ' +
        'not the API key',
  },
]

let failures = 0
let warnings = 0

console.log(`Checking ${file ?? 'the current environment'} for stage "${stage}"\n`)

for (const { name, required, check, skip } of CHECKS) {
  if (skip) {
    console.log(`  SKIP  ${name} — billing deferred (D24), nothing to configure yet`)
    continue
  }

  const value = env[name]

  if (!value) {
    if (required) {
      console.log(`  FAIL  ${name} is not set`)
      failures += 1
    } else {
      console.log(`  WARN  ${name} is not set`)
      warnings += 1
    }
    continue
  }

  const verdict = check(value)
  if (verdict === true) {
    console.log(`  ok    ${name}`)
  } else if (required) {
    console.log(`  FAIL  ${name} ${verdict}`)
    failures += 1
  } else {
    console.log(`  WARN  ${name} ${verdict}`)
    warnings += 1
  }
}

// A variable nobody meant to set is worth a look: NEXT_PUBLIC_ is inlined into
// the JavaScript every visitor downloads, so a secret named that way is public.
const leaked = Object.keys(env).filter(
  (name) =>
    name.startsWith('NEXT_PUBLIC_') &&
    /SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|_KEY$/.test(name.replace('NEXT_PUBLIC_', '')) &&
    !['NEXT_PUBLIC_SUPABASE_ANON_KEY'].includes(name),
)

if (leaked.length > 0) {
  console.log('')
  for (const name of leaked) {
    console.log(`  FAIL  ${name} is NEXT_PUBLIC_ and looks like a secret — it ships to the browser`)
    failures += 1
  }
}

console.log('')
if (failures > 0) {
  console.log(`${failures} problem${failures === 1 ? '' : 's'} to fix before deploying.`)
  process.exit(1)
}
console.log(warnings > 0 ? `Ready, with ${warnings} warning(s).` : 'Ready to deploy.')
