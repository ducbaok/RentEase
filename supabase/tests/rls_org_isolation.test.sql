-- RentEase · RLS layer 1 — one landlord cannot see another landlord's data.
-- Covers the first line of the Definition of Done in docs/sot/10-requirements.md.
-- Scaffolding rationale: supabase/tests/00_helpers.sql

begin;
create extension if not exists pgtap;
select plan(24);

create table public.tres (k text primary key, v text);
grant all on public.tres to authenticated;

create or replace function public.attempt(p_sql text)
returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return sqlstate; end;
$$;

-- Runs a statement and reports how many rows it touched, or 'ERR:<sqlstate>'.
-- A hidden row does not raise: an UPDATE or DELETE simply matches nothing. This
-- separates "refused" from "found nothing", which are different guarantees.
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

-- Shorthands for the fixture in supabase/seed.sql
\set alice '''a0000000-0000-4000-8000-000000000010'''
\set mike  '''a0000000-0000-4000-8000-000000000011'''
\set bob   '''b0000000-0000-4000-8000-000000000010'''
\set orgB  '''b0000000-0000-4000-8000-000000000001'''
\set unitB '''b0000000-0000-4000-8000-000000000101'''
\set propB '''b0000000-0000-4000-8000-000000000100'''
\set invB  '''b0000000-0000-4000-8000-000000000050'''
\set invA  '''a0000000-0000-4000-8000-000000000050'''
\set propA '''a0000000-0000-4000-8000-000000000100'''
\set orgA  '''a0000000-0000-4000-8000-000000000001'''
\set unit101 '''a0000000-0000-4000-8000-000000000101'''
\set unit102 '''a0000000-0000-4000-8000-000000000102'''
\set unit103 '''a0000000-0000-4000-8000-000000000103'''
\set unitB2  '''b0000000-0000-4000-8000-000000000102'''

-- ===========================================================================
-- Alice — owner of org A
-- ===========================================================================
reset role;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000010","role":"authenticated"}';
set local role authenticated;

-- Assertions are phrased as "everything I can see is mine", never "I can see
-- exactly N rows". A total count silently depends on data no one in this file
-- controls -- the e2e suite issues invoices for org A -- so it goes red for a
-- reason that has nothing to do with isolation. Counting foreign rows tests the
-- actual promise and cannot be broken by unrelated data.
insert into public.tres values
  ('alice_foreign_units',    (select count(*) from public.units    where org_id <> :orgA)::text),
  ('alice_foreign_invoices', (select count(*) from public.invoices where org_id <> :orgA)::text),
  ('alice_foreign_props',    (select count(*) from public.properties where org_id <> :orgA)::text),
  ('alice_foreign_leases',   (select count(*) from public.leases   where org_id <> :orgA)::text),
  ('alice_foreign_payments', (select count(*) from public.payments where org_id <> :orgA)::text),
  ('alice_seeded_units',     (select count(*) from public.units
                              where id in (:unit101, :unit102, :unit103))::text),
  ('alice_subs',       (select count(*) from public.subscriptions)::text),
  ('alice_sees_unitB', (select count(*) from public.units where id = :unitB)::text),
  ('alice_sees_invB',  (select count(*) from public.invoices where id = :invB)::text),
  -- Writing into another org must raise, not silently no-op.
  ('alice_insert_propB', public.attempt(
     format('insert into public.properties (org_id, name) values (%L, %L)', :orgB, 'Hostile'))),
  -- A hidden row is not an error; the UPDATE simply finds nothing to match.
  ('alice_update_unitB_rows', public.attempt_rows(
     format('update public.units set base_rent_cents = 1 where id = %L', :unitB))),
  ('alice_delete_propB_rows', public.attempt_rows(
     format('delete from public.properties where id = %L', :propB))),
  -- Defence in depth: even with a correct org_id, the composite FK refuses to
  -- hang a unit of org A off a property of org B.
  ('alice_stitch_orgs', public.attempt(
     format('insert into public.units (org_id, property_id, code) values (%L, %L, %L)',
            :orgA, :propB, 'X9')));

reset role;
select is((select v from public.tres where k = 'alice_seeded_units'), '3',
  'owner A can see all three of her own units');
select is((select v from public.tres where k = 'alice_foreign_units'), '0',
  'every unit owner A can see belongs to her organization');
select is((select v from public.tres where k = 'alice_foreign_invoices'), '0',
  'every invoice owner A can see belongs to her organization');
