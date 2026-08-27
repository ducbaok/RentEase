import type { Metadata } from 'next'
import Link from 'next/link'
import { getIdentity, homePathFor } from '@/lib/auth'
import { redirect } from 'next/navigation'
import styles from './marketing.module.css'

export const metadata: Metadata = {
  title: 'RentEase — rent and utility billing that shows its work',
  description:
    'Rent, submetered utilities and repairs for landlords with 10–50 units. Every invoice shows the readings and rates it was calculated from, and your resident sees the same table you do.',
}

/**
 * The landing page.
 *
 * Anyone already signed in never sees it — they are sent to their own side of
 * the app, exactly as before. What a stranger sees is a worked invoice rather
 * than a list of features, because the arithmetic being visible IS the product.
 */
export default async function HomePage() {
  const identity = await getIdentity()
  if (identity.kind !== 'anonymous') redirect(homePathFor(identity))

  return (
    <>
      <header className={styles.masthead}>
        <div className={styles.wrap}>
          <p className={styles.wordmark}>
            RentEase<span>.</span>
          </p>
          <p className={styles.eyebrow}>Rent &amp; utility billing · 10–50 units</p>
        </div>
      </header>

      <main>
        <section className={`${styles.hero} ${styles.wrap}`}>
          <p className={styles.eyebrow}>For landlords who submeter</p>
          <h1>
            The bill explains <em>itself</em>.
          </h1>
          <p className={styles.lede}>
            Most billing software hands your resident a number. RentEase hands them the arithmetic
            that produced it — the same reading, the same rate, the same multiplication you did.
            Arguments about the water bill end at the invoice.
          </p>

          <div className={styles.actions}>
            <Link className={styles.btn} href="/sign-in">
              Open the demo
            </Link>
            <Link className={`${styles.btn} ${styles.btnGhost}`} href="/guide">
              Read the handbook
            </Link>
          </div>

          <div className={styles.demo}>
            <p className={styles.demoHead}>
              Look around first — no sign-up, nothing to install
            </p>
            <dl className={styles.demoCreds}>
              <div>
                <dt>Email</dt>
                <dd>demo-owner@example.com</dd>
              </div>
              <div>
                <dt>Password</dt>
                <dd>12345678@</dd>
              </div>
            </dl>
            <p className={styles.demoNote}>
              A furnished portfolio: three properties, real leases, a month of meter readings, and
              invoices in every state — paid, part paid, overdue. Change anything you like. It is
              rebuilt from scratch each night, and it is the only organisation this account can see.
            </p>
          </div>

          <div className={styles.billFrame}>
            <div className={styles.bill}>
              <div className={styles.billHead}>
                <strong>Court · Unit 101 — July 2026</strong>
                <span className={styles.eyebrow}>Issued 11 Aug · Due 25 Aug</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col">How it was worked out</th>
                    <th scope="col" className={styles.num}>
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Rent</td>
                    <td className={styles.work}>Monthly rent on the lease</td>
                    <td className={styles.num}>$1,200.00</td>
                  </tr>
                  <tr>
                    <td>
                      <span className={`${styles.swatch} ${styles.swatchE}`} />
                      Electricity
                    </td>
                    <td className={styles.work}>2,047 → 2,610 kWh · 563 × $0.1500</td>
                    <td className={styles.num}>$84.45</td>
                  </tr>
                  <tr>
                    <td>
                      <span className={`${styles.swatch} ${styles.swatchW}`} />
                      Water
                    </td>
                    <td className={styles.work}>18,340 → 20,190 gal · 1,850 × $0.0060</td>
                    <td className={styles.num}>$11.10</td>
                  </tr>
                  <tr>
                    <td>Service fee</td>
                    <td className={styles.work}>Flat monthly charge on the rate card</td>
                    <td className={styles.num}>$25.00</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total due</td>
                    <td className={`${styles.work} ${styles.due}`}>Unpaid · 2 days past due</td>
                    <td className={styles.num}>$1,320.55</td>
                  </tr>
                </tfoot>
              </table>
              <p className={styles.billNote}>
                Your resident opens this exact table in their own portal — not a summary of it. The
                rates are frozen onto the invoice the moment you issue, so changing your rate card
                next month never rewrites last month&apos;s arithmetic.
              </p>
            </div>
          </div>
        </section>

        <section id="month" className={styles.section}>
          <div className={styles.wrap}>
            <p className={styles.eyebrow}>The billing cycle</p>
            <h2>A month, from meter to money.</h2>
            <p className={styles.sectionLede}>
              Four moves. The first takes the longest and the last one you never do, because it
              happens while you sleep.
            </p>

            <ol className={styles.steps}>
              <li>
                <span className={styles.stepNum}>01</span>
                <div>
                  <h3>Read the meters</h3>
                  <p>
                    One sheet, one row per unit, last month&apos;s numbers already filled in. Type,
                    press Enter, and you&apos;re on the next unit — no mouse, no page loads. A
                    reading lower than last month stops and asks before it saves.
                  </p>
                </div>
              </li>
              <li>
                <span className={styles.stepNum}>02</span>
                <div>
                  <h3>Issue the invoices</h3>
                  <p>
                    One button — <code>Issue invoices for 2026-07</code> — bills every active lease
                    at once. Before it runs, it names the units with no reading and the units whose
                    usage looks wrong, so you decide with the exceptions in front of you.
                  </p>
                </div>
              </li>
              <li>
                <span className={styles.stepNum}>03</span>
                <div>
                  <h3>Record what comes in</h3>
                  <p>
                    Cash, transfer, part payments, several payments against one invoice. The status
                    follows the money on its own: paid, partly paid, or overdue.
                  </p>
                </div>
              </li>
              <li>
                <span className={styles.stepNum}>04</span>
                <div>
                  <h3>Let the reminders chase</h3>
                  <p>
                    Three days before the due date, then one day and seven days after. A paid
                    invoice is never chased — that&apos;s checked at the moment of sending, not when
                    the schedule was drawn up.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.wrap}>
            <p className={styles.eyebrow}>Guardrails</p>
            <h2>What it won&apos;t let you do.</h2>
            <p className={styles.sectionLede}>
              The mistakes that cost a landlord money are quiet ones. These are refused outright, in
              the database — not by a warning you can click past.
            </p>

            <dl className={styles.ledger}>
              <div className={styles.ledgerRow}>
                <dt>Double-bill a month</dt>
                <dd>
                  One invoice per lease per period, enforced as a constraint. Click issue twice,
                  refresh mid-run, let two people run it at once — you still get one invoice.
                </dd>
              </div>
              <div className={styles.ledgerRow}>
                <dt>Two live leases on one unit</dt>
                <dd>
                  Impossible to store, not merely hidden in the interface. Ending a lease returns
                  the unit to vacant; signing one marks it occupied. Occupancy is never something
                  you update by hand.
                </dd>
              </div>
              <div className={styles.ledgerRow}>
                <dt>Save a reading that went backwards</dt>
                <dd>
                  A number below last month&apos;s is usually a typo and occasionally a replaced
                  meter. Either way it stops and asks, and what you answer is recorded.
                </dd>
              </div>
              <div className={styles.ledgerRow}>
                <dt>Bill a wild reading without seeing it</dt>
                <dd>
                  Usage roughly three times that unit&apos;s own recent average is flagged before
                  you issue, not after the resident calls.
                </dd>
              </div>
              <div className={styles.ledgerRow}>
                <dt>Chase someone who already paid</dt>
                <dd>
                  Status is re-read at send time. Run the reminder job twice in one day and nobody
                  gets a second email — the log of what was sent is what makes the second run a
                  no-op.
                </dd>
              </div>
              <div className={styles.ledgerRow}>
                <dt>Quietly correct a bill</dt>
                <dd>
                  Corrections after issuing are allowed — you&apos;ll need them. Each one records
                  who, when, the old figure, the new one, and the reason you typed. Your resident
                  can read that history too.
                </dd>
              </div>
              <div className={styles.ledgerRow}>
                <dt>See another landlord&apos;s books</dt>
                <dd>
                  Every organisation&apos;s data is walled off in the database itself, and residents
                  can only reach rows tied to their own lease. Guess a URL for someone else&apos;s
                  invoice and there is nothing behind it.
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.wrap}>
            <p className={styles.eyebrow}>The resident&apos;s side</p>
            <h2>No app. No password. No phone calls about the bill.</h2>
            <p className={styles.sectionLede}>
              Your resident types their email, gets a sign-in link, and lands on their own bills.
              That&apos;s the whole onboarding, and it&apos;s the same on a five-year-old phone.
            </p>

            <div className={styles.split}>
              <div>
                <span className={styles.tag}>Bills</span>
                <h3>The month, and every month before it</h3>
                <p>
                  Current balance, full history, and the same line-by-line arithmetic you see —
                  including the meter readings their own charges were computed from.
                </p>
              </div>
              <div>
                <span className={styles.tag}>Repairs</span>
                <h3>Reported with photos, tracked to done</h3>
                <p>
                  They report the problem and attach pictures. You move it from reported to in
                  progress to done, and they&apos;re emailed at every step without you writing a
                  word.
                </p>
              </div>
              <div>
                <span className={styles.tag}>Reminders</span>
                <h3>Sent before it&apos;s awkward</h3>
                <p>
                  A nudge three days ahead of the due date does more for collection than three after
                  it. You don&apos;t schedule these; they go out on their own.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.wrap}>
            <p className={styles.eyebrow}>Honest scope</p>
            <h2>What RentEase does not do.</h2>
            <p className={styles.sectionLede}>
              Better to read it here than to find out in month two. These are deliberate omissions,
              not a roadmap.
            </p>
            <ul className={styles.scope}>
              <li>Take card or bank payments from residents</li>
              <li>Reconcile your bank statement</li>
              <li>Sign leases electronically</li>
              <li>Export to accounting or tax software</li>
              <li>Ship a native mobile app</li>
              <li>Check your rates against state submetering law</li>
            </ul>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.wrap}>
            <p className={styles.eyebrow}>Early access</p>
            <h2>Free while we&apos;re finding the rough edges.</h2>
            <p className={styles.sectionLede}>
              RentEase is live and running real portfolios. There&apos;s no charge and no card while
              it&apos;s in early access — when pricing arrives, you&apos;ll hear it from us before
              it applies to you.
            </p>
            <div className={styles.actions}>
              <Link className={styles.btn} href="/sign-up">
                Create an account
              </Link>
              <Link className={`${styles.btn} ${styles.btnGhost}`} href="/sign-in">
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.wrap}>
          <span>RentEase — rent, utilities and repairs for small portfolios</span>
          <Link href="/guide">Handbook</Link>
        </div>
      </footer>
    </>
  )
}
