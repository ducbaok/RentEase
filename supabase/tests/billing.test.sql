-- RentEase · Stream 1B — the billing engine, tested where it is enforced.
--
-- Everything F3, F4 and F5 promise about DATA rather than about screens is
-- checked here, against the database itself: the arithmetic trigger, the status
-- rule, the uniqueness that makes issuing idempotent, the composite foreign
-- keys that stop one organization's money touching another's, and the
-- append-only audit trail.
--
-- Going through the application would only prove the application remembered.
--
-- Scaffolding rationale: supabase/tests/00_helpers.sql
-- Fixture: supabase/seed.sql

begin;
create extension if not exists pgtap;
select plan(40);

create table public.tres (k text primary key, v text);
grant all on public.tres to authenticated;

create or replace function public.attempt(p_sql text)
returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return sqlstate; end;
$$;

create or replace function public.attempt_rows(p_sql text)
returns text language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n::text;
exception when others then return 'ERR:' || sqlstate;
end;
$$;

\set orgA      '''a0000000-0000-4000-8000-000000000001'''
\set orgB      '''b0000000-0000-4000-8000-000000000001'''
\set alice     '''a0000000-0000-4000-8000-000000000010'''
\set mike      '''a0000000-0000-4000-8000-000000000011'''
\set bob       '''b0000000-0000-4000-8000-000000000010'''
\set dana      '''a0000000-0000-4000-8000-000000000020'''
\set leaseA    '''a0000000-0000-4000-8000-000000000040'''
\set leaseB    '''b0000000-0000-4000-8000-000000000040'''
\set unit101   '''a0000000-0000-4000-8000-000000000101'''
\set unitB1    '''b0000000-0000-4000-8000-000000000101'''
\set invDana   '''a0000000-0000-4000-8000-000000000050'''
\set invRay    '''a0000000-0000-4000-8000-000000000051'''
\set invNina   '''a0000000-0000-4000-8000-000000000052'''
\set invB      '''b0000000-0000-4000-8000-000000000050'''

-- ===========================================================================
-- AC5.1 — the status rule, including the ordering that the requirement is
-- explicit about: overdue outranks partial.
-- ===========================================================================
select is(
  (select status from public.invoices where id = :invRay),
  'overdue'::public.invoice_status,
  'AC5.1: half paid and past the due date is OVERDUE, not partial — they still owe');

select is(
  (select paid_cents from public.invoices where id = :invRay),
  50000,
  'and the money that did arrive is not lost — paid_cents still holds it');

select is(
  (select status from public.invoices where id = :invDana),
  'paid'::public.invoice_status,
  'settled in full is paid');

select is(
  (select status from public.invoices where id = :invNina),
  'overdue'::public.invoice_status,
  'nothing paid and past due is overdue');

-- The mirror of lib/domain/invoice-status.ts, checked directly against the
-- authoritative function. If these disagree, one of the two files was edited
-- alone — see the MIRROR WARNING in both.
select is(
  public.compute_invoice_status(null, 1000, 0, '2026-08-05'::date, '2026-08-01'::date),
  'draft'::public.invoice_status,
  'MIRROR: no issued_at is draft, whatever else is true');

select is(
  public.compute_invoice_status('2026-08-01'::timestamptz, 1000, 1000, '2026-07-01'::date, '2026-08-01'::date),
  'paid'::public.invoice_status,
  'MIRROR: paid in full is never chased, even long past due');

select is(
  public.compute_invoice_status('2026-08-01'::timestamptz, 1000, 400, '2026-08-05'::date, '2026-08-05'::date),
  'partial'::public.invoice_status,
  'MIRROR: on the due date itself, part paid is partial — due today is not late');

select is(
  public.compute_invoice_status('2026-08-01'::timestamptz, 1000, 400, '2026-08-05'::date, '2026-08-06'::date),
  'overdue'::public.invoice_status,
  'MIRROR: the day after the due date, part paid becomes overdue');

select is(
  public.compute_invoice_status('2026-08-01'::timestamptz, 1000, 0, '2026-08-05'::date, '2026-08-01'::date),
  'sent'::public.invoice_status,
  'MIRROR: issued, unpaid, not yet due is sent');

-- ===========================================================================
-- AC5.1 — several payments against one invoice, and taking one back.
-- ===========================================================================
select lives_ok($$
  insert into public.payments (org_id, invoice_id, amount_cents, method)
  values ('a0000000-0000-4000-8000-000000000001',
          'a0000000-0000-4000-8000-000000000051', 40000, 'cash')
$$, 'a second payment can be added to a part-paid invoice');

select is(
  (select paid_cents from public.invoices where id = :invRay),
  90000,
  'paid_cents is the sum of the payments, not a running total someone maintained');

