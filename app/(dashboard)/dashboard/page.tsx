import type { Metadata } from 'next'
import { requireOperator } from '@/lib/auth'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export const metadata: Metadata = { title: 'Dashboard' }

/**
 * The overview screen is built in Batch 2 (stream 2B) and answers three
 * questions: what came in and what is still owed, how full the buildings are,
 * and which leases are about to end.
 *
 * Until then this page proves the foundation works: you are signed in, you are
 * inside your own organization, and nobody else's is reachable from here.
 */
export default async function DashboardPage() {
  const identity = await requireOperator()

  return (
    <>
      <PageHeader
        title={`Welcome, ${identity.fullName ?? identity.email}`}
        description={`You are signed in to ${identity.orgName} as ${identity.role}.`}
      />

      <Alert>
        <AlertTitle>Foundation ready</AlertTitle>
        <AlertDescription>
          Accounts, organizations and the two-layer access rules are in place. The overview numbers
          — collected versus outstanding, occupancy, and expiring leases — arrive in Batch 2.
        </AlertDescription>
      </Alert>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { title: 'Collected this month', hint: 'Batch 2 · stream 2B' },
          { title: 'Still outstanding', hint: 'Batch 2 · stream 2B' },
          { title: 'Occupancy', hint: 'Batch 2 · stream 2B' },
        ].map((card) => (
          <Card key={card.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="tabular text-2xl font-semibold text-muted-foreground/50">—</p>
              <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}
