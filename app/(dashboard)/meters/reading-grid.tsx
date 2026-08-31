'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Camera } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
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
import type { MeterReadingSuggestion } from '@/lib/ai/schemas'
import { cn } from '@/lib/utils'
import {
  readMeterPhotoAction,
  saveReadingsAction,
  type MeterFormState,
  type MeterPhotoState,
} from './actions'
import { prepareMeterPhoto } from './photo-file'

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

/**
 * The photo one row is currently showing. Deliberately NOT part of Draft: a
 * Draft is what gets submitted, and a photo never is. It is shown, it is looked
 * at, and it is thrown away when the row is saved.
 */
interface Photo {
  /** An object URL. Every one of these has to be handed back — see release(). */
  url: string
  status: 'reading' | 'read' | 'none'
  /** One quiet line under the thumbnail: what came back, or why nothing did. */
  note?: string
  /**
   * The save result that was on screen when this photo was chosen.
   *
   * It is what makes "show it until the row is saved" a question that can be
   * answered while rendering, instead of a copy of the truth that some effect
   * has to keep up to date. A photo is finished when a save result arrives that
   * is not this one and that reports its row stored — and a photo taken AFTER
   * that save is not finished, because it was taken under the newer result.
   */
  takenAfter: MeterFormState
}

/**
 * Whether a photo has outlived its number: the row it belongs to has been
 * saved, so there is nothing left to check it against (AC9.2).
 *
 * A row the server refused is not settled. Those are the rows somebody is about
 * to look at again, and taking the picture away is the one moment it was for.
 */