select is(
  (select status from public.invoices where id = :invRay),
  'overdue'::public.invoice_status,
  'still short and still late, so still overdue');

-- Overpaying is allowed: a resident who rounds up must not hit a wall.
select lives_ok($$
  insert into public.payments (id, org_id, invoice_id, amount_cents, method)
  values ('c0000000-0000-4000-8000-000000000090',
          'a0000000-0000-4000-8000-000000000001',
          'a0000000-0000-4000-8000-000000000051', 50000, 'bank_transfer')
$$, 'an overpayment is accepted rather than argued with');

select is(
  (select status from public.invoices where id = :invRay),
  'paid'::public.invoice_status,
  'paying more than the total settles the invoice');

select is(
  (select paid_cents from public.invoices where id = :invRay),
  140000,
  'and the excess stays visible in paid_cents instead of being dropped');

select lives_ok($$
  delete from public.payments where id = 'c0000000-0000-4000-8000-000000000090'
$$, 'a payment entered in error can be removed');

select is(
  (select paid_cents from public.invoices where id = :invRay),
  90000,
  'removing it recomputes the balance from scratch — no ghost of the deleted amount');

select is(
  (select status from public.invoices where id = :invRay),
  'overdue'::public.invoice_status,
  'and the status falls back with it');

-- ===========================================================================
-- AC4.3 / money — the trigger owns the arithmetic
-- ===========================================================================
select is(
  (select total_cents from public.invoices where id = :invDana),
  131698,
  'the seeded invoice totals exactly what lib/domain/billing.ts computes for it');

select is(
  public.attempt(format(
    'insert into public.invoices (org_id, lease_id, period, rent_cents, electric_cents, due_date) values (%L, %L, %L, 1000, -5, %L)',
    :orgA, :leaseA, '2026-11', '2026-12-05')),
  '23514',
  'a negative line amount is refused — a charge cannot be worth less than nothing');

select is(
  public.attempt(format(
    'insert into public.payments (org_id, invoice_id, amount_cents, method) values (%L, %L, 0, %L)',
    :orgA, :invDana, 'cash')),
  '23514',
  'a zero payment is refused — nothing arrived, so nothing is recorded');

-- ===========================================================================
-- AC3.1 / AC3.3 — meter readings
-- ===========================================================================
-- Deliberately NOT constrained: meters roll over and get replaced. AC3.1 asks
-- for a confirmation, which lives in the application; the database's job is to
-- keep the fact rather than refuse it.
select is(
  public.attempt(format(
    'insert into public.meter_readings (org_id, unit_id, period, electric_prev, electric_curr, water_prev, water_curr, flags) values (%L, %L, %L, 5000, 12, 100, 120, %L)',
    :orgA, :unit101, '2026-09', '{electric_decreased}')),
  'ok',
  'AC3.1: a reading below last month is storable — with the fact recorded in flags');

select is(
  (select flags from public.meter_readings where unit_id = :unit101 and period = '2026-09'),
  array['electric_decreased'],
  'and the flag is what survives, so the pre-issue review can show it again');

select is(
  public.attempt(format(
    'update public.meter_readings set electric_curr = 5200, flags = %L where unit_id = %L and period = %L',
    '{}', :unit101, '2026-09')),
  'ok',
  'AC3.3: re-entering a period edits the one row rather than adding a second');

select is(
  public.attempt(format(
    'insert into public.meter_readings (org_id, unit_id, period, electric_curr, water_curr) values (%L, %L, %L, 1, 1)',
    :orgA, :unit101, '2026-09')),
  '23505',
  'AC3.3: and a second row for that unit and period is impossible');

-- ===========================================================================
-- Rate cards
-- ===========================================================================
select is(
  public.attempt(format(
    'insert into public.tariffs (org_id, electric_rate_per_kwh, water_rate_per_unit, effective_from) values (%L, 0.20, 0.02, %L)',
    :orgA, '2026-01-01')),
  '23505',
  'two rate cards cannot start on the same day — which one would price the month?');

select is(
  public.attempt(format(
    'insert into public.tariffs (org_id, electric_rate_per_kwh, water_rate_per_unit, effective_from) values (%L, -0.20, 0.02, %L)',
    :orgA, '2027-01-01')),
  '23514',
  'a negative rate is refused');

select lives_ok($$
  insert into public.tariffs (org_id, electric_rate_per_kwh, water_rate_per_unit, service_fee_cents, effective_from)
  values ('a0000000-0000-4000-8000-000000000001', 0.1425, 0.0125, 2500, '2026-09-15')
$$, 'a real four-decimal utility rate can be stored');

