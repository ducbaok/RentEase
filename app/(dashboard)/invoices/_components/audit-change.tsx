import { formatCents } from '@/lib/domain/money'

/**
 * Renders an audit entry as the fields that actually moved.
 *
 * Showing the whole before/after JSON would bury a $50 rent reduction in six
 * unchanged keys, so only differing fields are printed, old → new.
 *
 * The labels cover every field the three writers record — invoices
 * (lib/data/invoices.ts), meter readings (lib/data/meters.ts) and payments
 * (lib/data/payments.ts). A key with no label prints as itself: an unlabelled
 * field is still worth reading, and losing it would be worse than showing a
 * column name to a landlord.
 */
const LABELS: Record<string, string> = {
  // invoice
  rent_cents: 'Rent',
  other_cents: 'Other charges',
  total_cents: 'Total',
  due_date: 'Due date',
  // meter_reading
  electric_curr: 'Electric reading',
  water_curr: 'Water reading',
  electric_prev: 'Previous electric',
  water_prev: 'Previous water',
  flags: 'Flags',
  // payment
  amount_cents: 'Amount',
  method: 'Method',
  paid_at: 'Received',
  note: 'Note',
  invoice_id: 'Invoice',
}

export function AuditChange({
  oldValue,
  newValue,
}: {
  oldValue: unknown
  newValue: unknown
}) {
  const before = asRecord(oldValue)
  const after = asRecord(newValue)
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  )

  if (keys.length === 0) return <span className="text-muted-foreground">—</span>

  return (
    <ul className="space-y-0.5">
      {keys.map((key) => (
        <li key={key}>
          <span className="font-medium">{LABELS[key] ?? key}</span>{' '}
          <span className="tabular-nums">{render(key, before[key])}</span> →{' '}
          <span className="tabular-nums">{render(key, after[key])}</span>
        </li>
      ))}
    </ul>
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function render(key: string, value: unknown): string {
  // `undefined` means the key was absent on that side (a create or a delete);
  // `null` means it was recorded as empty. Both read as "nothing" here, and the
  // action column already says which of the two happened.
  if (value === undefined || value === null) return '—'
  if (key.endsWith('_cents') && typeof value === 'number') return formatCents(value)
  if (Array.isArray(value)) return value.length === 0 ? 'none' : value.join(', ')
  return String(value)
}
