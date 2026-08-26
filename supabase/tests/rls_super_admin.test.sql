-- RentEase · the third identity — what the product back office can and cannot reach.
--
-- Stream 3B builds app/(super) on exactly two policies: org_select_super on
-- organizations and subscriptions_super_select on subscriptions. Everything
-- else is supposed to be closed to a super admin, and "supposed to" is not a
-- guarantee until something tries it.
--
-- The interesting direction is not "can the back office read the org list" —
-- that is the feature and it would be noticed immediately if it broke. It is
-- the other one: a super admin is NOT a landlord, so the moment a future policy
-- is written a little too generously, this file goes red before anyone ships a
-- back office that can read a customer's rent roll.
--
-- Scaffolding rationale: supabase/tests/00_helpers.sql
-- Assertions are phrased against named seed rows, never as totals, so the e2e
-- suite creating organizations cannot turn them red (bug B1B-4).

begin;
create extension if not exists pgtap;
select plan(29);

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

-- Shorthands for the fixture in supabase/seed.sql
\set super '''e0000000-0000-4000-8000-000000000001'''
\set alice '''a0000000-0000-4000-8000-000000000010'''
\set dana  '''a0000000-0000-4000-8000-000000000020'''
\set orgA  '''a0000000-0000-4000-8000-000000000001'''
\set orgB  '''b0000000-0000-4000-8000-000000000001'''
\set orgDemo '''d0000000-0000-4000-8000-000000000001'''

-- ===========================================================================
-- The super admin
-- ===========================================================================
reset role;
set local request.jwt.claims = '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local role authenticated;

insert into public.tres values
  -- Identity: super, and NEITHER of the other two. This is D12 stated as a
  -- fact about the database rather than as a paragraph of documentation — it
  -- is why a super admin fails every operator and resident policy without any
  -- policy having to mention super admins at all.
  ('super_is_super',    (select public.is_super_admin())::text),
  ('super_org_id',      coalesce((select public.current_org_id())::text, 'null')),
  ('super_tenant_id',   coalesce((select public.current_tenant_id())::text, 'null')),

  -- The feature: every account, and its subscription.
  ('super_sees_orgA',   (select count(*) from public.organizations where id = :orgA)::text),
  ('super_sees_orgB',   (select count(*) from public.organizations where id = :orgB)::text),
  ('super_sees_demo',   (select count(*) from public.organizations where id = :orgDemo)::text),
  ('super_subs_orgA',   (select count(*) from public.subscriptions where org_id = :orgA)::text),
  -- D23 constraint 2, visible from the one screen that would notice it lapsing.
  ('super_demo_status', (select status from public.subscriptions where org_id = :orgDemo)),

  -- And nothing whatsoever from inside any of them.
  ('super_units',       (select count(*) from public.units)::text),
  ('super_properties',  (select count(*) from public.properties)::text),
  ('super_tenants',     (select count(*) from public.tenants)::text),
  ('super_leases',      (select count(*) from public.leases)::text),
  ('super_invoices',    (select count(*) from public.invoices)::text),
  ('super_payments',    (select count(*) from public.payments)::text),
  ('super_meters',      (select count(*) from public.meter_readings)::text),
  ('super_maintenance', (select count(*) from public.maintenance_requests)::text),
  ('super_audit',       (select count(*) from public.audit_logs)::text),
  ('super_reminders',   (select count(*) from public.reminder_logs)::text),
  ('super_users',       (select count(*) from public.users)::text),
  ('super_tariffs',     (select count(*) from public.tariffs)::text),

  -- Read-only, and not quietly: a write must be refused, not silently ignored.
  -- The org UPDATE grant exists (owners rename their own business), so this one
  -- matches zero rows rather than raising; the others have no grant at all.
  ('super_update_orgA_rows', public.attempt_rows(
     format('update public.organizations set name = %L where id = %L', 'Seized', :orgA))),
  ('super_insert_prop', public.attempt(
     format('insert into public.properties (org_id, name) values (%L, %L)', :orgA, 'Back office'))),
  ('super_delete_org',  public.attempt(
     format('delete from public.organizations where id = %L', :orgA))),

  -- Membership: it can confirm its own, and it cannot grant another.
  ('super_own_membership', (select count(*) from public.super_admins where user_id = :super)::text),
  ('super_promote_self',   public.attempt(
     format('insert into public.super_admins (user_id) values (%L)', :alice)));

