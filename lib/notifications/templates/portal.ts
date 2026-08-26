/**
 * Portal invitation email (kind 'portal_invite').
 *
 * A pure builder: given who is being invited and where to sign in, it returns
 * the Notification payload. Stream 2A wrote it inside its own area during
 * Batch 2; it moved here in 3B (bug B2-2) to sit alongside the other templates.
 * Keeping it pure means it is unit-tested without a mail provider.
 */

import type { Notification } from '../types'

export interface PortalInviteInput {
  to: string
  tenantName: string
  orgName: string
  /** Where the resident signs in — the magic-link request page. */
  loginUrl: string
}

export function buildPortalInviteEmail(input: PortalInviteInput): Notification {
  const subject = `${input.orgName} invited you to view your rent online`
  const text = [
    `Hi ${input.tenantName},`,
    ``,
    `${input.orgName} uses RentEase so you can see your rent and utility bills,`,
    `check exactly how each one was worked out, and report repairs — no app to`,
    `install.`,
    ``,
    `Sign in with your email (no password needed):`,
    input.loginUrl,
    ``,
    `We'll email you a one-time link each time you sign in.`,
  ].join('\n')

  const html = [
    `<p>Hi ${escapeHtml(input.tenantName)},</p>`,
    `<p>${escapeHtml(input.orgName)} uses RentEase so you can see your rent and utility bills, check exactly how each one was worked out, and report repairs — no app to install.</p>`,
    `<p><a href="${escapeAttr(input.loginUrl)}">Sign in with your email</a> (no password needed). We'll email you a one-time link each time.</p>`,
  ].join('')

  return { kind: 'portal_invite', to: input.to, subject, text, html }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;')
}
