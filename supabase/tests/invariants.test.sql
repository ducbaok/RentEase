-- RentEase · Business invariants the database enforces on its own.
--
-- Everything here is a rule the brief says must never break — issuing twice
-- must not double-bill, two people cannot hold the same unit, a reminder job
-- that re-runs must not send twice — so each is tested against the DATABASE,
-- not against the code path that normally writes it. A test that went through
-- the application would only prove the application remembered the rule.

begin;
create extension if not exists pgtap;
select plan(24);

create or replace function public.attempt(p_sql text)
returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return sqlstate; end;
$$;

\set orgA      '''a0000000-0000-4000-8000-000000000001'''
\set leaseA    '''a0000000-0000-4000-8000-000000000040'''
\set unit101   '''a0000000-0000-4000-8000-000000000101'''
\set unit103   '''a0000000-0000-4000-8000-000000000103'''
\set propA     '''a0000000-0000-4000-8000-000000000100'''
\set tenantD   '''a0000000-0000-4000-8000-000000000030'''
\set invoiceD  '''a0000000-0000-4000-8000-000000000050'''
\set invoiceR  '''a0000000-0000-4000-8000-000000000051'''

-- ===========================================================================
-- AC4.1 — issuing twice must never create a second invoice
-- ===========================================================================
select is(
  public.attempt(format(
    'insert into public.invoices (org_id, lease_id, period, rent_cents, due_date) values (%L, %L, %L, 1000, %L)',
    :orgA, :leaseA, '2026-07', '2026-08-05')),
  '23505',
  'AC4.1: a second invoice for the same lease and period is refused by the database');

select is(
  public.attempt(format(
    'insert into public.invoices (org_id, lease_id, period, rent_cents, due_date) values (%L, %L, %L, 1000, %L)',
    :orgA, :leaseA, '2026-09', '2026-10-05')),
  'ok',
  'a different period for the same lease is fine');

-- ===========================================================================
-- AC2.1 — never two active leases on one unit
-- ===========================================================================
select is(
  public.attempt(format(
    'insert into public.leases (org_id, unit_id, tenant_id, start_date, end_date, rent_cents) values (%L, %L, %L, %L, %L, 100000)',
    :orgA, :unit101, :tenantD, '2026-06-01', '2026-11-30')),
  '23P01',
  'AC2.1: an overlapping active lease on the same unit is refused');

select is(
  public.attempt(format(
    'insert into public.leases (org_id, unit_id, tenant_id, start_date, end_date, rent_cents) values (%L, %L, %L, %L, %L, 100000)',
    :orgA, :unit101, :tenantD, '2027-01-01', '2027-12-31')),
  'ok',
  'a lease starting after the current one ends is fine');

-- An open-ended lease (unit 103, no end date) must still block a later one.
select is(
  public.attempt(format(
    'insert into public.leases (org_id, unit_id, tenant_id, start_date, rent_cents) values (%L, %L, %L, %L, 90000)',
    :orgA, :unit103, :tenantD, '2030-01-01')),
  '23P01',
  'an open-ended lease blocks every later lease on that unit');

-- ===========================================================================
-- AC3.3 / AC1.2 / AC6.2 — the remaining uniqueness guarantees
-- ===========================================================================
select is(
  public.attempt(format(
    'insert into public.meter_readings (org_id, unit_id, period, electric_curr, water_curr) values (%L, %L, %L, 9999, 9999)',
    :orgA, :unit101, '2026-07')),
  '23505',
  'AC3.3: a second reading for the same unit and period is refused');

select is(
  public.attempt(format(
    'insert into public.units (org_id, property_id, code) values (%L, %L, %L)', :orgA, :propA, '101')),
  '23505',
  'AC1.2: a duplicate unit code within one property is refused');

select is(
  public.attempt(format(
    'insert into public.units (org_id, property_id, code) values (%L, %L, %L)',
    'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000100', '101')),
  'ok',
  'the same unit code in a different property is fine');

select is(
  public.attempt(format(
    'insert into public.reminder_logs (org_id, invoice_id, kind) values (%L, %L, %L)',
    :orgA, :invoiceR, 'overdue_1')),
  'ok',
  'a reminder can be logged once');

