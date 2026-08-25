-- RentEase · Stream 1A — the asset tree and the lease lifecycle, proved at the database.
--
-- F1 (properties and units) and F2 (leases) both hang their guarantees on the
-- database rather than on a screen, so this is where they are checked:
--
--   AC1.1  occupancy follows the unit rows, so it moves the moment a lease does
--   AC1.2  a unit code is unique inside its property
--   AC2.1  two active leases never overlap on one unit — EXCLUDE, not UI
--   AC2.2  a lease is what makes a unit occupied, and ending one frees it
--
-- Everything below runs as the superuser: the subject is the CONSTRAINTS, not
-- who may see what. Row visibility between organizations is proved separately
-- in rls_org_isolation.test.sql.
--
-- Dates are written relative to current_date so the file does not rot, and so
-- a test cannot pass tomorrow for a different reason than it passed today.
-- Scaffolding rationale: supabase/tests/00_helpers.sql

begin;
create extension if not exists pgtap;
select plan(25);

create or replace function public.attempt(p_sql text)
returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return sqlstate; end;
$$;

-- Fixture ids from supabase/seed.sql
\set orgA       '''a0000000-0000-4000-8000-000000000001'''
\set orgB       '''b0000000-0000-4000-8000-000000000001'''
\set propA      '''a0000000-0000-4000-8000-000000000100'''
\set propB      '''b0000000-0000-4000-8000-000000000100'''
\set unitA1     '''b0000000-0000-4000-8000-000000000101'''
\set unitA2     '''b0000000-0000-4000-8000-000000000102'''
\set tenantSam  '''b0000000-0000-4000-8000-000000000030'''
\set tenantDana '''a0000000-0000-4000-8000-000000000030'''

-- Ids created here, in a range no seed row uses.
\set leaseNow   '''c0000000-0000-4000-8000-000000000201'''
\set leaseAgain '''c0000000-0000-4000-8000-000000000202'''
\set unitT1     '''c0000000-0000-4000-8000-000000000301'''
\set unitT2     '''c0000000-0000-4000-8000-000000000302'''

-- ===========================================================================
-- AC2.2 — occupancy is a consequence of the lease, never a flag someone sets
-- ===========================================================================
select is(
  (select status from public.units where id = :unitA2),
  'vacant'::public.unit_status,
  'a unit with no lease on it is vacant');

select lives_ok(format($$
  insert into public.leases (id, org_id, unit_id, tenant_id, start_date, end_date, rent_cents, billing_day)
  values (%L, %L, %L, %L, current_date - 10, null, 135000, 5)
$$, :leaseNow, :orgB, :unitA2, :tenantSam),
  'a lease can be opened on a free unit');

select is(
  (select status from public.units where id = :unitA2),
  'occupied'::public.unit_status,
  'AC2.2: an active lease covering today turns the unit occupied, with nobody setting the column');

-- AC1.1 — the occupancy rate is derived, so it has already moved.
--
-- Counted over the two SEEDED units by id rather than over the whole
-- organization: the local database is shared between worktrees, and a count
-- that another stream's fixtures can move is a test that fails for reasons
-- that have nothing to do with what it claims to check.
select is(
  (select count(*) from public.units where id in (:unitA1, :unitA2) and status = 'occupied'),
  2::bigint,
  'AC1.1: the occupied count rises the instant the lease exists');

select lives_ok(format($$
  update public.leases set status = 'ended', end_date = current_date where id = %L
$$, :leaseNow),
  'a lease can be ended');

select is(
  (select status from public.units where id = :unitA2),
  'vacant'::public.unit_status,
  'AC2.2: ending the lease sends the unit back to vacant');

select is(
  (select count(*) from public.units where id in (:unitA1, :unitA2) and status = 'occupied'),
  1::bigint,
  'AC1.1: the occupied count falls again — nothing caches it');

-- ===========================================================================
-- AC2.1 — the EXCLUDE constraint, and exactly what it does and does not block
-- ===========================================================================

-- An ENDED lease must not keep blocking the unit, or a unit could never be
-- re-let to a new resident for the same dates.
select is(
  public.attempt(format($$
    insert into public.leases (id, org_id, unit_id, tenant_id, start_date, end_date, rent_cents, billing_day)
    values (%L, %L, %L, %L, current_date - 5, null, 135000, 5)
  $$, :leaseAgain, :orgB, :unitA2, :tenantSam)),
  'ok',
  'an ended lease stops blocking the unit — the constraint only covers active ones');

select is(
  (select status from public.units where id = :unitA2),
  'occupied'::public.unit_status,
  'the replacement lease occupies the unit again');

select lives_ok(format('delete from public.leases where id = %L', :leaseAgain),
  'a lease can be deleted outright');

select is(
  (select status from public.units where id = :unitA2),
  'vacant'::public.unit_status,
  'AC2.2: the unit follows a DELETE too, not just an update');

