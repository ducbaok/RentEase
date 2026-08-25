import { Badge } from '@/components/ui/badge'
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '@/lib/domain/invoice-status'

/**
 * Status, coloured by what the landlord has to do about it.
 *
 * Overdue is the only red one. Partial is amber rather than green on purpose:
 * money arrived, but the invoice is still owed — and once it is also late the
 * status itself becomes `overdue`, because that is the list you chase from.
 */
const VARIANTS: Record<InvoiceStatus, 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'> = {
  draft: 'outline',
  sent: 'secondary',
  partial: 'warning',
  paid: 'success',
  overdue: 'destructive',
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge variant={VARIANTS[status]}>{INVOICE_STATUS_LABELS[status]}</Badge>
}
