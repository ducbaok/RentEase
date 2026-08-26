/**
 * Maintenance status-change email (kind 'maintenance_status_changed', AC8.1).
 *
 * Pure builder, unit-tested without a provider. Stream 2A owns it during the
 * batch; folded into lib/notifications/templates/ at merge (2B lands first).
 *
 * The idempotencyKey ties one email to one (request, status) so a provider that
 * dedupes never sends the same "now in progress" twice — a soft second line of
 * defence, since the operator only advances a status once anyway.
 */

import type { Notification } from '@/lib/notifications/types'
import {
  MAINTENANCE_STATUS_LABELS,
  MAINTENANCE_STATUS_SUMMARY,
  type MaintenanceStatus,
} from '@/lib/data/maintenance-status'

export interface MaintenanceStatusEmailInput {
  to: string
  tenantName: string
  requestId: string
  title: string
  unitCode: string
  status: MaintenanceStatus
  /** Where the resident can open the request. */
  requestUrl: string
}

export function buildMaintenanceStatusEmail(input: MaintenanceStatusEmailInput): Notification {
  const statusLabel = MAINTENANCE_STATUS_LABELS[input.status]
  const summary = MAINTENANCE_STATUS_SUMMARY[input.status]
  const subject = `Update on "${input.title}" — ${statusLabel}`

  const text = [
    `Hi ${input.tenantName},`,
    ``,
    `${summary}`,
    ``,
    `Request: ${input.title} (Unit ${input.unitCode})`,
    `Status: ${statusLabel}`,
    ``,
    `View it here:`,
    input.requestUrl,
  ].join('\n')

  const html = [
    `<p>Hi ${escapeHtml(input.tenantName)},</p>`,
    `<p>${escapeHtml(summary)}</p>`,
    `<p><strong>${escapeHtml(input.title)}</strong> (Unit ${escapeHtml(input.unitCode)})<br/>Status: <strong>${escapeHtml(statusLabel)}</strong></p>`,
    `<p><a href="${escapeAttr(input.requestUrl)}">Open your request</a></p>`,
  ].join('')

  return {
    kind: 'maintenance_status_changed',
    to: input.to,
    subject,
    text,
    html,
    idempotencyKey: `maintenance:${input.requestId}:${input.status}`,
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;')
}
