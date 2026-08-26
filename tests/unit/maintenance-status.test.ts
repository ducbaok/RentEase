import { describe, expect, it } from 'vitest'
import {
  MAINTENANCE_STATUS_ORDER,
  canTransition,
  maintenancePhotoPath,
  nextStatus,
} from '@/lib/data/maintenance-status'

describe('maintenance status flow', () => {
  it('advances one step at a time along submitted → in_progress → done', () => {
    expect(nextStatus('submitted')).toBe('in_progress')
    expect(nextStatus('in_progress')).toBe('done')
    expect(nextStatus('done')).toBeNull()
  })

  it('allows only the adjacent forward move', () => {
    expect(canTransition('submitted', 'in_progress')).toBe(true)
    expect(canTransition('in_progress', 'done')).toBe(true)

    // No skipping a step, no going backwards, no standing still.
    expect(canTransition('submitted', 'done')).toBe(false)
    expect(canTransition('in_progress', 'submitted')).toBe(false)
    expect(canTransition('done', 'in_progress')).toBe(false)
    expect(canTransition('submitted', 'submitted')).toBe(false)
  })

  it('lists the statuses in order', () => {
    expect([...MAINTENANCE_STATUS_ORDER]).toEqual(['submitted', 'in_progress', 'done'])
  })
})

describe('photo storage paths', () => {
  const org = 'a0000000-0000-4000-8000-000000000001'
  const req = 'a0000000-0000-4000-8000-000000000060'

  it('builds {org}/{request}/{filename}', () => {
    expect(maintenancePhotoPath(org, req, 'leak.jpg')).toBe(`${org}/${req}/leak.jpg`)
  })

  it('never lets a filename escape the request folder', () => {
    // A crafted name must not add path segments — the path IS the permission.
    const path = maintenancePhotoPath(org, req, '../../b-org/evil.jpg')
    expect(path).toBe(`${org}/${req}/evil.jpg`)
    expect(path.split('/')).toHaveLength(3)

    const windowsy = maintenancePhotoPath(org, req, 'C:\\Users\\x\\photo.png')
    expect(windowsy.split('/')).toHaveLength(3)
    expect(windowsy.endsWith('photo.png')).toBe(true)
  })

  it('flattens odd characters rather than rejecting the upload', () => {
    const path = maintenancePhotoPath(org, req, 'my photo (1)!.jpeg')
    expect(path).toBe(`${org}/${req}/my_photo__1__.jpeg`)
  })

  it('always yields a usable filename', () => {
    expect(maintenancePhotoPath(org, req, '')).toBe(`${org}/${req}/photo`)
    expect(maintenancePhotoPath(org, req, '...')).toBe(`${org}/${req}/photo`)
  })
})
