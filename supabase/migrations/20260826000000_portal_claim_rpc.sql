-- RentEase · 0826 · Portal claim RPC (F7)
-- Requirements: F7 — tenant magic-link onboarding (docs/sot/10-requirements.md)
--
-- WHY THIS EXISTS
-- An operator creates a tenant record (F1/F2) with an email but no portal
-- account: portal_user_id stays NULL until the resident accepts the invite.
-- When they first sign in with a magic link they are `unaffiliated` — no
-- public.users row and no linked public.tenants row — so at that instant:
--   * every write policy on public.tenants fails (current_org_id() is NULL,
--     and there is no tenant self-UPDATE policy), and
--   * the service-role client is off-limits to app code (eslint restricts it to
--     the cron and webhook routes).
-- So the link cannot be made from an ordinary query. This is the same shape as
-- create_organization_and_owner (migration 0900): a narrow SECURITY DEFINER
-- function that runs the one privileged write with its own explicit guards.
--
-- IDENTITY SAFETY
-- The email is read from auth.users, which Supabase has already verified by
-- delivering and validating the magic link — it is never taken from the client.
-- An operator account can never become a resident, mirroring the reverse guard
-- that already lives in create_organization_and_owner.

create or replace function public.claim_tenant_portal()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_tenant uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Idempotent: a second visit to the callback (a refresh, a re-click) must not
  -- error. If this account is already a resident, return that tenant unchanged.
  select id into v_tenant from public.tenants where portal_user_id = v_uid;
  if v_tenant is not null then
    return v_tenant;
  end if;

  -- An operator account must never be able to become a resident as well.
  if exists (select 1 from public.users where id = v_uid) then
    raise exception 'operator accounts cannot claim a resident portal'
      using errcode = '42501';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if coalesce(trim(v_email), '') = '' then
    raise exception 'no verified email to match a resident record'
      using errcode = '22023';
  end if;

  -- Link the one unclaimed tenant whose email matches, case-insensitively.
  -- portal_user_id IS NULL in the predicate means an invitation can be claimed
  -- exactly once; the UNIQUE constraint on portal_user_id is the backstop. If a
  -- person was invited by two organizations (Q6: one account = one org in the
  -- MVP), the oldest pending record wins and the other stays open.
  update public.tenants t
     set portal_user_id = v_uid
   where t.id = (
     select id from public.tenants
      where portal_user_id is null
        and lower(email) = lower(v_email)
      order by created_at
      limit 1
   )
  returning t.id into v_tenant;

  if v_tenant is null then
    raise exception 'no pending invitation for this email'
      using errcode = 'P0002';
  end if;

  return v_tenant;
end;
$$;

revoke all on function public.claim_tenant_portal() from public, anon;
grant execute on function public.claim_tenant_portal() to authenticated;
