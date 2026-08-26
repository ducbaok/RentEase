import { describe, expect, it } from 'vitest'
import {
  buildDemoDataset,
  DEMO_EMAIL_DOMAIN,
  DEMO_ORG_ID,
  DEMO_PERIOD_END,
  DEMO_SUBSCRIPTION_STATUS,
  shiftDay,
  type DemoDataset,
} from '@/app/api/cron/demo-reset/dataset'
import { computeInvoiceStatus, type InvoiceStatus } from '@/lib/domain/invoice-status'
import { REMINDER_SCHEDULE, addDays } from '@/lib/domain/reminders'
import { parseBreakdown } from '@/lib/domain/breakdown'

/**
 * The demo dataset (D23), proved where it is cheapest to prove: as a pure
 * function, with no database and no clock.
 *
 * The three D23 constraints and the four-status coverage are the whole reason
 * this file exists. Checking them here rather than end-to-end is not a
 * shortcut — it is the only place they can be checked honestly. The reminder
 * cron re-derives every invoice's status for whatever `as_of` it is run with,
 * against a database shared with the other stream, so an assertion that "the
 * demo has an overdue invoice" made against live rows would be measuring the
 * last suite to run. Here the answer depends on nothing but the anchor.
 *
 * Several anchors are exercised, not one. The statuses have to hold on the
 * first of the month and on the twenty-eighth, in a leap February and in a
 * 31-day month — that is precisely the drift the offset scheme exists to stop.
 */

const ANCHORS = [
  '2026-08-26', // the day this was written
  '2026-01-01', // year boundary
  '2026-02-28',
  '2028-02-29', // leap day
  '2026-03-31', // month with 31 days, anchored on the last
  '2026-12-15',
]

function statusesIn(data: DemoDataset): Set<InvoiceStatus> {
  const paidByInvoice = new Map<string, number>()
  for (const payment of data.payments) {
    paidByInvoice.set(
      payment.invoice_id,
      (paidByInvoice.get(payment.invoice_id) ?? 0) + payment.amount_cents,
    )
  }

  return new Set(
    data.invoices.map((invoice) =>
      computeInvoiceStatus({
        issuedAt: invoice.issued_at,
        totalCents: invoice.expectedTotalCents,
        paidCents: paidByInvoice.get(invoice.id) ?? 0,
        dueDate: invoice.due_date,
        asOf: data.anchor,
      }),
    ),
  )
}

