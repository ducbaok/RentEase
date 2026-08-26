-- ===========================================================================
-- Batch 3 · stream 3A — the 14-day no-card trial gets a deadline (D22, AC-S3)
--
-- This is the ONE migration stream 3A is allowed, and it was written into
-- docs/sot/30-data-model.md and approved before any of this batch's code was
-- written — the ritual D7 asks for. It adds no table, no column and no policy.
-- Stripe needs none: `subscriptions.status = 'trialing'` was already the
-- default from Batch 0, and `period_end` was already there to hold a deadline.
-- All that was missing was somebody writing the deadline down.
--
-- Without it, `period_end` stays NULL for every new organization and the trial
-- has no end — the application would have to invent one from `created_at`, and
-- an invented deadline is one that two different code paths can invent
-- differently. Recorded once, at signup, it is a fact rather than a
-- recalculation.
--
-- WHY 'trialing' STAYS THE STATUS
-- It is Stripe's own word for the same thing, so when a real Stripe trial or
-- subscription later overwrites this row through the webhook, the vocabulary
-- does not change underneath the application. lib/domain/plan-limits.ts reads
-- one status field, not two.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Signup: record when the trial runs out.
--
-- Reproduced in full rather than patched, because a plpgsql body cannot be
-- amended in place. The ONLY difference from migration 0900 is the
-- `period_end` value in the subscriptions insert; everything else — the
-- guards, the error codes, the ordering — is unchanged and must stay that way.
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

  -- D22 — 14 days, no card. The deadline is written here, at the one moment
  -- the trial actually begins, so every later reader agrees on when it ends.
  insert into public.subscriptions (org_id, plan, status, period_end)
  values (v_org, 'mini', 'trialing', now() + interval '14 days');

  return v_org;
end;
$$;

-- create-or-replace keeps the existing ACL, but restating it costs nothing and
-- makes this file readable on its own.
revoke all on function public.create_organization_and_owner(text, text) from public, anon;
grant execute on function public.create_organization_and_owner(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: organizations that started their trial before this migration.
--
-- Their trial began when the row was created, so it ends fourteen days after
-- that. Scoped to rows with no deadline at all, which makes it idempotent and
-- keeps it from touching anything the Stripe webhook has since written.
-- ---------------------------------------------------------------------------
update public.subscriptions
   set period_end = created_at + interval '14 days'
 where status = 'trialing'
   and period_end is null;