-- ===========================================================================
-- An operator. The back office must be invisible AND unenterable from here —
-- D11's whole claim is that no account can promote itself.
-- ===========================================================================
reset role;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000010","role":"authenticated"}';
set local role authenticated;

insert into public.tres values
  ('alice_sees_super_admins', (select count(*) from public.super_admins)::text),
  ('alice_promotes_self', public.attempt(
     format('insert into public.super_admins (user_id) values (%L)', :alice)));

-- ===========================================================================
-- A resident. Neither the org list nor the back office exists for them.
-- ===========================================================================
reset role;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000020","role":"authenticated"}';
set local role authenticated;

insert into public.tres values
  ('dana_sees_orgs',         (select count(*) from public.organizations)::text),
  ('dana_sees_super_admins', (select count(*) from public.super_admins)::text);

-- ===========================================================================
-- Assertions
-- ===========================================================================
reset role;

select is((select v from public.tres where k = 'super_is_super'), 'true',
  'the seeded back-office account resolves as a super admin');
select is((select v from public.tres where k = 'super_org_id'), 'null',
  'a super admin belongs to no organization, so every layer-1 policy fails for it');
select is((select v from public.tres where k = 'super_tenant_id'), 'null',
  'a super admin is no resident either — the three identities are disjoint (D12)');

select is((select v from public.tres where k = 'super_sees_orgA'), '1',
  'the back office sees the first organization');
select is((select v from public.tres where k = 'super_sees_orgB'), '1',
  'the back office sees the second organization');
select is((select v from public.tres where k = 'super_sees_demo'), '1',
  'the back office sees the demo organization');
select is((select v from public.tres where k = 'super_subs_orgA'), '1',
  'the back office sees a subscription it does not own');
select is((select v from public.tres where k = 'super_demo_status'), 'active',
  'the demo subscription is active, not a trial that can expire overnight (D23)');

select is((select v from public.tres where k = 'super_units'), '0',
  'the back office cannot see a single unit');
select is((select v from public.tres where k = 'super_properties'), '0',
  'the back office cannot see a single property');
select is((select v from public.tres where k = 'super_tenants'), '0',
  'the back office cannot see a single resident');
select is((select v from public.tres where k = 'super_leases'), '0',
  'the back office cannot see a single lease');
select is((select v from public.tres where k = 'super_invoices'), '0',
  'the back office cannot see a single invoice');
select is((select v from public.tres where k = 'super_payments'), '0',
  'the back office cannot see a single payment');
select is((select v from public.tres where k = 'super_meters'), '0',
  'the back office cannot see a single meter reading');
select is((select v from public.tres where k = 'super_maintenance'), '0',
  'the back office cannot see a single maintenance request');
select is((select v from public.tres where k = 'super_audit'), '0',
  'the back office cannot read anyone''s audit trail');
select is((select v from public.tres where k = 'super_reminders'), '0',
  'the back office cannot read who has been chased for money');
select is((select v from public.tres where k = 'super_users'), '0',
  'the back office cannot list anyone''s staff');
select is((select v from public.tres where k = 'super_tariffs'), '0',
  'the back office cannot read anyone''s rate card');

select is((select v from public.tres where k = 'super_update_orgA_rows'), '0',
  'the back office cannot rename an organization — the update policy is owners only');
select is((select v from public.tres where k = 'super_insert_prop'), '42501',
  'the back office cannot create anything inside an organization');
select is((select v from public.tres where k = 'super_delete_org'), '42501',
  'the back office cannot delete an organization; closing an account is not an API call');

select is((select v from public.tres where k = 'super_own_membership'), '1',
  'a super admin can confirm its own membership');
select is((select v from public.tres where k = 'super_promote_self'), '42501',
  'not even a super admin can grant the back office to another account (D11)');

select is((select v from public.tres where k = 'alice_sees_super_admins'), '0',
  'an owner cannot see who the product admins are');
select is((select v from public.tres where k = 'alice_promotes_self'), '42501',
  'an owner cannot promote themselves into the back office — there is no INSERT policy at all');

select is((select v from public.tres where k = 'dana_sees_orgs'), '0',
  'a resident sees no organization row, not even their landlord''s');
select is((select v from public.tres where k = 'dana_sees_super_admins'), '0',
  'a resident cannot see the back office either');

select * from finish();
rollback;
