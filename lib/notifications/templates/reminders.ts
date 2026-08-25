/**
 * Reminder email templates (F6, decision D2).
 *
 * These build a `Notification` for the provider interface — never Resend
 * directly — from data the invoice already carries. The money shown is read
 * straight off the invoice: `total_cents` and `paid_cents` are trigger-computed
 * columns and the line items come from the breakdown SNAPSHOT taken at issue
 * time. Nothing here multiplies a rate or sums a consumption again; a reminder
 * that recomputed the total could disagree with the invoice the resident is
 * looking at, which is the one bug a dunning email cannot have.
 */

import type { Notification, NotificationKind } from '../types'
import type { ReminderKind } from '@/lib/domain/reminders'
import { formatCents } from '@/lib/domain/money'
import { outstandingCents } from '@/lib/domain/invoice-status'
import { formatPeriod, type Period } from '@/lib/domain/period'

export interface ReminderLine {
  label: string
  amountCents: number
}

export interface ReminderEmailInput {
  kind: ReminderKind
  invoice: {
    id: string
    period: string
    /** 'YYYY-MM-DD' */
    dueDate: string
    totalCents: number
    paidCents: number
  }
  /** ISO currency code from the organization, e.g. 'USD'. */
  currency: string
  /** The breakdown snapshot, passed through for display — not recomputed. */
  lines: ReminderLine[]
  unitCode: string
  propertyName: string
  tenantName: string
  recipientEmail: string
  /** Base URL of the resident portal, for the "view invoice" link. */
  appUrl?: string
}

const NOTIFICATION_KIND: Record<ReminderKind, NotificationKind> = {
  before_due: 'reminder_before_due',
  overdue_1: 'reminder_overdue_1',
  overdue_7: 'reminder_overdue_7',
}

/** The stable dedup key for one logical reminder — mirrors reminder_logs' UNIQUE. */
export function reminderIdempotencyKey(invoiceId: string, kind: ReminderKind): string {
  return `reminder:${invoiceId}:${kind}`
}

function headline(input: ReminderEmailInput, periodLabel: string): { subject: string; lead: string } {
  const place = `${input.propertyName} · Unit ${input.unitCode}`
  switch (input.kind) {
    case 'before_due':
      return {
        subject: `Rent for ${periodLabel} is due ${input.invoice.dueDate}`,
        lead: `This is a friendly reminder that your invoice for ${place} is due on ${input.invoice.dueDate}.`,
      }
    case 'overdue_1':
      return {
        subject: `Rent for ${periodLabel} is now overdue`,
        lead: `Your invoice for ${place} was due on ${input.invoice.dueDate} and is now past due.`,
      }
    case 'overdue_7':
      return {
        subject: `Rent for ${periodLabel} is a week overdue`,
        lead: `Your invoice for ${place} has been overdue since ${input.invoice.dueDate}. Please arrange payment.`,
      }
  }
}

export function buildReminderEmail(input: ReminderEmailInput): Notification {
  const periodLabel = formatPeriod(input.invoice.period as Period)
  const { subject, lead } = headline(input, periodLabel)

  const total = formatCents(input.invoice.totalCents, input.currency)
  const paid = formatCents(input.invoice.paidCents, input.currency)
  const outstanding = formatCents(
    outstandingCents(input.invoice.totalCents, input.invoice.paidCents),
    input.currency,
  )

  const lineText = input.lines
    .map((line) => `  ${line.label}: ${formatCents(line.amountCents, input.currency)}`)
    .join('\n')

  const portalLink = input.appUrl ? `${input.appUrl.replace(/\/$/, '')}/portal` : null

  const text = [
    `Hi ${input.tenantName},`,
    '',
    lead,
    '',
    `Invoice for ${periodLabel}`,
    lineText,
    `  ---`,
    `  Total: ${total}`,
    `  Paid so far: ${paid}`,
    `  Amount due: ${outstanding}`,
    '',
    portalLink ? `View the full invoice: ${portalLink}` : '',
    '',
    'Thank you,',
    'RentEase',
  ]
    .filter((segment) => segment !== '')
    .join('\n')

  const lineRows = input.lines
    .map(
      (line) =>
        `<tr><td style="padding:2px 12px 2px 0">${escapeHtml(line.label)}</td>` +
        `<td style="padding:2px 0;text-align:right">${formatCents(line.amountCents, input.currency)}</td></tr>`,
    )
    .join('')

  const html = [
    `<p>Hi ${escapeHtml(input.tenantName)},</p>`,
    `<p>${escapeHtml(lead)}</p>`,
    `<p><strong>Invoice for ${escapeHtml(periodLabel)}</strong></p>`,
    `<table style="border-collapse:collapse;font-size:14px">${lineRows}` +
      `<tr><td colspan="2"><hr/></td></tr>` +
      `<tr><td style="padding:2px 12px 2px 0">Total</td><td style="padding:2px 0;text-align:right">${total}</td></tr>` +
      `<tr><td style="padding:2px 12px 2px 0">Paid so far</td><td style="padding:2px 0;text-align:right">${paid}</td></tr>` +
      `<tr><td style="padding:2px 12px 2px 0"><strong>Amount due</strong></td>` +
      `<td style="padding:2px 0;text-align:right"><strong>${outstanding}</strong></td></tr></table>`,
    portalLink ? `<p><a href="${escapeHtml(portalLink)}">View the full invoice</a></p>` : '',
    `<p>Thank you,<br/>RentEase</p>`,
  ]
    .filter((segment) => segment !== '')
    .join('')

  return {
    kind: NOTIFICATION_KIND[input.kind],
    to: input.recipientEmail,
    subject,
    text,
    html,
    idempotencyKey: reminderIdempotencyKey(input.invoice.id, input.kind),
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
