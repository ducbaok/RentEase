import type { Metadata } from 'next'
import { Building2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
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
import { listAccounts, summarise } from '@/lib/data/super'
import { SubscriptionBadge } from '../_components/subscription-badge'
import { formatDay, relativeDays } from '../_components/format'

export const metadata: Metadata = { title: 'Organizations' }

/**
 * Every account on RentEase, with the state of its subscription.
 *
 * This is the whole back office. It shows what the two super policies grant —
 * the organization row and the subscription row — and nothing from inside an
 * account: no units, no invoices, no residents. Those are not omitted for
 * tidiness, they are unreachable (see lib/data/super.ts), which is what makes
 * "the developer can see who the customers are, not what they are billing"
 * true at the database rather than only on this page.
 *
 * listAccounts() re-checks the super identity itself. The layout already did,
 * but the layout only decides what renders — a guard that lives with the query
 * is the one that cannot be bypassed by reaching the query another way.
 */
export default async function AdminHomePage() {
  const accounts = await listAccounts()
  const totals = summarise(accounts)

  return (
    <>
      <PageHeader
        title="Organizations"
        description={
          totals.accounts === 1 ? '1 account on RentEase.' : `${totals.accounts} accounts on RentEase.`
        }
        actions={
          totals.byStatus.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {totals.byStatus.map(({ status, count }) => (
                <span key={status} className="flex items-center gap-1.5 text-sm">
                  <SubscriptionBadge status={status} />
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </span>
              ))}
              {totals.withoutSubscription > 0 ? (
                <span className="flex items-center gap-1.5 text-sm">
                  <Badge variant="destructive">No subscription</Badge>
                  <span className="tabular-nums text-muted-foreground">
                    {totals.withoutSubscription}
                  </span>
                </span>
              ) : null}
            </div>
          ) : null
        }
      />

      <Card>
        <CardContent className="pt-6">
          {accounts.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No organizations yet"
              description="Accounts appear here as soon as somebody signs up and names their business."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Signed up</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Renews / ends</TableHead>
                  <TableHead>Stripe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody data-testid="admin-org-list">
                {accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">
                      {account.name}
                      <div className="font-mono text-xs text-muted-foreground">{account.id}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDay(account.createdAt)}
                    </TableCell>
                    <TableCell className="capitalize">
                      {account.subscription?.plan ?? account.plan}
                      {account.subscription && account.subscription.plan !== account.plan ? (
                        <div className="text-xs text-warning-foreground">
                          org says {account.plan}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {account.subscription ? (
                        <SubscriptionBadge status={account.subscription.status} />
                      ) : (
                        <Badge variant="destructive">No subscription row</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {account.subscription?.periodEnd ? (
                        <>
                          {formatDay(account.subscription.periodEnd)}
                          <div className="text-xs text-muted-foreground">
                            {relativeDays(account.subscription.periodEnd)}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {account.subscription?.linkedToStripe ? (
                        <Badge variant="outline">Linked</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">Not linked</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Membership of this back office is granted by direct SQL only — there is no INSERT policy on{' '}
        <code className="font-mono">super_admins</code>, so no account can promote itself here.
      </p>
    </>
  )
}
