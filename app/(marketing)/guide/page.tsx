import type { Metadata } from 'next'
import Link from 'next/link'
import styles from '../marketing.module.css'

export const metadata: Metadata = {
  title: 'Handbook',
  description:
    'How to run a month in RentEase — setting up, meter readings, issuing invoices, recording payments, corrections and repairs. Includes a section written for residents.',
}

/**
 * The handbook.
 *
 * Public on purpose: a landlord evaluating RentEase can read exactly what
 * operating it involves before signing up, and an existing one can send section
 * five straight to a resident without an account of their own.
 *
 * Anything clickable is printed with its real on-screen label. When a label
 * changes in the app it has to change here too — a handbook that names a button
 * nobody can find is worse than no handbook.
 */
export default function GuidePage() {
  return (
    <div className={styles.page}>
      <header className={styles.docMasthead}>
        <p className={styles.eyebrow}>
          <Link href="/">RentEase</Link>
        </p>
        <h1>Handbook</h1>
        <p className={styles.docIntro}>
          Everything you do in RentEase, in the order you&apos;ll do it. Anything you click is
          printed <span className={styles.ui}>like this</span>, exactly as it appears on screen. The
          last section is written for your residents — send it to them as it is.
        </p>
      </header>

      <div className={styles.shell}>
        <nav className={styles.toc} aria-label="Contents">
          <p className={styles.eyebrow}>Contents</p>
          <ol>
            <li>
              <a href="#setup">1 · Setting up</a>
            </li>
            <li>
              <a href="#month">2 · The monthly cycle</a>
            </li>
            <li>
              <a href="#fixing">3 · Fixing mistakes</a>
            </li>
            <li>
              <a href="#repairs">4 · Repairs</a>
            </li>
            <li>
              <a href="#residents">5 · For your residents</a>
            </li>
            <li>
              <a href="#map">6 · Where everything lives</a>
            </li>
          </ol>
          <span className={styles.tocWho}>
            Sections 1–4 and 6 are for landlords and managers. Section 5 is for residents.
          </span>
        </nav>

        <main className={styles.doc}>
          <section id="setup">
            <p className={styles.eyebrow}>Once, at the start</p>
            <h2>Setting up</h2>
            <p>
              Five things, in this order. Each one depends on the one before it, so skipping ahead
              leaves you unable to finish.
            </p>

            <ol className={styles.proc}>
              <li>
                <p>
                  <strong>Add a property.</strong>{' '}
                  <span className={styles.path}>
                    <b>Properties</b>
                  </span>{' '}
                  — the building or the address. One property holds many units.
                </p>
              </li>
              <li>
                <p>
                  <strong>Add its units.</strong>{' '}
                  <span className={styles.path}>
                    <b>Units</b>
                  </span>{' '}
                  — a code such as <span className={styles.ui}>101</span>, the floor area, and the
                  usual monthly rent.
                </p>
                <p>
                  Unit codes have to be unique inside a property. Two buildings can both have a 101;
                  one building cannot.
                </p>
              </li>
              <li>
                <p>
                  <strong>Add your residents.</strong>{' '}
                  <span className={styles.path}>
                    <b>Residents</b>
                  </span>{' '}
                  — name, and an email address.
                </p>
                <p>
                  The email is optional, so someone who never goes online can still be billed. But
                  without it they get no reminders and cannot open the portal, so fill it in
                  whenever you can.
                </p>
              </li>
              <li>
                <p>
                  <strong>Set your rates.</strong>{' '}
                  <span className={styles.path}>
                    <b>Rates</b>
                  </span>{' '}
                  — what you charge for electricity, water, and a flat monthly service fee.
                </p>
                <p>
                  Do this before you issue anything. With no rate card in force, invoices cannot be
                  created at all.
                </p>
              </li>
              <li>
                <p>
                  <strong>Start the leases.</strong>{' '}
                  <span className={styles.path}>
                    <b>Leases</b>
                  </span>
                  , or <span className={styles.ui}>Start a lease</span> from a resident&apos;s page
                  — unit, dates, rent, deposit, and the billing day.
                </p>
                <p>
                  An active lease is what makes a unit count as occupied and what invoices are
                  issued against. Nothing gets billed without one.
                </p>
              </li>
            </ol>

            <h3>The two fields people get wrong</h3>

            <div className={styles.tableFrame}>
              <table className={styles.fields}>
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">What it means</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span className={styles.ui}>Billing day</span>
                    </td>
                    <td className={styles.desc}>
                      The day of the month rent falls due — but in the month <em>after</em> the
                      period being billed. July&apos;s bill with a billing day of 25 falls due on 25
                      August, because July&apos;s meters cannot be read until July has ended. It
                      stops at 28 so the date exists in February too.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className={styles.ui}>Rates start on</span>
                    </td>
                    <td className={styles.desc}>
                      The date a rate card takes effect. Billing a month picks the newest card that
                      had already started by the last day of that month, which is what stops a rate
                      change today from rewriting last month&apos;s arithmetic.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className={styles.note}>
              <p>
                <strong>Raising your rates?</strong> Do not edit the old card — add a new one with a
                later <span className={styles.ui}>Rates start on</span>. Every invoice you already
                issued keeps the rates it was calculated with, and you keep a defensible record of
                what applied when.
              </p>
            </div>
          </section>

          <section id="month">
            <p className={styles.eyebrow}>Every month</p>
            <h2>The monthly cycle</h2>
            <p>Four steps. You do the first three; the fourth happens on its own.</p>

            <h3>1 · Read the meters</h3>
            <p>
              <span className={styles.path}>
                <b>Meter readings</b>
              </span>
              . Pick the month, and you get one row per unit with{' '}
              <span className={styles.ui}>Electric last</span> and{' '}
              <span className={styles.ui}>Water last</span> already filled in from the period
              before.
            </p>
            <p>
              Type into <span className={styles.ui}>Electric now</span>, press Enter, and you land
              on the next field. The whole sheet can be done from the keyboard without touching the
              mouse.
            </p>
            <div className={styles.note}>
              <p>
                <strong>If a number comes out lower than last month</strong>, RentEase stops and
                asks you to confirm. Usually it is a typo. Occasionally the meter really was
                replaced — say so, and the reason is kept with the reading.
              </p>
            </div>

            <h3>2 · Issue the invoices</h3>
            <p>
              <span className={styles.path}>
                <b>Invoices</b>
              </span>
              . Step to the month with the <span className={styles.ui}>←</span> and{' '}
              <span className={styles.ui}>→</span> arrows, then press{' '}
              <span className={styles.ui}>Issue invoices for 2026-07</span>.
            </p>
            <p>Before anything is created you are shown two warnings worth reading:</p>
            <ul className={styles.plain}>
              <li>
                <strong>Units with no reading</strong> — they will be billed rent and the service
                fee only. Sometimes that is correct.
              </li>
              <li>
                <strong>Units whose usage looks wrong</strong> — roughly three times that
                unit&apos;s own recent average. Check these before you bill, not after the phone
                rings.
              </li>
            </ul>
            <p>
              Pressing the button twice is safe. One invoice exists per lease per month, and a
              second attempt changes nothing.
            </p>

            <h3>3 · Record the money</h3>
            <p>
              Open an invoice and use <span className={styles.ui}>Record a payment</span>: the{' '}
              <span className={styles.ui}>Amount</span>, the date under{' '}
              <span className={styles.ui}>Received on</span>, how it arrived, and a note — a
              transfer reference, or who handed over the cash.
            </p>
            <p>
              You can record several payments against one invoice. The status keeps itself current:
            </p>
            <div className={styles.tableFrame}>
              <table className={styles.fields}>
                <thead>
                  <tr>
                    <th scope="col">Status</th>
                    <th scope="col">Means</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span className={styles.ui}>Sent</span>
                    </td>
                    <td className={styles.desc}>Issued, nothing paid yet, not yet due.</td>
                  </tr>
                  <tr>
                    <td>
                      <span className={styles.ui}>Partial</span>
                    </td>
                    <td className={styles.desc}>Part paid, still within the due date.</td>
                  </tr>
                  <tr>
                    <td>
                      <span className={styles.ui}>Overdue</span>
                    </td>
                    <td className={styles.desc}>
                      Past the due date and not paid in full — this outranks{' '}
                      <span className={styles.ui}>Partial</span>, so a late half-payment still shows
                      as overdue.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className={styles.ui}>Paid</span>
                    </td>
                    <td className={styles.desc}>Settled in full.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={styles.note}>
              <p>
                <strong>The due date itself is not late.</strong> Paying on the due date is paying
                on time. An invoice only turns overdue the day after.
              </p>
            </div>

            <h3>4 · Reminders send themselves</h3>
            <p>Every resident with an email on file is chased on a fixed schedule:</p>
            <ul className={styles.plain}>
              <li>
                <strong>Three days before</strong> the due date — the one that actually improves
                collection.
              </li>
              <li>
                <strong>One day after</strong>, and <strong>seven days after</strong>.
              </li>
            </ul>
            <p>
              A paid invoice is never chased, and nobody is emailed twice about the same thing.
              There is nothing to switch on and no schedule to maintain.
            </p>
          </section>

          <section id="fixing">
            <p className={styles.eyebrow}>When something is wrong</p>
            <h2>Fixing mistakes</h2>
            <p>
              Bills go out wrong sometimes. Nothing here is hidden from your resident, which is the
              point — a correction they can see is a correction they will accept.
            </p>

            <h3>Correcting an issued invoice</h3>
            <p>
              Open the invoice and find <span className={styles.ui}>Correct this invoice</span>. You
              can change the rent line, add a charge under{' '}
              <span className={styles.ui}>Other charges ($)</span> with a description in{' '}
              <span className={styles.ui}>What for</span>, and move the{' '}
              <span className={styles.ui}>Due date</span>.
            </p>
            <p>
              <span className={styles.ui}>Why (recorded in the history)</span> is required. What you
              type is kept permanently against the invoice, along with your name, the time, and the
              figures before and after.
            </p>
            <div className={styles.note}>
              <p>
                <strong>Electricity and water cannot be edited here on purpose.</strong> Those lines
                are arithmetic over the meter readings. If one is wrong, the reading is wrong — fix
                the reading, which keeps its own record of the change.
              </p>
            </div>

            <h3>Removing a payment</h3>
            <p>
              A payment entered twice, or against the wrong invoice, can be removed — you will be
              asked <span className={styles.ui}>Why this payment is being removed</span>. The
              invoice status recalculates immediately.
            </p>

            <h3>Seeing what changed</h3>
            <p>
              <span className={styles.ui}>Change history</span> on the invoices page lists every
              correction made in that month: who, when, and what moved. It is the first place to
              look when a figure is not what you remember.
            </p>
          </section>

          <section id="repairs">
            <p className={styles.eyebrow}>Between bills</p>
            <h2>Repairs</h2>
            <p>
              Your resident reports a problem from their portal and attaches photos. It appears
              under{' '}
              <span className={styles.path}>
                <b>Maintenance</b>
              </span>
              .
            </p>
            <p>
              A request moves in one direction — reported, then in progress, then done — using the
              one button on its page: <span className={styles.ui}>Mark as in progress</span>, then{' '}
              <span className={styles.ui}>Mark as done</span>. You cannot skip a step.
            </p>
            <p>
              Your resident is emailed each time you move it. You do not write those messages, and
              you do not have to remember to send them.
            </p>
          </section>

          <section id="residents">
            <p className={styles.eyebrow}>Section 5</p>
            <h2>For your residents</h2>
            <p>
              There is no invitation button in RentEase, and nothing to install. Your residents sign
              themselves in, as long as the email address on their record is the one they use.
            </p>
            <p>Send them the block below — by email, on a notice, however you normally reach them.</p>

            <div className={styles.handout}>
              <h4>Your bills, online</h4>
              <p>
                You can see your rent and utility bills — including the meter readings behind them —
                at <strong>renteasee.fit</strong>. There is no app to install and no password to
                remember.
              </p>
              <ol>
                <li>
                  Go to <strong>renteasee.fit/magic-link</strong>.
                </li>
                <li>Enter the email address your landlord has for you.</li>
                <li>
                  Press <strong>Email me a sign-in link</strong>, then open the email and click the
                  link.
                </li>
              </ol>
              <p>
                You will land on <strong>Bills</strong>: what you owe this month, every month before
                it, and each charge broken down — your previous and current meter readings, how much
                you used, and the rate applied.
              </p>
              <p>
                <strong>Repairs</strong> is where you report a problem. Describe it, add photos, and
                send. You will be emailed as it moves from reported, to in progress, to done.
              </p>
              <p>
                If the link does not arrive, check the spam folder first — then ask your landlord to
                confirm which email address is on your record. The link only works for the address
                they have.
              </p>
            </div>

            <div className={styles.note}>
              <p>
                <strong>If a resident cannot get in</strong>, it is almost always because the email
                on their record does not match the one they are typing. Open them under{' '}
                <span className={styles.path}>
                  <b>Residents</b>
                </span>{' '}
                and check.
              </p>
              <p>
                Their <span className={styles.ui}>Portal account</span> shows{' '}
                <span className={styles.ui}>Not invited yet</span> until the first time they sign in
                themselves. That is normal — there is nothing for you to send.
              </p>
            </div>
          </section>

          <section id="map">
            <p className={styles.eyebrow}>Reference</p>
            <h2>Where everything lives</h2>
            <p>The left-hand menu, top to bottom.</p>

            <div className={styles.tableFrame}>
              <table className={styles.fields}>
                <thead>
                  <tr>
                    <th scope="col">Menu</th>
                    <th scope="col">What you do there</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span className={styles.ui}>Dashboard</span>
                    </td>
                    <td className={styles.desc}>
                      Collected and outstanding this month, occupancy, leases ending soon, units in
                      arrears.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className={styles.ui}>Properties</span>
                    </td>
                    <td className={styles.desc}>Your buildings.</td>
                  </tr>
                  <tr>
                    <td>
                      <span className={styles.ui}>Units</span>
                    </td>
                    <td className={styles.desc}>
                      The units inside them, and whether each is occupied.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className={styles.ui}>Residents</span>
                    </td>
                    <td className={styles.desc}>
                      People, their contact details, and whether they have signed into the portal.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className={styles.ui}>Leases</span>
                    </td>
                    <td className={styles.desc}>
                      Who rents what, for how much, from when, due which day.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className={styles.ui}>Meter readings</span>
                    </td>
                    <td className={styles.desc}>The monthly reading sheet.</td>
                  </tr>
                  <tr>
                    <td>
                      <span className={styles.ui}>Invoices</span>
                    </td>
                    <td className={styles.desc}>
                      Issue a month, open a bill, correct one, read the change history.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className={styles.ui}>Payments</span>
                    </td>
                    <td className={styles.desc}>Everything received, newest first.</td>
                  </tr>
                  <tr>
                    <td>
                      <span className={styles.ui}>Rates</span>
                    </td>
                    <td className={styles.desc}>
                      Electricity, water and service fee, with the date each card starts.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className={styles.ui}>Maintenance</span>
                    </td>
                    <td className={styles.desc}>Repair requests from residents.</td>
                  </tr>
                  <tr>
                    <td>
                      <span className={styles.ui}>Plan &amp; billing</span>
                    </td>
                    <td className={styles.desc}>
                      Your own subscription. Owners only — managers do not see it.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3>Who can do what</h3>
            <div className={styles.tableFrame}>
              <table className={styles.fields}>
                <thead>
                  <tr>
                    <th scope="col">Role</th>
                    <th scope="col">Can</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <strong>Owner</strong>
                    </td>
                    <td className={styles.desc}>Everything, including the subscription.</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Manager</strong>
                    </td>
                    <td className={styles.desc}>
                      All day-to-day work — readings, invoices, payments, repairs. Not the
                      subscription.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Resident</strong>
                    </td>
                    <td className={styles.desc}>
                      Only their own bills and their own repair requests.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>

      <footer className={styles.footer}>
        <div className={styles.wrap}>
          <span>RentEase Handbook</span>
          <Link href="/">renteasee.fit</Link>
        </div>
      </footer>
    </div>
  )
}
