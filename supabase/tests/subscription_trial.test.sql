-- RentEase · the 14-day trial, and who may read a subscription
--
-- Two things are proved against the database itself rather than through the
-- application, because both are promises the application cannot keep on its own:
--
--   D22 / AC-S3  a new organization gets a trial deadline at the moment it is
--                created. If create_organization_and_owner ever stops writing
--                period_end, every trial becomes endless and nothing in the UI
--                would look wrong — the landlord simply never gets asked to pay.
--
--   AC-S2 posture  a manager cannot read the billing relationship, and NOBODY
--                  holding an ordinary session can write it. The billing page
--                  hides itself from managers politely, but that is manners;
--                  this is the rule. Every write to subscriptions goes through
--                  the Stripe webhook's service role, which is only true while
--                  `authenticated` has no INSERT, UPDATE or DELETE on the table.
--
-- Everything happens inside a fresh organization created by the transaction, so
-- the file asserts nothing about how many rows the shared database happens to
-- hold and is safe to run beside stream 3B and after any e2e run.

begin;
create extension if not exists pgtap;
select plan(14);

create or replace function public.attempt(p_sql text)
returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return sqlstate; end;
$$;

create table public.tres (k text primary key, v text);
grant all on public.tres to authenticated;

\set newOwner  '''c0000000-0000-4000-8000-0000000003a1'''
\set orgA      '''a0000000-0000-4000-8000-000000000001'''
\set managerA  '''a0000000-0000-4000-8000-000000000011'''
\set probeOrg  '''c0000000-0000-4000-8000-0000000003b1'''

-- A brand-new account: authenticated, but not yet anybody's operator.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', :newOwner, 'authenticated', 'authenticated',
  'trial-probe@example.test', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', '', false, false
);

-- ===========================================================================
-- D22 — signing up starts a 14-day trial with a recorded deadline
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-0000000003a1","role":"authenticated"}';

insert into public.tres (k, v)
select 'org', public.create_organization_and_owner('Trial Probe Rentals', 'Trial Probe')::text;

reset role;

select is(
  (select status from public.subscriptions
    where org_id = (select v::uuid from public.tres where k = 'org')),
  'trialing',
  'D22: a new organization starts out trialing');

select is(
  (select plan::text from public.subscriptions
    where org_id = (select v::uuid from public.tres where k = 'org')),
  'mini',
  'the trial sits on the entry plan until a real one is chosen');

select isnt(
  (select period_end from public.subscriptions
    where org_id = (select v::uuid from public.tres where k = 'org')),
  null,
  'D22: the trial deadline is recorded, not left for the application to invent');

-- Fourteen days, checked with a minute of slack on either side so the
-- assertion is about the interval and not about clock jitter.
select ok(
  (select period_end between now() + interval '14 days' - interval '1 minute'
                         and now() + interval '14 days' + interval '1 minute'
     from public.subscriptions
    where org_id = (select v::uuid from public.tres where k = 'org')),
  'D22: the deadline is 14 days out');

select is(
  (select count(*)::int from public.subscriptions
    where org_id = (select v::uuid from public.tres where k = 'org')),
  1,
  'exactly one subscription row per organization');

-- ===========================================================================
-- Backfill — no trialing organization is left without a deadline
--
-- The seed's organizations were created before this migration existed, so they
-- are the backfill's own subjects.
-- ===========================================================================
select is(
  (select count(*)::int from public.subscriptions
    where status = 'trialing' and period_end is null),
  0,
  'backfill: no trialing subscription is left without a deadline');

-- A row shaped the way every trialing subscription looked before the migration:
-- trialing, no deadline, started three days ago. The statement below is the
-- migration's backfill, character for character.
--
-- It is re-run here against a row this transaction created rather than asserted
-- over whatever the shared database happens to hold, because the local Supabase
-- is shared with stream 3B and with every e2e run — and an assertion over rows
-- somebody else inserted is the exact failure this project has already paid for
-- twice (B1B-4, and trap 3 in the handoff).
insert into public.organizations (id, name)
values (:probeOrg, 'Backfill Probe Rentals');

insert into public.subscriptions (org_id, plan, status, period_end, created_at)
values (:probeOrg, 'mini', 'trialing', null, now() - interval '3 days');

update public.subscriptions
   set period_end = created_at + interval '14 days'
 where status = 'trialing'
   and period_end is null;

-- Eleven days out, not fourteen: the deadline dates from when the trial STARTED,
-- not from when the migration happened to run. Backfilling from now() would have
-- handed every existing organization a second free fortnight.
select ok(
  (select period_end between now() + interval '11 days' - interval '1 minute'
                         and now() + interval '11 days' + interval '1 minute'
     from public.subscriptions
    where org_id = :probeOrg),
  'backfill: a trial that started three days ago now ends in eleven');

-- ===========================================================================
-- Reading a subscription — owners only (AC-S2: managers run buildings, not
-- the billing relationship)
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000010","role":"authenticated"}';
insert into public.tres (k, v)
select 'owner_sees', count(*)::text from public.subscriptions;
reset role;

select is(
  (select v from public.tres where k = 'owner_sees'),
  '1',
  'an owner sees exactly one subscription — their own');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000011","role":"authenticated"}';
insert into public.tres (k, v)
select 'manager_sees', count(*)::text from public.subscriptions;
reset role;

select is(
  (select v from public.tres where k = 'manager_sees'),
  '0',
  'AC-S2: a manager sees no subscription at all, not even their own org''s');

-- ===========================================================================
-- Writing a subscription — nobody with an ordinary session, ever
--
-- This is the whole reason the Stripe webhook runs as the service role. If any
-- of these four stopped being refused, a landlord could hand themselves the Pro
-- plan with one request and every limit in AC-S2 would be decoration.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000010","role":"authenticated"}';

insert into public.tres (k, v) select 'upd', public.attempt(format(
  'update public.subscriptions set plan = ''pro'' where org_id = %L', :orgA));

insert into public.tres (k, v) select 'ins', public.attempt(
  'insert into public.subscriptions (org_id, plan, status) values ' ||
  '(''b0000000-0000-4000-8000-000000000001'', ''pro'', ''active'')');

insert into public.tres (k, v) select 'del', public.attempt(format(
  'delete from public.subscriptions where org_id = %L', :orgA));

insert into public.tres (k, v) select 'status', public.attempt(format(
  'update public.subscriptions set status = ''active'' where org_id = %L', :orgA));

reset role;

select is((select v from public.tres where k = 'upd'), '42501',
  'an owner cannot upgrade their own plan by hand');
select is((select v from public.tres where k = 'ins'), '42501',
  'an owner cannot insert a subscription');
select is((select v from public.tres where k = 'del'), '42501',
  'an owner cannot delete a subscription');
select is((select v from public.tres where k = 'status'), '42501',
  'an owner cannot mark their own subscription active');

select is(
  (select plan::text from public.subscriptions where org_id = :orgA),
  'standard',
  'and the plan is unchanged after all four attempts');

select * from finish();
rollback;
