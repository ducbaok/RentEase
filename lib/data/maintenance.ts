/**
 * Maintenance requests (F8) — resident and operator data access.
 *
 * Two RLS shapes meet here. A resident may SELECT their own requests and INSERT
 * one for a unit they lease, always at status 'submitted' (they have no UPDATE
 * policy at all — advancing the status is the operator's act, and it is what
 * notifies them). An operator has full access within their own org.
 *
 * PHOTOS. The bucket path '{org_id}/{request_id}/{filename}' is the permission
 * (migration 0800), and the request row must exist before a photo can be
 * uploaded into its folder. A resident also cannot UPDATE the row to record the
 * paths afterwards — so the row is inserted with the intended paths already in
 * place (the id is generated up front) and the files are uploaded to them next.
 * Order preserved: row first, objects second.
 */

import { createClient } from '@/lib/supabase/server'
import { requireOperator, requireTenant } from '@/lib/auth'
import { APP_URL } from '@/lib/env'
import { getNotificationProvider } from '@/lib/notifications/providers'
import { buildMaintenanceStatusEmail } from '@/lib/notifications/templates/maintenance'
import {
  canTransition,
  maintenancePhotoPath,
  type MaintenanceStatus,
} from '@/lib/data/maintenance-status'
import type { Database } from '@/lib/types/database'

const BUCKET = 'maintenance-photos'
/** Signed URLs live long enough to view the page, not to be shared around. */
const SIGNED_URL_TTL_SECONDS = 60 * 10

type RequestRow = Database['public']['Tables']['maintenance_requests']['Row']

export interface MaintenanceListItem {
  id: string
  title: string
  status: MaintenanceStatus
  unitCode: string
  tenantName: string
  photoCount: number
  createdAt: string
  updatedAt: string
}

type RequestWithJoins = RequestRow & {
  units: { code: string }
  tenants: { full_name: string; email: string | null }
}

const REQUEST_JOIN = '*, units!inner(code), tenants!inner(full_name, email)'

function toListItem(row: RequestWithJoins): MaintenanceListItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    unitCode: row.units.code,
    tenantName: row.tenants.full_name,
    photoCount: row.photos.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface MaintenancePhoto {
  path: string
  /** Null when the object could not be signed (e.g. an upload that never landed). */
  url: string | null
}

export interface MaintenanceDetail {
  id: string
  title: string
  description: string | null
  status: MaintenanceStatus
  unitCode: string
  tenantName: string
  createdAt: string
  updatedAt: string
  photos: MaintenancePhoto[]
}

async function signPhotos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: string[],
): Promise<MaintenancePhoto[]> {
  if (paths.length === 0) return []
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
  if (error) {
    // A signing failure must not blank the whole request; show the rows without
    // a link rather than 500ing the page.
    return paths.map((path) => ({ path, url: null }))
  }
  return (data ?? []).map((item) => ({ path: item.path ?? '', url: item.signedUrl ?? null }))
}

function toDetail(row: RequestWithJoins, photos: MaintenancePhoto[]): MaintenanceDetail {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    unitCode: row.units.code,
    tenantName: row.tenants.full_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    photos,
  }
}

// ---------------------------------------------------------------------------
// Resident
// ---------------------------------------------------------------------------

/** The units a resident may open a request against — their own leased units. */
export interface PortalUnitOption {
  id: string
  code: string
  propertyName: string
}

export async function getPortalUnits(): Promise<PortalUnitOption[]> {
  await requireTenant()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('leases')
    .select('units!inner(id, code, properties!inner(name))')
    .eq('status', 'active')

  if (error) throw new Error(error.message)

  const seen = new Map<string, PortalUnitOption>()
  for (const row of (data ?? []) as Array<{
    units: { id: string; code: string; properties: { name: string } }
  }>) {
    seen.set(row.units.id, {
      id: row.units.id,
      code: row.units.code,
      propertyName: row.units.properties.name,
    })
  }
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
}

export async function listMyRequests(): Promise<MaintenanceListItem[]> {
  await requireTenant()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('maintenance_requests')
    .select(REQUEST_JOIN)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return ((data ?? []) as RequestWithJoins[]).map(toListItem)
}

