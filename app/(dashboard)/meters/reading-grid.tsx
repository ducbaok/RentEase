'use client'

import { useActionState, useMemo, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  detectFlags,
  FLAG_LABELS,
  requiresConfirmation,
  type MeterFlag,
  type UnitHistory,
} from '@/lib/domain/anomaly'
import { consumptionOf } from '@/lib/domain/billing'
import { saveReadingsAction, type MeterFormState } from './actions'

export interface ReadingGridRow {
  unitId: string
  unitCode: string
  propertyName: string
  electricPrev: number
  waterPrev: number
  electricCurr: number | null
  waterCurr: number | null
  history: UnitHistory
  leased: boolean
  savedFlags: MeterFlag[]
  overrideReason: string | null
}

interface Draft {
  electric: string
  water: string
  confirmed: boolean
  reason: string
}

function SaveButton({ count }: { count: number }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || count === 0}>
      {pending ? 'Saving…' : count === 0 ? 'Nothing to save' : `Save ${count} reading${count === 1 ? '' : 's'}`}
    </Button>
  )
}

/**
 * The monthly walk around the building, as a keyboard.
 *
 * Enter moves to the next box in reading order — this unit's electricity, this
 * unit's water, then the next unit — so the whole sheet is typed without a
 * mouse, which is the difference between five minutes and half an hour for
 * someone standing in a hallway with a phone.
 *
 * Last month's number is already filled in and is NOT editable here: it is the
 * previous period's closing reading, and it is re-derived on the server anyway,
 * so letting it be typed over would only create a way to fake a consumption.
 *
 * The warnings shown while typing are the same pure functions the server uses
 * to decide what to refuse (lib/domain/anomaly.ts), so nothing that looks fine
 * here is rejected there, and nothing waved through here is saved there.
 */
