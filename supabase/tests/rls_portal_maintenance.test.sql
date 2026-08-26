-- RentEase · RLS layer 2 — portal onboarding and maintenance authorization.
--
-- Complements rls_tenant_isolation.test.sql (which proves "unit 201 cannot read
-- unit 202"). This file proves the WRITE side of F7/F8:
--   * claim_tenant_portal() links exactly the invited tenant, and nobody else
--   * only an operator in the owning org may advance a maintenance status, which
--     is what sends the resident the notification (AC8.1)
--
-- Every fixture is created INSIDE the transaction and rolled back, so this file
-- never depends on seeded rows that the e2e suite might claim or advance — it is
-- immune to run order (see the note in rls_org_isolation.test.sql).
--
-- Scaffolding rationale: supabase/tests/00_helpers.sql

begin;
create extension if not exists pgtap;
select plan(11);

create table public.tres (k text primary key, v text);
grant all on public.tres to authenticated;

-- Runs a statement and reports rows touched, or 'ERR:<sqlstate>'. A hidden row
-- does not raise — the UPDATE simply matches nothing — which separates
-- "refused" from "found nothing".
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

-- Calls claim_tenant_portal() and reports the linked tenant id or 'ERR:<state>'.
create or replace function public.try_claim()
returns text language plpgsql as $$
declare r uuid;
begin
  r := public.claim_tenant_portal();
  return coalesce(r::text, 'null');
exception when others then return 'ERR:' || sqlstate;
end;
$$;

-- Auth accounts that exist but are not yet residents. claim reads the email
-- from auth.users, so these must be real rows there.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  is_sso_user, is_anonymous
)
values
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'claimme@resident.test', 'x', now(),
   now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'nobody@resident.test', 'x', now(),
   now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', false, false);

-- An unclaimed tenant in org A whose email matches the first account. Uppercase
-- on purpose: the match must be case-insensitive.
insert into public.tenants (id, org_id, full_name, email, portal_user_id)
values ('c0000000-0000-4000-8000-000000000010',
        'a0000000-0000-4000-8000-000000000001', 'Claim Me',
        'ClaimMe@Resident.test', null);

\set claimme_uid  '''c0000000-0000-4000-8000-000000000001'''
\set nobody_uid   '''c0000000-0000-4000-8000-000000000002'''
\set temp_tenant  '''c0000000-0000-4000-8000-000000000010'''
\set alice_uid    '''a0000000-0000-4000-8000-000000000010'''
\set mike_uid     '''a0000000-0000-4000-8000-000000000011'''
\set bob_uid      '''b0000000-0000-4000-8000-000000000010'''
\set dana_uid     '''a0000000-0000-4000-8000-000000000020'''
\set dana_tenant  '''a0000000-0000-4000-8000-000000000030'''
\set dana_request '''a0000000-0000-4000-8000-000000000060'''
\set orgA         '''a0000000-0000-4000-8000-000000000001'''

-- ===========================================================================
-- claimme claims the invitation
-- ===========================================================================
reset role;
set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local role authenticated;
insert into public.tres values ('claim_ok', public.try_claim());

reset role;
insert into public.tres values
  ('claim_linked', (select portal_user_id from public.tenants where id = :temp_tenant)::text);

-- After linking, the account resolves as that tenant and no other.
set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local role authenticated;
insert into public.tres values ('claimme_current_tenant', (select public.current_tenant_id())::text);

-- ===========================================================================
-- Who may NOT claim
-- ===========================================================================
reset role;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000010","role":"authenticated"}';
set local role authenticated;
insert into public.tres values ('operator_claim', public.try_claim());

reset role;
set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local role authenticated;
insert into public.tres values ('no_invite', public.try_claim());

-- Idempotent: an already-linked resident gets their tenant back, not an error.
reset role;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000020","role":"authenticated"}';
set local role authenticated;
insert into public.tres values ('dana_reclaim', public.try_claim());

-- ===========================================================================
-- Advancing a maintenance status is the operator's act, and only in their org
-- ===========================================================================
reset role;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000011","role":"authenticated"}';
set local role authenticated;
insert into public.tres values
  -- mike is a manager in org A: he may move org A's request forward.
  ('operator_advance_own', public.attempt_rows(
     format('update public.maintenance_requests set status = %L where id = %L', 'in_progress', :dana_request))),
  -- everything he can see is his own org.
  ('operator_foreign_requests', (select count(*) from public.maintenance_requests
                                  where org_id <> :orgA)::text);

reset role;
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000010","role":"authenticated"}';
set local role authenticated;
insert into public.tres values
  -- bob owns org B: org A's request is invisible, so his update matches nothing.
  ('crossorg_advance', public.attempt_rows(
     format('update public.maintenance_requests set status = %L where id = %L', 'done', :dana_request)));

reset role;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000020","role":"authenticated"}';
set local role authenticated;
insert into public.tres values
  -- dana is a resident: she has no UPDATE policy at all.
  ('resident_advance', public.attempt_rows(
     format('update public.maintenance_requests set status = %L where tenant_id = %L', 'done', :dana_tenant))),
  ('resident_foreign_requests', (select count(*) from public.maintenance_requests
                                 where tenant_id <> :dana_tenant)::text);

-- ===========================================================================
-- Assertions (as postgres, on the parked answers)
-- ===========================================================================
reset role;

select is((select v from public.tres where k = 'claim_ok'), 'c0000000-0000-4000-8000-000000000010',
  'an invited account claims exactly its own tenant record');
select is((select v from public.tres where k = 'claim_linked'), 'c0000000-0000-4000-8000-000000000001',
  'claiming links portal_user_id to the caller (case-insensitive email match)');
select is((select v from public.tres where k = 'claimme_current_tenant'), 'c0000000-0000-4000-8000-000000000010',
  'after claiming, the account resolves as that resident');
select is((select v from public.tres where k = 'operator_claim'), 'ERR:42501',
  'an operator account cannot claim a resident portal');
select is((select v from public.tres where k = 'no_invite'), 'ERR:P0002',
  'an email nobody invited cannot claim anything');
select is((select v from public.tres where k = 'dana_reclaim'), 'a0000000-0000-4000-8000-000000000030',
  'claiming again returns the existing tenant instead of erroring');

select is((select v from public.tres where k = 'operator_advance_own'), '1',
  'an operator advances a maintenance request in their own org');
select is((select v from public.tres where k = 'operator_foreign_requests'), '0',
  'every maintenance request an operator sees is in their own org');
select is((select v from public.tres where k = 'crossorg_advance'), '0',
  'an operator cannot advance a request in another org — it is invisible to them');
select is((select v from public.tres where k = 'resident_advance'), '0',
  'a resident cannot advance a status — that is what would notify her');
select is((select v from public.tres where k = 'resident_foreign_requests'), '0',
  'every maintenance request a resident sees is her own');

select * from finish();
rollback;