select is(
  public.attempt(format(
    'insert into public.reminder_logs (org_id, invoice_id, kind) values (%L, %L, %L)',
    :orgA, :invoiceR, 'overdue_1')),
  '23505',
  'AC6.2: the same reminder cannot be logged twice — this is what makes a re-run silent');

-- ===========================================================================
-- Malformed input the domain and checks refuse
-- ===========================================================================
select is(
  public.attempt(format(
    'insert into public.invoices (org_id, lease_id, period, rent_cents, due_date) values (%L, %L, %L, 1000, %L)',
    :orgA, :leaseA, '2026-13', '2026-10-05')),
  '23514',
  'a malformed period is refused by the billing_period domain');

select is(
  public.attempt(format(
    'insert into public.leases (org_id, unit_id, tenant_id, start_date, rent_cents, billing_day) values (%L, %L, %L, %L, 1000, 31)',
    :orgA, :unit101, :tenantD, '2029-01-01')),
  '23514',
  'a billing day past the 28th is refused — every month must have that day');

select is(
  public.attempt(format(
    'insert into public.payments (org_id, invoice_id, amount_cents, method) values (%L, %L, -500, %L)',
    :orgA, :invoiceD, 'cash')),
  '23514',
  'a negative payment is refused — "how much came in" must stay unambiguous');

-- ===========================================================================
-- Derived money: totals and status are computed, never trusted from the caller
-- ===========================================================================
select lives_ok($$
  insert into public.invoices (id, org_id, lease_id, period, rent_cents, electric_cents,
                               water_cents, service_cents, other_cents, total_cents, due_date)
  values ('c0000000-0000-4000-8000-000000000001',
          'a0000000-0000-4000-8000-000000000001',
          'a0000000-0000-4000-8000-000000000040',
          '2026-10', 100000, 5000, 1000, 2500, 500, 1, '2026-11-05')
$$, 'an invoice can be inserted with a deliberately wrong total');

select is(
  (select total_cents from public.invoices where id = 'c0000000-0000-4000-8000-000000000001'),
  109000,
  'the wrong total is overwritten by the sum of the parts');

select is(
  (select status from public.invoices where id = 'c0000000-0000-4000-8000-000000000001'),
  'draft'::public.invoice_status,
  'an invoice with no issued_at is a draft regardless of what the caller asked for');

-- AC5.1 — payments drive the status
select lives_ok($$
  update public.invoices set issued_at = '2026-11-01 09:00+00'
  where id = 'c0000000-0000-4000-8000-000000000001'
$$, 'issuing the invoice is just setting issued_at');

select is(
  (select status from public.invoices where id = 'c0000000-0000-4000-8000-000000000001'),
  'sent'::public.invoice_status,
  'issued and unpaid, before the due date, is sent');

select lives_ok($$
  insert into public.payments (org_id, invoice_id, amount_cents, method)
  values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 9000, 'cash')
$$, 'a part payment can be recorded');

select is(
  (select paid_cents from public.invoices where id = 'c0000000-0000-4000-8000-000000000001'),
  9000,
  'paid_cents follows the payments without anyone updating it');

select is(
  (select status from public.invoices where id = 'c0000000-0000-4000-8000-000000000001'),
  'partial'::public.invoice_status,
  'AC5.1: part of the total makes the invoice partial');

select lives_ok($$
  insert into public.payments (org_id, invoice_id, amount_cents, method)
  values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 100000, 'bank_transfer')
$$, 'the rest can be paid later, in a second payment');

select is(
  (select status from public.invoices where id = 'c0000000-0000-4000-8000-000000000001'),
  'paid'::public.invoice_status,
  'AC5.1: payments reaching the total settle the invoice');

-- ===========================================================================
-- AC2.2 — occupancy follows the leases
-- ===========================================================================
select is(
  (select status from public.units where id = 'b0000000-0000-4000-8000-000000000102'),
  'vacant'::public.unit_status,
  'AC2.2: a unit with no lease is vacant');

select * from finish();
rollback;
