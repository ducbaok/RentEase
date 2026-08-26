#!/usr/bin/env node
/**
 * Rebuilds the demo organization by calling the cron endpoint (D23).
 *
 * It deliberately goes over HTTP rather than importing the reset directly: this
 * is the exact path Vercel Cron takes in production, so running it locally
 * exercises the secret check, the route and the job together. A script that
 * bypassed the endpoint could be green while the endpoint was broken.
 *
 *   pnpm demo:reset                          # against the local dev server
 *   pnpm demo:reset --url https://app.example.com
 *   pnpm demo:reset --as-of 2026-08-26       # pin the anchor day
 *
 * The secret comes from CRON_SECRET in the environment, falling back to
 * .env.local — the same file the dev server reads. It is never printed.
 */

import { existsSync, readFileSync } from 'node:fs'

function readEnvLocal(name) {
  if (!existsSync('.env.local')) return undefined
  const match = readFileSync('.env.local', 'utf8').match(
    new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, 'm'),
  )
  return match?.[1]?.replace(/^["']|["']$/g, '')
}

function arg(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

function resolvePort() {
  return process.env.PORT ?? readEnvLocal('PORT') ?? '3000'
}

const secret = process.env.CRON_SECRET ?? readEnvLocal('CRON_SECRET')
if (!secret) {
  console.error(
    'CRON_SECRET is not set. The demo-reset endpoint is public by URL and the secret is its ' +
      'only access control, so there is no way to call it without one. Add it to .env.local.',
  )
  process.exit(1)
}

const base = (arg('--url') ?? `http://127.0.0.1:${resolvePort()}`).replace(/\/+$/, '')
const asOf = arg('--as-of')
if (asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  console.error(`Invalid --as-of "${asOf}". Expected YYYY-MM-DD.`)
  process.exit(1)
}

const url = `${base}/api/cron/demo-reset${asOf ? `?as_of=${asOf}` : ''}`
console.log(`Resetting the demo organization via ${url}`)

let response
try {
  response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  })
} catch (error) {
  console.error(
    `Could not reach ${base}. Is the dev server running (\`pnpm dev\`)?\n  ${error.message}`,
  )
  process.exit(1)
}

const body = await response.text()
if (!response.ok) {
  console.error(`Demo reset failed with HTTP ${response.status}:\n${body}`)
  process.exit(1)
}

const summary = JSON.parse(body)
const total = (counts) => Object.values(counts).reduce((sum, n) => sum + n, 0)

console.log(
  `Demo organization rebuilt for ${summary.anchor}: ` +
    `${total(summary.deleted)} rows removed, ${total(summary.inserted)} written.`,
)
for (const [table, count] of Object.entries(summary.inserted)) {
  if (count > 0) console.log(`  ${String(count).padStart(4)}  ${table}`)
}
for (const note of summary.notes ?? []) console.warn(`  ! ${note}`)
