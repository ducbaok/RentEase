import { Badge } from '@/components/ui/badge'
import {
  MAINTENANCE_STATUS_LABELS,
  type MaintenanceStatus,
} from '@/lib/data/maintenance-status'

/**
 * Maintenance status, coloured by how much is left to do: submitted is neutral,
 * in progress is amber (someone owes it attention), done is green. Shared by the
 * operator dashboard and the resident portal so both name a status the same way.
 */
const VARIANTS: Record<MaintenanceStatus, 'secondary' | 'warning' | 'success'> = {
  submitted: 'secondary',
  in_progress: 'warning',
  done: 'success',
}

export function MaintenanceStatusBadge({ status }: { status: MaintenanceStatus }) {
  return <Badge variant={VARIANTS[status]}>{MAINTENANCE_STATUS_LABELS[status]}</Badge>
}
