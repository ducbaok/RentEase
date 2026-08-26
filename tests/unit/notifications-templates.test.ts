import { describe, expect, it } from 'vitest'
import { buildPortalInviteEmail } from '@/lib/notifications/templates/portal'
import { buildMaintenanceStatusEmail } from '@/lib/notifications/templates/maintenance'

describe('portal invite email', () => {
  const email = buildPortalInviteEmail({
    to: 'dana@resident.test',
    tenantName: 'Dana Whitfield',
    orgName: 'Northside Rentals',
    loginUrl: 'https://app.example.com/magic-link',
  })

  it('is a portal_invite addressed to the resident', () => {
    expect(email.kind).toBe('portal_invite')
    expect(email.to).toBe('dana@resident.test')
  })

  it('names the landlord and carries the sign-in link in both bodies', () => {
    expect(email.subject).toContain('Northside Rentals')
    expect(email.text).toContain('https://app.example.com/magic-link')
    expect(email.html).toContain('https://app.example.com/magic-link')
    expect(email.text).toContain('Dana Whitfield')
  })
})

describe('maintenance status email', () => {
  const email = buildMaintenanceStatusEmail({
    to: 'dana@resident.test',
    tenantName: 'Dana Whitfield',
    requestId: 'a0000000-0000-4000-8000-000000000060',
    title: 'Kitchen faucet is leaking',
    unitCode: '101',
    status: 'in_progress',
    requestUrl: 'https://app.example.com/portal/maintenance/a0000000-0000-4000-8000-000000000060',
  })

  it('is a maintenance_status_changed to the resident', () => {
    expect(email.kind).toBe('maintenance_status_changed')
    expect(email.to).toBe('dana@resident.test')
  })

  it('names the request and the new status', () => {
    expect(email.subject).toContain('Kitchen faucet is leaking')
    expect(email.subject).toContain('In progress')
    expect(email.text).toContain('Unit 101')
    expect(email.text).toContain('Someone is now working on your request.')
  })

  it('keys idempotency to (request, status) so a resend never duplicates', () => {
    expect(email.idempotencyKey).toBe(
      'maintenance:a0000000-0000-4000-8000-000000000060:in_progress',
    )
    // A different status is a different message.
    const done = buildMaintenanceStatusEmail({
      to: 'x',
      tenantName: 'x',
      requestId: 'a0000000-0000-4000-8000-000000000060',
      title: 't',
      unitCode: '101',
      status: 'done',
      requestUrl: 'u',
    })
    expect(done.idempotencyKey).not.toBe(email.idempotencyKey)
  })

  it('links to the resident copy of the request', () => {
    expect(email.text).toContain('/portal/maintenance/a0000000-0000-4000-8000-000000000060')
  })
})
