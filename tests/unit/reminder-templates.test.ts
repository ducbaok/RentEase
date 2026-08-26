import { describe, expect, it } from 'vitest'
import {
  buildReminderEmail,
  reminderIdempotencyKey,
  type ReminderEmailInput,
} from '@/lib/notifications/templates/reminders'

/**
 * The reminder emails, checked for the one thing that matters most: they REPORT
 * money, they never recompute it. Every amount in the body must trace back to a
 * cents value handed in, not to a rate times a consumption.
 */

function input(overrides: Partial<ReminderEmailInput> = {}): ReminderEmailInput {
  return {
    kind: 'overdue_1',
    invoice: {
      id: 'inv-1',
      period: '2026-09',
      dueDate: '2026-10-05',
      totalCents: 131698,
      paidCents: 50000,
    },
    currency: 'USD',
    lines: [
      { label: 'Rent', amountCents: 120000 },
      { label: 'Electricity', amountCents: 8778 },
      { label: 'Water', amountCents: 420 },
      { label: 'Service fee', amountCents: 2500 },
    ],
    unitCode: '101',
    propertyName: 'Cedar Court',
    tenantName: 'Dana Whitfield',
    recipientEmail: 'dana@resident.test',
    appUrl: 'http://localhost:3002',
    ...overrides,
  }
}

describe('buildReminderEmail', () => {
  it('shows the outstanding amount as total minus paid, not a re-derived sum', () => {
    const email = buildReminderEmail(input())
    // 131698 - 50000 = 81698 => $816.98
    expect(email.text).toContain('$816.98')
    expect(email.html).toContain('<strong>$816.98</strong>')
    // The trigger-computed total and the paid figure appear verbatim.
    expect(email.text).toContain('$1,316.98')
    expect(email.text).toContain('$500.00')
  })

  it('renders each breakdown line from the snapshot it was given', () => {
    const email = buildReminderEmail(input())
    expect(email.text).toContain('Rent: $1,200.00')
    expect(email.text).toContain('Electricity: $87.78')
    expect(email.text).toContain('Water: $4.20')
    expect(email.text).toContain('Service fee: $25.00')
  })

  it('addresses the resident and links to the portal', () => {
    const email = buildReminderEmail(input())
    expect(email.text).toContain('Hi Dana Whitfield,')
    expect(email.html).toContain('http://localhost:3002/portal')
    expect(email.to).toBe('dana@resident.test')
  })

  it('carries the idempotency key that mirrors reminder_logs', () => {
    const email = buildReminderEmail(input({ kind: 'overdue_7' }))
    expect(email.idempotencyKey).toBe('reminder:inv-1:overdue_7')
    expect(reminderIdempotencyKey('inv-1', 'overdue_7')).toBe('reminder:inv-1:overdue_7')
  })

  it('maps each reminder kind to its own subject and notification kind', () => {
    expect(buildReminderEmail(input({ kind: 'before_due' })).kind).toBe('reminder_before_due')
    expect(buildReminderEmail(input({ kind: 'before_due' })).subject).toMatch(/is due/)

    expect(buildReminderEmail(input({ kind: 'overdue_1' })).kind).toBe('reminder_overdue_1')
    expect(buildReminderEmail(input({ kind: 'overdue_1' })).subject).toMatch(/overdue/)

    expect(buildReminderEmail(input({ kind: 'overdue_7' })).kind).toBe('reminder_overdue_7')
    expect(buildReminderEmail(input({ kind: 'overdue_7' })).subject).toMatch(/week overdue/)
  })

  it('handles a zero-paid invoice — amount due equals the total', () => {
    const email = buildReminderEmail(
      input({ invoice: { id: 'i', period: '2026-09', dueDate: '2026-10-05', totalCents: 98252, paidCents: 0 } }),
    )
    expect(email.text).toContain('Amount due: $982.52')
    expect(email.text).toContain('Paid so far: $0.00')
  })

  it('escapes HTML in resident-supplied names', () => {
    const email = buildReminderEmail(input({ tenantName: 'A & B <script>' }))
    expect(email.html).toContain('A &amp; B &lt;script&gt;')
    expect(email.html).not.toContain('<script>')
  })
})