describe('the demo dataset is deterministic', () => {
  it('returns identical rows, ids included, for the same anchor', () => {
    expect(buildDemoDataset('2026-08-26')).toEqual(buildDemoDataset('2026-08-26'))
  })

  it('gives every row a distinct id', () => {
    const data = buildDemoDataset('2026-08-26')
    const ids = [
      ...data.properties,
      ...data.units,
      ...data.tenants,
      ...data.leases,
      ...data.tariffs,
      ...data.readings,
      ...data.invoices,
      ...data.payments,
      ...data.maintenance,
    ].map((row) => row.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('puts every row in the demo organization and nowhere else', () => {
    const data = buildDemoDataset('2026-08-26')
    const orgIds = new Set(
      [
        ...data.properties,
        ...data.units,
        ...data.tenants,
        ...data.leases,
        ...data.tariffs,
        ...data.readings,
        ...data.invoices,
        ...data.payments,
        ...data.maintenance,
      ].map((row) => row.org_id),
    )

    expect([...orgIds]).toEqual([DEMO_ORG_ID])
  })
})

describe('D23 constraint 1 — demo residents cannot be emailed for real', () => {
  it.each(ANCHORS)('every resident address is @example.com (%s)', (anchor) => {
    const data = buildDemoDataset(anchor)
    expect(data.tenants.length).toBeGreaterThan(0)
    for (const tenant of data.tenants) {
      expect(tenant.email.endsWith(DEMO_EMAIL_DOMAIN), tenant.email).toBe(true)
    }
  })

  it.each(ANCHORS)('no invoice sits in a reminder window on the anchor day (%s)', (anchor) => {
    const data = buildDemoDataset(anchor)
    const windows = new Set(
      data.invoices.flatMap((invoice) =>
        REMINDER_SCHEDULE.map(({ offsetDays }) => addDays(invoice.due_date, offsetDays)),
      ),
    )
    // Belt to constraint 1's braces: a fresh reset gives the nightly reminder
    // job nothing to send about the demo at all, real address or not.
    expect(windows.has(anchor)).toBe(false)
  })
})

describe('D23 constraint 2 — the demo subscription never expires', () => {
  it('is active, and ends far beyond any trial', () => {
    expect(DEMO_SUBSCRIPTION_STATUS).toBe('active')
    expect(new Date(DEMO_PERIOD_END).getUTCFullYear()).toBeGreaterThan(2090)
  })
})

describe('the four invoice statuses are visible on any day of the year', () => {
  it.each(ANCHORS)('paid, partial, overdue and sent all appear (%s)', (anchor) => {
    const statuses = statusesIn(buildDemoDataset(anchor))
    expect([...statuses].sort()).toEqual(['overdue', 'paid', 'partial', 'sent'])
  })

  it.each(ANCHORS)('overdue outranks partial on a late part-paid invoice (%s)', (anchor) => {
    const data = buildDemoDataset(anchor)
    const partPaid = data.payments.filter((payment) => {
      const invoice = data.invoices.find((row) => row.id === payment.invoice_id)!
      return payment.amount_cents < invoice.expectedTotalCents && invoice.due_date < anchor
    })

    // AC5.1's hardest case is the one a demo most needs to show: money arrived,
    // the invoice is still late, and it stays in the collections list.
    expect(partPaid.length).toBeGreaterThan(0)
    for (const payment of partPaid) {
      const invoice = data.invoices.find((row) => row.id === payment.invoice_id)!
      expect(
        computeInvoiceStatus({
          issuedAt: invoice.issued_at,
          totalCents: invoice.expectedTotalCents,
          paidCents: payment.amount_cents,
          dueDate: invoice.due_date,
          asOf: anchor,
        }),
      ).toBe('overdue')
    }
  })
})

describe('the demo looks like a real small portfolio (D23)', () => {
  const data = buildDemoDataset('2026-08-26')

  it('has two to three properties and twelve to fifteen units', () => {
    expect(data.properties.length).toBeGreaterThanOrEqual(2)
    expect(data.properties.length).toBeLessThanOrEqual(3)
    expect(data.units.length).toBeGreaterThanOrEqual(12)
    expect(data.units.length).toBeLessThanOrEqual(15)
  })

  it('has active leases and one or two that have ended', () => {
    const active = data.leases.filter((lease) => lease.status === 'active')
    const ended = data.leases.filter((lease) => lease.status === 'ended')
    expect(active.length).toBeGreaterThan(0)
    expect(ended.length).toBeGreaterThanOrEqual(1)
    expect(ended.length).toBeLessThanOrEqual(2)
  })

  it('leaves some units vacant, so occupancy is a real number', () => {
    const let_ = new Set(
      data.leases.filter((lease) => lease.status === 'active').map((lease) => lease.unit_id),
    )
    expect(let_.size).toBeLessThan(data.units.length)
  })

  it('never puts two active leases on one unit', () => {
    const units = data.leases
      .filter((lease) => lease.status === 'active')
      .map((lease) => lease.unit_id)
    expect(new Set(units).size).toBe(units.length)
  })

  it('covers three or four months of readings for every unit', () => {
    expect(data.periods.length).toBeGreaterThanOrEqual(3)
    expect(data.periods.length).toBeLessThanOrEqual(4)
    for (const unit of data.units) {
      const forUnit = data.readings.filter((row) => row.unit_id === unit.id)
      expect(forUnit.length, `readings for unit ${unit.code}`).toBe(data.periods.length)
    }
  })

  it('never records a meter going backwards, which would raise a flag to explain', () => {
    for (const reading of data.readings) {
      expect(reading.electric_curr).toBeGreaterThanOrEqual(reading.electric_prev)
      expect(reading.water_curr).toBeGreaterThanOrEqual(reading.water_prev)
    }
  })

  it('shows maintenance in all three states', () => {
    expect(new Set(data.maintenance.map((row) => row.status))).toEqual(
      new Set(['submitted', 'in_progress', 'done']),
    )
  })

  it('bills at most one invoice per lease and period', () => {
    const keys = data.invoices.map((invoice) => `${invoice.lease_id}:${invoice.period}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('the demo money is the product’s own arithmetic', () => {
  const data = buildDemoDataset('2026-08-26')

  it('has a breakdown that adds up to the total on every invoice', () => {
    for (const invoice of data.invoices) {
      const lines = parseBreakdown(invoice.breakdown)
      const sum = lines.reduce((total, line) => total + line.amount_cents, 0)
      expect(sum, `invoice ${invoice.id}`).toBe(invoice.expectedTotalCents)
    }
  })

  it('has columns that add up to the total on every invoice', () => {
    for (const invoice of data.invoices) {
      expect(
        invoice.rent_cents +
          invoice.electric_cents +
          invoice.water_cents +
          invoice.service_cents +
          invoice.other_cents,
      ).toBe(invoice.expectedTotalCents)
    }
  })

  it('never records a payment larger than its invoice', () => {
    for (const payment of data.payments) {
      const invoice = data.invoices.find((row) => row.id === payment.invoice_id)
      expect(invoice, `payment ${payment.id} has no invoice`).toBeDefined()
      expect(payment.amount_cents).toBeGreaterThan(0)
      expect(payment.amount_cents).toBeLessThanOrEqual(invoice!.expectedTotalCents)
    }
  })
})

describe('nothing in the demo is dated in the future', () => {
  it.each(ANCHORS)('invoices are issued and payments received by the anchor (%s)', (anchor) => {
    const data = buildDemoDataset(anchor)
    // Tomorrow, to allow for the anchor day itself being a legitimate date.
    const limit = shiftDay(anchor, 1)

    for (const invoice of data.invoices) {
      expect(invoice.issued_at.slice(0, 10) < limit, `invoice ${invoice.id}`).toBe(true)
    }
    for (const payment of data.payments) {
      expect(payment.paid_at.slice(0, 10) < limit, `payment ${payment.id}`).toBe(true)
    }
    for (const lease of data.leases) {
      expect(lease.start_date < limit, `lease ${lease.id}`).toBe(true)
    }
  })
})