select is(
  (select electric_rate_per_kwh from public.tariffs
   where org_id = :orgA and effective_from = '2026-09-15'),
  0.1425::numeric(12,4),
  'and it comes back with all four decimals intact, not rounded to cents');

-- ===========================================================================
-- Composite foreign keys — the layer underneath RLS.
-- Even with correct-looking ids, one organization's billing cannot be stitched
-- onto another's.
-- ===========================================================================
select is(
  public.attempt(format(
    'insert into public.invoices (org_id, lease_id, period, rent_cents, due_date) values (%L, %L, %L, 1000, %L)',
    :orgA, :leaseB, '2026-11', '2026-12-05')),
  '23503',
  'an invoice of org A cannot hang off a lease of org B');

select is(
  public.attempt(format(
    'insert into public.payments (org_id, invoice_id, amount_cents, method) values (%L, %L, 100, %L)',
    :orgA, :invB, 'cash')),
  '23503',
  'a payment of org A cannot be applied to an invoice of org B');

select is(
  public.attempt(format(
    'insert into public.meter_readings (org_id, unit_id, period, electric_curr, water_curr) values (%L, %L, %L, 10, 10)',
    :orgA, :unitB1, '2026-11')),
  '23503',
  'a reading of org A cannot be taken for a unit of org B');

-- ===========================================================================
-- AC5.2 — the audit trail is append-only, and honest about who wrote it.
-- ===========================================================================
reset role;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000011","role":"authenticated"}';
set local role authenticated;

insert into public.tres values
  ('mike_writes_audit', public.attempt(format(
     'insert into public.audit_logs (id, org_id, actor_id, entity, entity_id, action, reason) values (%L, %L, %L, %L, %L, %L, %L)',
     'c0000000-0000-4000-8000-000000000091', :orgA, :mike, 'invoice', :invDana, 'update', 'agreed reduction'))),
  -- Filing an entry under somebody else's name fails the WITH CHECK.
  ('mike_forges_actor', public.attempt(format(
     'insert into public.audit_logs (org_id, actor_id, entity, entity_id, action) values (%L, %L, %L, %L, %L)',
     :orgA, :alice, 'invoice', :invDana, 'update'))),
  ('mike_audits_other_org', public.attempt(format(
     'insert into public.audit_logs (org_id, actor_id, entity, entity_id, action) values (%L, %L, %L, %L, %L)',
     :orgB, :mike, 'invoice', :invB, 'update'))),
  -- No UPDATE or DELETE policy exists, and no grant either: history cannot be
  -- rewritten from the API by anyone, including the owner.
  ('mike_edits_audit', public.attempt(format(
     'update public.audit_logs set reason = %L where id = %L', 'never happened', 'c0000000-0000-4000-8000-000000000091'))),
  ('mike_deletes_audit', public.attempt(format(
     'delete from public.audit_logs where id = %L', 'c0000000-0000-4000-8000-000000000091'))),
  -- The daily job's function is service_role only; a manager cannot run it to
  -- move invoices between states by hand.
  ('mike_refreshes_overdue', public.attempt('select public.refresh_overdue_invoices()')),
  -- A manager does the operations work, so recording money must work.
  ('mike_records_payment', public.attempt(format(
     'insert into public.payments (org_id, invoice_id, amount_cents, method) values (%L, %L, 100, %L)',
     :orgA, :invNina, 'cash')));

-- A separate statement on purpose: every expression inside one INSERT sees the
-- snapshot taken when that statement began, so a count written alongside the
-- writes above would report the world as it was before them.
insert into public.tres values
  ('mike_reads_own_audit', (select count(*) from public.audit_logs where org_id = :orgA)::text);

reset role;

select is((select v from public.tres where k = 'mike_writes_audit'), 'ok',
  'AC5.2: an operator can file an audit entry for their own organization');

select is((select v from public.tres where k = 'mike_forges_actor'), '42501',
  'but not under another person''s name — actor_id must be the caller');

select is((select v from public.tres where k = 'mike_audits_other_org'), '42501',
  'and not into another organization''s history');

select is((select v from public.tres where k = 'mike_edits_audit'), '42501',
  'AC5.2: an audit entry cannot be edited — there is no UPDATE grant or policy');

select is((select v from public.tres where k = 'mike_deletes_audit'), '42501',
  'and it cannot be deleted either, so the record of a correction outlives the correction');

select is((select v from public.tres where k = 'mike_refreshes_overdue'), '42501',
  'refresh_overdue_invoices belongs to the cron job alone');

select is((select v from public.tres where k = 'mike_records_payment'), 'ok',
  'a manager can record money received — that is the job');

select isnt((select v from public.tres where k = 'mike_reads_own_audit'), '0',
  'and can read the history of their own organization');

select * from finish();
rollback;
