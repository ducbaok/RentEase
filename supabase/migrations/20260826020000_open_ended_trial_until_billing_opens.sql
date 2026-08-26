-- ===========================================================================
-- Post-MVP — the trial runs until billing opens (D24)
--
-- Collecting money is deferred: Stripe does not accept merchant signups from
-- Vietnam, so there is no account to charge through yet, and the decision was
-- to ship without payments rather than wait for a foreign entity (D24).
--
-- That turns the 14-day trial from a sales device into a self-inflicted
-- outage. lib/domain/plan-limits.ts refuses NEW records once a trial expires
-- (AC-S3) — correct while there is an upgrade path, and a locked application
-- when there is none. Fourteen days after deploying, every organization
-- including the operator's own would stop accepting units, and no amount of
-- clicking could fix it.
--
-- WHAT THIS DOES NOT CHANGE
-- Not the mechanism, only the deadline it is given. `status` is still
-- 'trialing', `period_end` is still the deadline, plan-limits still enforces
-- AC-S2 and AC-S3 exactly as before, and every test that proves them still
-- runs against a deadline in the past. Reopening billing is this file again
-- with the sentinel replaced by `now() + interval '14 days'` — plus a decision
-- about the organizations that were let in for free.
--
-- WHY A SENTINEL DATE AND NOT `now() + 100 years`
-- 2099-12-31 is the same marker the demo organization already uses, it is
-- obviously deliberate to anyone reading a row, and it is one value rather
-- than one per organization — so when billing opens, the rows to reconsider
-- are exactly `where period_end = '2099-12-31'`. A rolling interval would
-- scatter them across a century and make them indistinguishable from real
-- trials.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Signup: hand out the open-ended deadline.
--
-- Reproduced in full rather than patched, because a plpgsql body cannot be
-- amended in place. The ONLY difference from migration 20260826010000 is the
-- `period_end` value in the subscriptions insert; every guard, error code and
-- ordering is unchanged and must stay that way.
-- ---------------------------------------------------------------------------
create or replace function public.create_organization_and_owner(
  p_org_name text,
  p_full_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_org   uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if coalesce(trim(p_org_name), '') = '' then
    raise exception 'organization name is required' using errcode = '22023';
  end if;

  -- One account belongs to one organization in the MVP. Silently creating a
  -- second one would strand the first.
  if exists (select 1 from public.users where id = v_uid) then
    raise exception 'this account already belongs to an organization'
      using errcode = '23505';
  end if;

  -- A resident portal account must never be able to become an operator.
  if exists (select 1 from public.tenants where portal_user_id = v_uid) then
    raise exception 'resident accounts cannot create an organization'
      using errcode = '42501';
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.organizations (name)
  values (trim(p_org_name))
  returning id into v_org;

  insert into public.users (id, org_id, email, full_name, role)
  values (v_uid, v_org, coalesce(v_email, ''), nullif(trim(coalesce(p_full_name, '')), ''), 'owner');

  -- D24 — the trial ends when billing opens, not on a calendar date. Written
  -- here, at the one moment the trial begins, so every later reader agrees.
  insert into public.subscriptions (org_id, plan, status, period_end)
  values (v_org, 'mini', 'trialing', timestamptz '2099-12-31 00:00:00+00');

  return v_org;
end;
$$;

-- create-or-replace keeps the existing ACL, but restating it costs nothing and
-- makes this file readable on its own.
revoke all on function public.create_organization_and_owner(text, text) from public, anon;
grant execute on function public.create_organization_and_owner(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Existing trials: move them to the same sentinel.
--
-- Scoped to `trialing` rows, so nothing the Stripe webhook has written is
-- touched, and the demo organization — which is 'active' — is left alone.
-- Idempotent: running it twice sets the same value.
-- ---------------------------------------------------------------------------
update public.subscriptions
   set period_end = timestamptz '2099-12-31 00:00:00+00'
 where status = 'trialing';
