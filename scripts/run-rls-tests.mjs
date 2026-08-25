#!/usr/bin/env node
/**
 * Runs the pgTAP suite in supabase/tests/*.test.sql against the local database.
 *
 * `supabase test db` is the documented runner, but it spins up a separate
 * container per invocation and takes minutes on Windows. These tests each wrap
 * themselves in BEGIN/ROLLBACK, so piping them straight into the running
 * database is equivalent and finishes in seconds — and a test you run is worth
 * more than a test you skip because it is slow.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TEST_DIR = 'supabase/tests'

function resolveDbContainer() {
  const output = execFileSync(
    'docker',
    ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  ).trim()
  const name = output.split('\n').filter(Boolean)[0]
  if (!name) {
    console.error(
      'No running Supabase database container found. Start it with `pnpm db:start`.',
    )
    process.exit(1)
  }
  return name
}

function runFile(container, file) {
  const sql = readFileSync(file, 'utf8')
  const result = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-q', '-f', '-'],
    { input: sql, encoding: 'utf8' },
  )

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const lines = output.split('\n')
  const passed = lines.filter((line) => line.startsWith('ok ')).length
  const failed = lines.filter((line) => line.startsWith('not ok '))
  const errors = lines.filter((line) => line.includes('ERROR:'))

  /*
   * A file that declares plan(23) and runs 22 assertions has silently lost one,
   * and every assertion it did run still prints "ok" — so counting failures
   * alone reports a clean pass on a suite that quietly stopped testing
   * something. pgTAP mentions it only in a trailing "# Looks like ..." note, so
   * the mismatch is promoted to a failure here rather than left in the output.
   */
  const planLine = lines.find((line) => /^1\.\.\d+$/.test(line.trim()))
  const ran = passed + failed.length
  if (planLine) {
    const planned = Number(planLine.trim().split('..')[1])
    if (planned !== ran) {
      errors.push(`plan mismatch: declared ${planned} assertions, ran ${ran}`)
    }
  } else {
    errors.push('no TAP plan found — did the file fail before select plan(...)?')
  }

  return { passed, failed, errors, output }
}

const container = resolveDbContainer()
const files = readdirSync(TEST_DIR)
  .filter((name) => name.endsWith('.test.sql'))
  .sort()

if (files.length === 0) {
  console.error(`No *.test.sql files in ${TEST_DIR}`)
  process.exit(1)
}

let totalPassed = 0
let totalFailed = 0

for (const name of files) {
  const { passed, failed, errors } = runFile(container, join(TEST_DIR, name))
  totalPassed += passed
  totalFailed += failed.length + errors.length

  const status = failed.length === 0 && errors.length === 0 ? 'PASS' : 'FAIL'
  console.log(`${status}  ${name}  (${passed} assertions)`)

  for (const line of [...failed, ...errors]) console.log(`      ${line.trim()}`)
}

console.log(
  `\n${totalFailed === 0 ? 'All RLS tests passed' : 'RLS tests FAILED'} — ` +
    `${totalPassed} assertions across ${files.length} files.`,
)

process.exit(totalFailed === 0 ? 0 : 1)