-- A fresh unit, so the overlap cases below start from a known-empty history.
select is(
  public.attempt(format($$
    insert into public.units (id, org_id, property_id, code, base_rent_cents)
    values (%L, %L, %L, 'T1', 100000)
  $$, :unitT1, :orgB, :propB)),
  'ok',
  'a unit can be added to a property');

select is(
  (select status from public.units where id = :unitT1),
  'vacant'::public.unit_status,
  'a brand new unit is vacant');

select is(
  public.attempt(format($$
    insert into public.leases (org_id, unit_id, tenant_id, start_date, end_date, rent_cents, billing_day)
    values (%L, %L, %L, current_date + 30, current_date + 395, 100000, 1)
  $$, :orgB, :unitT1, :tenantSam)),
  'ok',
  'a lease can be signed ahead of time');

-- This is the case the application must not get wrong: 'active' is not the
-- same as 'occupied'. The trigger checks start_date <= current_date, and so
-- does occupiesOn() in lib/domain/leases.ts.
select is(
  (select status from public.units where id = :unitT1),
  'vacant'::public.unit_status,
  'a lease that has not started yet leaves the unit vacant');

select is(
  public.attempt(format($$
    insert into public.leases (org_id, unit_id, tenant_id, start_date, end_date, rent_cents, billing_day)
    values (%L, %L, %L, current_date + 60, current_date + 200, 100000, 1)
  $$, :orgB, :unitT1, :tenantSam)),
  '23P01',
  'AC2.1: a second active lease overlapping the first is refused by the database');

-- Both ends are inclusive: daterange(start, end, '[]'). Two residents cannot
-- both hold the keys on the last day.
select is(
  public.attempt(format($$
    insert into public.leases (org_id, unit_id, tenant_id, start_date, end_date, rent_cents, billing_day)
    values (%L, %L, %L, current_date + 395, current_date + 500, 100000, 1)
  $$, :orgB, :unitT1, :tenantSam)),
  '23P01',
  'AC2.1: a lease starting on the day the last one ends still overlaps');

select is(
  public.attempt(format($$
    insert into public.leases (org_id, unit_id, tenant_id, start_date, end_date, rent_cents, billing_day)
    values (%L, %L, %L, current_date + 396, current_date + 500, 100000, 1)
  $$, :orgB, :unitT1, :tenantSam)),
  'ok',
  'a lease starting the day after the last one ends is fine');

-- ===========================================================================
-- AC1.2 — unit codes are unique per property, not per organization
-- ===========================================================================
select is(
  public.attempt(format($$
    insert into public.units (org_id, property_id, code, base_rent_cents)
    values (%L, %L, 'T1', 90000)
  $$, :orgB, :propB)),
  '23505',
  'AC1.2: the same unit code twice in one property is refused');

select is(
  public.attempt(format($$
    insert into public.units (org_id, property_id, code, base_rent_cents)
    values (%L, %L, 'T1', 90000)
  $$, :orgA, :propA)),
  'ok',
  'AC1.2: the same code in a different building is a different unit');

-- ===========================================================================
-- Composite foreign keys — a lease cannot be stitched across organizations
-- even when the caller supplies a matching-looking id
-- ===========================================================================
select is(
  public.attempt(format($$
    insert into public.units (id, org_id, property_id, code, base_rent_cents)
    values (%L, %L, %L, 'T2', 100000)
  $$, :unitT2, :orgB, :propB)),
  'ok',
  'a second free unit for the cross-organization checks');

select is(
  public.attempt(format($$
    insert into public.leases (org_id, unit_id, tenant_id, start_date, rent_cents, billing_day)
    values (%L, %L, %L, current_date, 100000, 1)
  $$, :orgA, :unitT2, :tenantDana)),
  '23503',
  'a lease claiming one organization cannot point at another organization''s unit');

select is(
  public.attempt(format($$
    insert into public.leases (org_id, unit_id, tenant_id, start_date, rent_cents, billing_day)
    values (%L, %L, %L, current_date, 100000, 1)
  $$, :orgB, :unitT2, :tenantDana)),
  '23503',
  'a lease cannot name a resident who belongs to another organization');

-- ===========================================================================
-- Term and billing-day checks — the rules lib/domain/leases.ts mirrors
-- ===========================================================================
select is(
  public.attempt(format($$
    insert into public.leases (org_id, unit_id, tenant_id, start_date, end_date, rent_cents, billing_day)
    values (%L, %L, %L, current_date, current_date - 1, 100000, 1)
  $$, :orgB, :unitT2, :tenantSam)),
  '23514',
  'a lease cannot end before it starts');

select is(
  public.attempt(format($$
    insert into public.leases (org_id, unit_id, tenant_id, start_date, rent_cents, billing_day)
    values (%L, %L, %L, current_date, 100000, 29)
  $$, :orgB, :unitT2, :tenantSam)),
  '23514',
  'a billing day of 29 is refused — February would not have it');

select * from finish();
rollback;
