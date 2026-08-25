import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCents } from '@/lib/domain/money'
import { isMeteredLine, type Breakdown } from '@/lib/domain/breakdown'
import { formatRate, formatReading } from './format'

/**
 * AC4.3 — the invoice showing its working.
 *
 * "Not a bare number, but the working: electricity, 1,420 up to 2,047, that's
 * 627 kWh at $0.14 = $87.78." A metered line therefore prints both meter
 * numbers, the subtraction, the rate, and the product — so a resident can check
 * the bill against the meter on their wall without asking anyone.
 *
 * The numbers come from the invoice's own breakdown snapshot, never from the
 * current rate card: a price rise next month must not restate a bill already
 * paid.
 */
export function BreakdownTable({
  breakdown,
  totalCents,
}: {
  breakdown: Breakdown
  totalCents: number
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Charge</TableHead>
          <TableHead>How it was worked out</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {breakdown.map((line, index) => (
          <TableRow key={`${line.kind}-${index}`}>
            <TableCell className="font-medium">{line.label}</TableCell>
            <TableCell className="text-muted-foreground">
              {isMeteredLine(line) ? (
                <span>
                  {formatReading(line.prev)} → {formatReading(line.curr)} ={' '}
                  {formatReading(line.consumption)} {line.unit} × {formatRate(line.rate)}
                </span>
              ) : (
                <span>Flat charge</span>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCents(line.amount_cents)}
            </TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell className="font-semibold">Total</TableCell>
          <TableCell />
          <TableCell className="text-right font-semibold tabular-nums">
            {formatCents(totalCents)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}
