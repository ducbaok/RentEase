/**
 * Maintenance request status — the small pure core of F8.
 *
 * Kept free of any IO import so it can be unit-tested directly and shared
 * between the resident portal, the operator dashboard and the notification
 * templates without dragging a Supabase client into a test runner.
 *
 * The flow is linear: submitted → in_progress → done. A resident never advances
 * it (they have no UPDATE policy at all); the operator does, and each step is
 * what sends the resident an email (AC8.1). Only the adjacent forward step is
 * offered, so "done" is a deliberate two-click journey from "submitted", never
 * an accidental one.
 */

export type MaintenanceStatus = 'submitted' | 'in_progress' | 'done'

export const MAINTENANCE_STATUS_ORDER: readonly MaintenanceStatus[] = [
  'submitted',
  'in_progress',
  'done',
]

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  submitted: 'Submitted',
  in_progress: 'In progress',
  done: 'Done',
}

/** What the resident is told the status now means, in the notification. */
export const MAINTENANCE_STATUS_SUMMARY: Record<MaintenanceStatus, string> = {
  submitted: 'We have received your request.',
  in_progress: 'Someone is now working on your request.',
  done: 'Your request has been marked as done.',
}

/** The single status an operator may move a request to next, if any. */
export function nextStatus(current: MaintenanceStatus): MaintenanceStatus | null {
  const index = MAINTENANCE_STATUS_ORDER.indexOf(current)
  return MAINTENANCE_STATUS_ORDER[index + 1] ?? null
}

/** True only for a move to the immediately following status. */
export function canTransition(from: MaintenanceStatus, to: MaintenanceStatus): boolean {
  return nextStatus(from) === to
}

/**
 * The storage object path for a photo: '{org_id}/{request_id}/{filename}'.
 *
 * The path IS the permission — the storage policies in migration 0800 read the
 * first two segments — so the filename is sanitised to a single segment here: no
 * slashes can smuggle a photo into another request's folder, and odd characters
 * are flattened rather than rejected so a resident's phone photo always uploads.
 */
export function maintenancePhotoPath(
  orgId: string,
  requestId: string,
  filename: string,
): string {
  const base = filename.split(/[/\\]/).pop() || 'photo'
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(-100) || 'photo'
  return `${orgId}/${requestId}/${safe}`
}