export function ReadingGrid({ period, rows }: { period: string; rows: ReadingGridRow[] }) {
  const [state, formAction] = useActionState<MeterFormState, FormData>(saveReadingsAction, {})

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      rows.map((row) => [
        row.unitId,
        {
          electric: row.electricCurr === null ? '' : String(row.electricCurr),
          water: row.waterCurr === null ? '' : String(row.waterCurr),
          confirmed: row.savedFlags.length > 0,
          reason: row.overrideReason ?? '',
        },
      ]),
    ),
  )

  const inputs = useRef<Array<HTMLInputElement | null>>([])

  function update(unitId: string, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [unitId]: { ...(current[unitId] ?? { electric: '', water: '', confirmed: false, reason: '' }), ...patch },
    }))
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const next = inputs.current[index + 1]
    if (next) {
      next.focus()
      next.select()
    } else {
      event.currentTarget.form?.requestSubmit()
    }
  }

  const analysed = useMemo(
    () =>
      rows.map((row) => {
        const draft = drafts[row.unitId]
        const electric = toNumber(draft?.electric)
        const water = toNumber(draft?.water)
        const complete = electric !== null && water !== null

        const flags = complete
          ? detectFlags(
              {
                electric: { prev: row.electricPrev, curr: electric },
                water: { prev: row.waterPrev, curr: water },
              },
              row.history,
            )
          : []

        return {
          row,
          draft,
          complete,
          flags,
          electricUsed: electric === null ? null : consumptionOf({ prev: row.electricPrev, curr: electric }),
          waterUsed: water === null ? null : consumptionOf({ prev: row.waterPrev, curr: water }),
        }
      }),
    [rows, drafts],
  )

  /*
   * Counts every complete row, including ones showing a decrease warning. The
   * refusal in AC3.1 belongs to the server — disabling the button here would
   * make the client the thing that enforces it, and a client is not a rule.
   */
  const readyCount = analysed.filter((entry) => entry.complete).length
  const refused = new Set(state.needsConfirmation ?? [])

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="period" value={period} />

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.message ? (
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Electric last</TableHead>
            <TableHead className="w-36">Electric now</TableHead>
            <TableHead className="text-right">Water last</TableHead>
            <TableHead className="w-36">Water now</TableHead>
            <TableHead>Used</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {analysed.map((entry, rowIndex) => {
            const { row, flags } = entry
            const needsConfirm = requiresConfirmation(flags)

            return (
              <TableRow
                key={row.unitId}
                data-unit={row.unitCode}
                className={refused.has(row.unitId) ? 'bg-destructive/5' : undefined}
              >
                <TableCell className="align-top font-medium">
                  <div>{row.unitCode}</div>
                  <div className="text-xs text-muted-foreground">{row.propertyName}</div>
                  {!row.leased ? (
                    <Badge variant="outline" className="mt-1">
                      No lease
                    </Badge>
                  ) : null}
                </TableCell>

                <TableCell className="text-right align-top tabular-nums text-muted-foreground">
                  {row.electricPrev}
                </TableCell>
                <TableCell className="align-top">
                  <Input
                    ref={(element) => {
                      inputs.current[rowIndex * 2] = element
                    }}
                    name={`electric-${row.unitId}`}
                    aria-label={`Electric reading for unit ${row.unitCode}`}
                    inputMode="decimal"
                    type="number"
                    step="0.01"
                    min="0"
                    value={entry.draft?.electric ?? ''}
                    onChange={(event) => update(row.unitId, { electric: event.target.value })}
                    onKeyDown={(event) => onKeyDown(event, rowIndex * 2)}
                    onFocus={(event) => event.target.select()}
                  />
                </TableCell>

                <TableCell className="text-right align-top tabular-nums text-muted-foreground">
                  {row.waterPrev}
                </TableCell>
                <TableCell className="align-top">
                  <Input
                    ref={(element) => {
                      inputs.current[rowIndex * 2 + 1] = element
                    }}
                    name={`water-${row.unitId}`}
                    aria-label={`Water reading for unit ${row.unitCode}`}
                    inputMode="decimal"
                    type="number"
                    step="0.01"
                    min="0"
                    value={entry.draft?.water ?? ''}
                    onChange={(event) => update(row.unitId, { water: event.target.value })}
                    onKeyDown={(event) => onKeyDown(event, rowIndex * 2 + 1)}
                    onFocus={(event) => event.target.select()}
                  />
                </TableCell>

                <TableCell className="align-top text-sm">
                  {entry.complete ? (
                    <div className="space-y-2">
                      <div className="tabular-nums text-muted-foreground">
                        {entry.electricUsed} kWh · {entry.waterUsed} gal
                      </div>

                      {flags.map((flag) => (
                        <Badge
                          key={flag}
                          variant={flag.endsWith('decreased') ? 'destructive' : 'warning'}
                        >
                          {FLAG_LABELS[flag]}
                        </Badge>
                      ))}

                      {needsConfirm ? (
                        <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-2">
                          <label className="flex items-start gap-2 text-xs">
                            <input
                              type="checkbox"
                              name={`confirm-${row.unitId}`}
                              aria-label={`Confirm the lower reading for unit ${row.unitCode}`}
                              checked={entry.draft?.confirmed ?? false}
                              onChange={(event) =>
                                update(row.unitId, { confirmed: event.target.checked })
                              }
                              className="mt-0.5"
                            />
                            <span>
                              The meter really does read lower — save it anyway. Nothing is billed
                              for a decrease.
                            </span>
                          </label>
                          <Input
                            name={`reason-${row.unitId}`}
                            aria-label={`Why unit ${row.unitCode} reads lower`}
                            placeholder="Why? e.g. meter replaced"
                            value={entry.draft?.reason ?? ''}
                            onChange={(event) => update(row.unitId, { reason: event.target.value })}
                            className="h-8 text-xs"
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <div className="flex items-center gap-3">
        <SaveButton count={readyCount} />
        <p className="text-sm text-muted-foreground">
          Press Enter to jump to the next box. Readings you have already entered can be typed over —
          the change is recorded.
        </p>
      </div>
    </form>
  )
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