export async function getMyRequest(id: string): Promise<MaintenanceDetail | null> {
  await requireTenant()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('maintenance_requests')
    .select(REQUEST_JOIN)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null
  const row = data as RequestWithJoins
  return toDetail(row, await signPhotos(supabase, row.photos))
}

export interface CreateRequestInput {
  unitId: string
  title: string
  description?: string
  /** Files to attach; uploaded after the row exists. */
  photos: File[]
}

/**
 * Files a request and uploads its photos.
 *
 * The id is generated here so the photo paths can be built and stored on the row
 * at insert time — the resident has no UPDATE policy to add them afterwards. The
 * row is inserted first, then each file is uploaded into its folder, honouring
 * the order the storage policy depends on.
 */
export async function createMaintenanceRequest(input: CreateRequestInput): Promise<string> {
  const { orgId, tenantId } = await requireTenant()
  const supabase = await createClient()

  const title = input.title.trim()
  if (!title) throw new Error('Give the problem a short title.')

  const id = crypto.randomUUID()
  const files = input.photos.filter((file) => file.size > 0)
  const paths = files.map((file) => maintenancePhotoPath(orgId, id, file.name))

  const { error: insertError } = await supabase.from('maintenance_requests').insert({
    id,
    org_id: orgId,
    tenant_id: tenantId,
    unit_id: input.unitId,
    title,
    description: input.description?.trim() || null,
    photos: paths,
    status: 'submitted',
  })

  if (insertError) throw new Error(insertError.message)

  for (let i = 0; i < files.length; i++) {
    const file = files[i] as File
    const path = paths[i] as string
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (uploadError) throw new Error(`Photo failed to upload: ${uploadError.message}`)
  }

  return id
}

// ---------------------------------------------------------------------------
// Operator
// ---------------------------------------------------------------------------

export async function listOrgRequests(
  statusFilter?: MaintenanceStatus,
): Promise<MaintenanceListItem[]> {
  await requireOperator()
  const supabase = await createClient()
  let query = supabase.from('maintenance_requests').select(REQUEST_JOIN)
  if (statusFilter) query = query.eq('status', statusFilter)

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as RequestWithJoins[]).map(toListItem)
}

export async function getOrgRequest(id: string): Promise<MaintenanceDetail | null> {
  await requireOperator()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('maintenance_requests')
    .select(REQUEST_JOIN)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null
  const row = data as RequestWithJoins
  return toDetail(row, await signPhotos(supabase, row.photos))
}

/**
 * Advances a request to the next status and emails the resident (AC8.1).
 *
 * The transition is checked against the linear flow, so a stale form cannot jump
 * a request from 'submitted' straight to 'done'. The email is best-effort: it
 * must not roll back a status the operator already committed, so a send failure
 * is surfaced but the new status stands.
 */
export async function advanceMaintenanceStatus(
  id: string,
  to: MaintenanceStatus,
): Promise<{ status: MaintenanceStatus; emailed: boolean }> {
  await requireOperator()
  const supabase = await createClient()

  const { data: current, error: readError } = await supabase
    .from('maintenance_requests')
    .select(REQUEST_JOIN)
    .eq('id', id)
    .maybeSingle()

  if (readError) throw new Error(readError.message)
  if (!current) throw new Error('That request no longer exists.')

  const row = current as RequestWithJoins
  if (!canTransition(row.status, to)) {
    throw new Error(`A request that is "${row.status}" cannot move to "${to}".`)
  }

  const { data: updated, error: updateError } = await supabase
    .from('maintenance_requests')
    .update({ status: to })
    .eq('id', id)
    .select(REQUEST_JOIN)
    .single()

  if (updateError) throw new Error(updateError.message)
  const next = updated as RequestWithJoins

  let emailed = false
  if (next.tenants.email) {
    // Best-effort: the status is already committed, so a provider failure must
    // not surface as if the change did not happen. The notification is retried
    // by the operator moving the status, not by rolling this back.
    try {
      const result = await getNotificationProvider().send(
        buildMaintenanceStatusEmail({
          to: next.tenants.email,
          tenantName: next.tenants.full_name,
          requestId: next.id,
          title: next.title,
          unitCode: next.units.code,
          status: to,
          requestUrl: `${APP_URL}/portal/maintenance/${next.id}`,
        }),
      )
      emailed = result.delivered
    } catch {
      emailed = false
    }
  }

  return { status: to, emailed }
}
