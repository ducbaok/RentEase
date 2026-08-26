import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/app/(dashboard)/invoices/_components/format'
import { MaintenanceStatusBadge } from './status-badge'
import type { MaintenanceDetail } from '@/lib/data/maintenance'

/**
 * The shared view of one request — the same body the resident and the operator
 * see, so both read the identical problem, description and photos. The operator
 * page passes a status control as `control`; the portal passes nothing.
 */
export function RequestDetail({
  request,
  showTenant = false,
  control,
}: {
  request: MaintenanceDetail
  showTenant?: boolean
  control?: ReactNode
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>{request.title}</CardTitle>
            <p className="text-sm text-muted-foreground">
              Unit {request.unitCode}
              {showTenant ? ` · ${request.tenantName}` : ''} · reported{' '}
              {formatDateTime(request.createdAt)}
            </p>
          </div>
          <MaintenanceStatusBadge status={request.status} />
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="whitespace-pre-wrap text-sm">
            {request.description?.trim() || 'No further detail was given.'}
          </p>
          {control}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Photos</CardTitle>
        </CardHeader>
        <CardContent>
          {request.photos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No photos were attached.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {request.photos.map((photo) =>
                photo.url ? (
                  <a key={photo.path} href={photo.url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URLs are short-lived and not statically optimisable */}
                    <img
                      src={photo.url}
                      alt="Reported problem"
                      className="aspect-square w-full rounded-md border border-border object-cover"
                    />
                  </a>
                ) : (
                  <div
                    key={photo.path}
                    className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
                  >
                    Photo unavailable
                  </div>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
