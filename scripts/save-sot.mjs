#!/usr/bin/env node
/**
 * Commits the source of truth and pushes it to the mirror outside the project.
 *
 * WHY THIS EXISTS
 * On 2026-08-25 `git worktree remove --force` followed a junction into docs/
 * and deleted the whole source of truth. Nothing could restore it: markdown is
 * deliberately kept out of the application's git history, so the only copy was
 * the one on disk.
 *
 * The fix keeps that rule intact. docs/ is its OWN git repository — the
 * application's history still contains no markdown — and it pushes to a bare
 * mirror at ../RentEase-sot.git, outside the project tree, so deleting the
 * project directory no longer destroys the history.
 *
 * Run `pnpm sot:save` after changing anything under docs/sot/. The rule in
 * CLAUDE.md already requires announcing SoT changes; this is how they survive.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const SOT_DIR = 'docs'
const MIRROR = '../RentEase-sot.git'

function git(args, options = {}) {
  return execFileSync('git', ['-C', SOT_DIR, ...args], {
    encoding: 'utf8',
    ...options,
  }).trim()
}

if (!existsSync(`${SOT_DIR}/.git`)) {
  console.error(
    `${SOT_DIR}/ is not a git repository. Recreate it with:\n` +
      `  git -C ${SOT_DIR} init -b main && git -C ${SOT_DIR} remote add backup ${MIRROR}`,
  )
  process.exit(1)
}

const status = git(['status', '--porcelain'])
const message = process.argv.slice(2).join(' ').trim()

if (status) {
  console.log(status)
  git(['add', '-A'])
  git([
    'commit',
    '-q',
    '-m',
    message || 'update the source of truth',
  ])
  console.log(`\ncommitted: ${git(['log', '-1', '--format=%h %s'])}`)
} else {
  console.log('No changes to the source of truth.')
}

// Push even with nothing new to commit: the mirror may be behind from an
// earlier run that failed after committing.
const remotes = git(['remote'])
if (!remotes.split('\n').includes('backup')) {
  git(['remote', 'add', 'backup', MIRROR])
}

try {
  git(['push', '-q', 'backup', 'main'])
  console.log(`mirrored to ${MIRROR}`)
} catch (error) {
  console.error(`Could not push to ${MIRROR}:`, error instanceof Error ? error.message : error)
  console.error('The local history is committed; fix the mirror and run again.')
  process.exit(1)
}