select is((select v from public.tres where k = 'alice_foreign_props'), '0',
  'every property owner A can see belongs to her organization');
select is((select v from public.tres where k = 'alice_foreign_leases'), '0',
  'every lease owner A can see belongs to her organization');
select is((select v from public.tres where k = 'alice_foreign_payments'), '0',
  'every payment owner A can see belongs to her organization');
select is((select v from public.tres where k = 'alice_subs'), '1',
  'owner A can read her own subscription');
select is((select v from public.tres where k = 'alice_sees_unitB'), '0',
  'owner A cannot read org B unit even by exact id');
select is((select v from public.tres where k = 'alice_sees_invB'), '0',
  'owner A cannot read org B invoice even by exact id');
select is((select v from public.tres where k = 'alice_insert_propB'), '42501',
  'owner A is blocked from inserting a property into org B');
select is((select v from public.tres where k = 'alice_update_unitB_rows'), '0',
  'updating an org B unit is not an error — it simply matches zero rows');
select is((select v from public.tres where k = 'alice_delete_propB_rows'), '0',
  'deleting an org B property also matches zero rows');
select is((select v from public.tres where k = 'alice_stitch_orgs'), '23503',
  'composite FK refuses to attach an org A unit to an org B property');

-- ===========================================================================
-- Mike — manager of org A. Same buildings, no billing relationship.
-- ===========================================================================
reset role;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000011","role":"authenticated"}';
set local role authenticated;

insert into public.tres values
  ('mike_foreign_units', (select count(*) from public.units where org_id <> :orgA)::text),
  ('mike_seeded_units',  (select count(*) from public.units where id in (:unit101, :unit102, :unit103))::text),
  ('mike_subs',  (select count(*) from public.subscriptions)::text),
  ('mike_update_org_rows', public.attempt_rows(
     format('update public.organizations set name = %L where id = %L', 'Renamed', :orgA))),
  ('mike_insert_user', public.attempt(
     format('insert into public.users (id, org_id, email, role) values (%L, %L, %L, %L)',
            '00000000-0000-4000-8000-0000000000ff', :orgA, 'intruder@x.test', 'owner')));

reset role;
select is((select v from public.tres where k = 'mike_seeded_units'), '3',
  'manager sees the same units as the owner');
select is((select v from public.tres where k = 'mike_foreign_units'), '0',
  'and nothing outside the organization');
select is((select v from public.tres where k = 'mike_subs'), '0',
  'manager cannot read the subscription — billing is the owner''s alone');
select is((select v from public.tres where k = 'mike_update_org_rows'), '0',
  'manager cannot rename the organization');
select is((select v from public.tres where k = 'mike_insert_user'), '42501',
  'manager cannot add operator accounts');

-- ===========================================================================
-- Bob — owner of org B. The mirror image, so no test passes merely because
-- the data happened to be absent.
-- ===========================================================================
reset role;
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000010","role":"authenticated"}';
set local role authenticated;

insert into public.tres values
  ('bob_foreign_units', (select count(*) from public.units where org_id <> :orgB)::text),
  ('bob_seeded_units',  (select count(*) from public.units where id in (:unitB, :unitB2))::text),
  ('bob_sees_invA',  (select count(*) from public.invoices where id = :invA)::text),
  ('bob_sees_propA', (select count(*) from public.properties where id = :propA)::text),
  ('bob_insert_reminder', public.attempt(
     format('insert into public.reminder_logs (org_id, invoice_id, kind) values (%L, %L, %L)',
            :orgB, :invB, 'overdue_1'))),
  ('bob_delete_audit', public.attempt('delete from public.audit_logs'));

reset role;
select is((select v from public.tres where k = 'bob_seeded_units'), '2',
  'owner B can see both of his own units');
select is((select v from public.tres where k = 'bob_foreign_units'), '0',
  'every unit owner B can see belongs to his organization');
select is((select v from public.tres where k = 'bob_sees_invA'), '0',
  'owner B cannot read org A invoice even by exact id');
select is((select v from public.tres where k = 'bob_sees_propA'), '0',
  'owner B cannot read org A property even by exact id');
select is((select v from public.tres where k = 'bob_insert_reminder'), '42501',
  'nobody can forge a reminder log — only the job''s service role writes there');
select is((select v from public.tres where k = 'bob_delete_audit'), '42501',
  'the audit trail cannot be deleted, not even by an owner');

select * from finish();
rollback;
