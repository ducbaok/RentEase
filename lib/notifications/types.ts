/**
 * Notification provider interface.
 *
 * Email through Resend is the only channel in the MVP (decision D2), but the
 * reminder job, the invoice issuer and the maintenance flow all talk to THIS
 * interface, never to Resend. Adding SMS later is then a new file implementing
 * `NotificationProvider` — not an edit to the logic that decides who gets
 * chased, which is the part that must not be disturbed once it is correct.
 */

export type NotificationKind =
  | 'portal_invite'
  | 'invoice_issued'
  | 'reminder_before_due'
  | 'reminder_overdue_1'
  | 'reminder_overdue_7'
  | 'maintenance_status_changed'

export interface Notification {
  kind: NotificationKind
  to: string
  subject: string
  /** Plain-text body. Always provided — some clients never render the HTML. */
  text: string
  html: string
  /**
   * Stable key for one logical message, e.g. `reminder:{invoiceId}:overdue_1`.
   * Providers that support deduplication use it. It is a second line of
   * defence only: the real guarantee against duplicate reminders is the
   * UNIQUE (invoice_id, kind) constraint on reminder_logs (AC6.2).
   */
  idempotencyKey?: string
}

export interface SendResult {
  delivered: boolean
  /** Provider-side message id, when there is one. */
  id: string | null
  error?: string
}

export interface NotificationProvider {
  readonly name: string
  send(notification: Notification): Promise<SendResult>
}