function isSettled(state: MeterFormState, photo: Photo, unitId: string): boolean {
  if (photo.takenAfter === state) return false
  if (!state.message && !state.needsConfirmation) return false
  return !(state.needsConfirmation ?? []).includes(unitId)
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
 *
 * A photo (F9) is a third way of putting a number in a box, and it is only
 * that. It goes through update() — the same function the keyboard goes through
 * — and stops there. So there is no second write path to review: the form still
 * submits through saveReadingsAction, still meets detectFlags() and
 * requiresConfirmation(), still lands in the audit trail (AC9.6). The person
 * who presses Save is still the person who decided the number, which is the
 * whole point, because a wrong reading and a right one look identical once they
 * are in the box.
 *
 * That is also why the photograph stays on screen next to the number until the
 * row is saved (AC9.2). Confirming a figure you cannot see the source of is not
 * confirming anything, it is pressing a button.
 */
export function ReadingGrid({
  period,
  rows,
  photoReading = false,
}: {
  period: string
  rows: ReadingGridRow[]
  /** Whether this deployment has a provider that can read a photo at all. */
  photoReading?: boolean
}) {
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

  /*
   * Photos are mirrored into a ref because every object URL has to be handed
   * back exactly once, and the code that revokes one runs in an async callback
   * or a cleanup where the rendered `photos` may already be a render behind.
   * The ref is written first and is the copy those places read.
   */
  const [photos, setPhotos] = useState<Record<string, Photo>>({})
  const photosRef = useRef<Record<string, Photo>>({})

  function writePhotos(next: Record<string, Photo>) {
    photosRef.current = next
    setPhotos(next)
  }

  function release(unitId: string) {
    const existing = photosRef.current[unitId]
    if (existing) URL.revokeObjectURL(existing.url)
  }

  /*
   * Which photo each row is waiting on. A landlord who photographs the wrong
   * meter and immediately photographs the right one must not end up with the
   * first answer beside the second picture — that is precisely the pairing
   * AC9.2 exists to guarantee, so a late reply for a replaced photo is dropped.
   */
  const attempts = useRef<Record<string, number>>({})

  async function readPhoto(unitId: string, chosen: File) {
    const attempt = (attempts.current[unitId] ?? 0) + 1
    attempts.current[unitId] = attempt

    release(unitId)
    const taken: Photo = { url: URL.createObjectURL(chosen), status: 'reading', takenAfter: state }
    writePhotos({ ...photosRef.current, [unitId]: taken })

    const result = await askForReading(chosen)
    if (attempts.current[unitId] !== attempt) return

    const shown = photosRef.current[unitId]
    if (!shown) return

    if (!result.suggestion) {
      writePhotos({
        ...photosRef.current,
        [unitId]: { ...shown, status: 'none', note: result.unavailable ?? NO_ANSWER },
      })
      return
    }

    /*
     * The only line in this feature that puts a number anywhere. It is a patch
     * to the same drafts the keyboard writes, it only ever touches `curr`, and
     * a dial that came back null is simply left out — an empty box is the right
     * answer when nothing was legible (AC9.3), and it must not wipe a number
     * the operator had already typed either.
     *
     * `prev` is not here and cannot be: it is last period's closing reading,
     * the server re-derives it, and a photo of this month's dial says nothing
     * about last month's.
     */
    const patch: Partial<Draft> = {}
    if (result.suggestion.electric !== null) patch.electric = String(result.suggestion.electric)
    if (result.suggestion.water !== null) patch.water = String(result.suggestion.water)
    if (patch.electric !== undefined || patch.water !== undefined) update(unitId, patch)

    writePhotos({
      ...photosRef.current,
      [unitId]: { ...shown, status: 'read', note: noteFor(result.suggestion) },
    })
  }

  /** The photo a row is still showing, if it has one that is not finished. */
  function photoFor(unitId: string): Photo | undefined {
    const photo = photos[unitId]
    return photo && !isSettled(state, photo, unitId) ? photo : undefined
  }

  /*
   * Hands back the photos of rows that have just been stored. Which rows those
   * are was decided while rendering, by isSettled(); this only tells the
   * browser it can drop the bytes, which is the sort of external bookkeeping an
   * effect is actually for. It changes no React state, so no render follows it.
   */
  useEffect(() => {
    for (const [unitId, photo] of Object.entries(photosRef.current)) {
      if (isSettled(state, photo, unitId)) URL.revokeObjectURL(photo.url)
    }
  }, [state])

  /* Navigating away mid-round must not leak the photos taken so far. */
  useEffect(
    () => () => {
      for (const photo of Object.values(photosRef.current)) URL.revokeObjectURL(photo.url)
    },
    [],
  )

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

                  {photoReading ? (
                    <MeterPhoto
                      unitCode={row.unitCode}
                      photo={photoFor(row.unitId)}
                      onChoose={(file) => void readPhoto(row.unitId, file)}
                    />
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
          {photoReading
            ? ' A photo only fills the boxes in; nothing is saved until you press Save.'
            : ''}
        </p>
      </div>
    </form>
  )
}

/**
 * The camera for one row, and the picture it took.
 *
 * `capture="environment"` is the difference between a feature somebody uses on
 * the landing and one they use at a desk afterwards: on a phone it opens the
 * rear camera directly instead of a file browser. On a laptop the attribute is
 * ignored and this is an ordinary file picker, which is what the end-to-end
 * suite drives.
 *
 * It is a label around a hidden input rather than a button that clicks one,
 * because the label IS the button as far as the browser and a screen reader are
 * concerned, and the input keeps a real accessible name.
 */
function MeterPhoto({
  unitCode,
  photo,
  onChoose,
}: {
  unitCode: string
  photo: Photo | undefined
  onChoose: (file: File) => void
}) {
  const busy = photo?.status === 'reading'

  return (
    <div className="mt-2 space-y-1 font-normal">
      <label
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'cursor-pointer',
          busy && 'pointer-events-none opacity-50',
        )}
      >
        <Camera aria-hidden="true" />
        {busy ? 'Reading…' : photo ? 'New photo' : 'Photo'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-label={`Photo of the meters for unit ${unitCode}`}
          disabled={busy}
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            // Cleared so that choosing the SAME file again still fires a
            // change event — a blurry first shot gets retaken, not renamed.
            // (What keeps the photo out of the submitted form is the missing
            // `name`: a file input without one is not part of the form data,
            // and this photo must never travel with the readings.)
            event.target.value = ''
            if (chosen) onChoose(chosen)
          }}
        />
      </label>

      {photo ? (
        <>
          {/*
           * A plain img, not next/image: that component optimises files a
           * server can fetch and cache, and this is a blob: URL for bytes that
           * live in this tab for the next minute. There is nothing to optimise
           * and no address anything else could resolve.
           */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.url}
            alt={`The meter photo just taken for unit ${unitCode}`}
            className="block size-20 rounded border border-border object-cover"
          />
          {photo.note ? (
            <p className="max-w-40 text-xs leading-snug text-muted-foreground">{photo.note}</p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/** Said when the action came back with neither a suggestion nor a reason. */
const NO_ANSWER = 'No reading came back for this photo. Type the numbers in as usual.'

/**
 * Asks for a reading and cannot throw.
 *
 * readMeterPhotoAction answers every failure it knows about with a sentence, so
 * this catch is for the ones it never sees: the network between here and there,
 * and a body Next rejects before the action is entered. The screen must survive
 * all of them unchanged — the keyboard is still the normal way to do this
 * (AC9.4, AC9.5).
 */
async function askForReading(chosen: File): Promise<MeterPhotoState> {
  try {
    const data = new FormData()
    data.set('photo', await prepareMeterPhoto(chosen))
    return await readMeterPhotoAction({}, data)
  } catch {
    return { unavailable: 'Could not send this photo. Type the numbers in as usual.' }
  }
}

/**
 * What to say under a photo that WAS read.
 *
 * Every version of this line ends by asking the person to check the number
 * against the picture, including the confident one. The model's confidence is
 * its own opinion of its own work; the resident's bill depends on somebody
 * else's.
 */
function noteFor(suggestion: MeterReadingSuggestion): string {
  if (suggestion.electric === null && suggestion.water === null) {
    return 'Neither dial could be read here. Type the numbers in.'
  }

  const missing = suggestion.electric === null ? 'electricity' : suggestion.water === null ? 'water' : null
  if (missing) {
    return `The ${missing} dial could not be read — type that one in. Check the other against the photo.`
  }

  return suggestion.confidence === 'low'
    ? 'Read, but not clearly. Check both against the photo before saving.'
    : 'Check both against the photo before saving.'
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
