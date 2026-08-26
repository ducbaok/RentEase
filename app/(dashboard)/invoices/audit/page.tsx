import type { Metadata } from 'next'
import Link from 'next/link'
import type { Route } from 'next'
import { History } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITIES,
  AUDIT_ENTITY_LABELS,
  AUDIT_PAGE_SIZE,
  isAuditAction,
  isAuditEntity,
  listAuditEntries,
  type AuditAction,
  type AuditEntity,
} from '@/lib/data/audit'
import { AuditChange } from '../_components/audit-change'
import { formatDateTime } from '../_components/format'

export const metadata: Metadata = { title: 'Change history' }

/**
 * Everything that has been changed after the fact, in one place (AC5.2).
 *
 * The per-invoice history on an invoice answers "what happened to this bill".
 * This answers the other question — "what has anyone changed lately" — which is
 * the one that matters when a resident disputes a figure and nobody remembers
 * touching it.
 *
 * Filters are read from the URL and validated against the closed vocabulary in
 * 30-data-model.md before they reach a query. An unrecognised value is dropped
 * rather than passed through, so a hand-edited URL narrows nothing and widens
 * nothing.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; action?: string }>
}) {
  const params = await searchParams
  const entity: AuditEntity | undefined = isAuditEntity(params.entity) ? params.entity : undefined
  const action: AuditAction | undefined = isAuditAction(params.action) ? params.action : undefined

  const { entries, truncated } = await listAuditEntries({ entity, action })
  const filtered = Boolean(entity || action)

  return (
    <>
      <PageHeader
        title="Change history"
        description="Every correction made after an invoice, reading or payment was recorded — who made it, when, and why."
        actions={
          <Button asChild variant="outline">
            <Link href="/invoices">Back to invoices</Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterLink label="Everything" active={!filtered} entity={undefined} action={undefined} />
        {AUDIT_ENTITIES.map((value) => (
          <FilterLink
            key={value}
            label={AUDIT_ENTITY_LABELS[value]}
            active={entity === value}
            entity={entity === value ? undefined : value}
            action={action}
          />
        ))}
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        {AUDIT_ACTIONS.map((value) => (
          <FilterLink
            key={value}
            label={AUDIT_ACTION_LABELS[value]}
            active={action === value}
            entity={entity}
            action={action === value ? undefined : value}
          />
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          {entries.length === 0 ? (
            <EmptyState
              icon={History}
              title={filtered ? 'Nothing matches this filter' : 'Nothing has been changed yet'}
              description={
                filtered
                  ? 'Try a wider filter — the history only records corrections made after something was first recorded.'
                  : 'Corrections to invoices, meter readings and payments are recorded here automatically. An untouched month leaves this page empty, which is the good outcome.'
              }
              action={
                filtered ? (
                  <Button asChild variant="outline">
                    <Link href="/invoices/audit">Show everything</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody data-testid="audit-list">
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap align-top">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell className="align-top">
                      {entry.actorName}
                      {entry.actorEmail && entry.actorEmail !== entry.actorName ? (
                        <div className="text-xs text-muted-foreground">{entry.actorEmail}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline">
                          {AUDIT_ENTITY_LABELS[entry.entity as AuditEntity] ?? entry.entity}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {AUDIT_ACTION_LABELS[entry.action as AuditAction] ?? entry.action}
                        </span>
                      </div>
                      {entry.entity === 'invoice' ? (
                        <Link
                          href={`/invoices/${entry.entityId}` as Route}
                          className="mt-1 block text-xs text-primary underline-offset-4 hover:underline"
                        >
                          Open the invoice
                        </Link>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      <AuditChange oldValue={entry.oldValue} newValue={entry.newValue} />
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {entry.reason ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {truncated ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Showing the {AUDIT_PAGE_SIZE} most recent changes. Older entries are still recorded —
              open an individual invoice to see its full history.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </>
  )
}

/**
 * A filter chip. Clicking an active one clears it, so the filters compose
 * without needing a separate "clear" control for each.
 */
function FilterLink({
  label,
  active,
  entity,
  action,
}: {
  label: string
  active: boolean
  entity: AuditEntity | undefined
  action: AuditAction | undefined
}) {
  const query = new URLSearchParams()
  if (entity) query.set('entity', entity)
  if (action) query.set('action', action)
  const suffix = query.toString()

  return (
    <Button asChild size="sm" variant={active ? 'default' : 'outline'}>
      <Link href={(suffix ? `/invoices/audit?${suffix}` : '/invoices/audit') as Route}>{label}</Link>
    </Button>
  )
}
