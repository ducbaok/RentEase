import { Badge } from '@/components/ui/badge'

/**
 * Subscription state, coloured by whether it needs attention.
 *
 * `subscriptions.status` is free text, not an enum, because Stripe owns the
 * vocabulary and adds to it — so unknown values must render as themselves
 * rather than crash or be silently dropped. A status nobody has seen before is
 * exactly the kind of thing the back office exists to surface.
 */
type Variant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'

const VARIANTS: Record<string, Variant> = {
  active: 'success',
  trialing: 'secondary',
  past_due: 'warning',
  unpaid: 'destructive',
  canceled: 'destructive',
  incomplete: 'warning',
  incomplete_expired: 'destructive',
  paused: 'outline',
}

const LABELS: Record<string, string> = {
  active: 'Active',
  trialing: 'Trialing',
  past_due: 'Past due',
  unpaid: 'Unpaid',
  canceled: 'Canceled',
  incomplete: 'Incomplete',
  incomplete_expired: 'Expired',
  paused: 'Paused',
}

export function SubscriptionBadge({ status }: { status: string }) {
  return <Badge variant={VARIANTS[status] ?? 'outline'}>{LABELS[status] ?? status}</Badge>
}
