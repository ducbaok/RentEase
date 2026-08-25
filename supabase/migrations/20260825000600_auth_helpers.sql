-- RentEase · 0600 · Identity helpers used by every RLS policy
--
-- WHY THESE ARE SECURITY DEFINER
-- A policy expression is evaluated as the querying user, so if a policy on
-- table X selected from table Y, Y's own policies would apply — producing
-- infinite recursion (users → users) or silent empty results. Resolving
-- identity inside SECURITY DEFINER functions breaks that loop once, in one
-- reviewable place, instead of scattering the problem across ~30 policies.
--
-- Each function has a pinned search_path so it cannot be hijacked by a
-- caller-controlled schema, and each returns only facts about the caller.
--
-- OPERATOR vs RESIDENT: these two identities are strictly disjoint.
-- current_org_id() is non-null only for a row in public.users; the
-- current_tenant_*() family is non-null only for a public.tenants row linked
-- through portal_user_id. A resident therefore fails every operator policy by
-- construction, not by remembering to add a role check.

-- --------------------------------------------------------------------------
-- Operator identity
-- --------------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select org_id from public.users where id = auth.uid();
$$;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.users where id = auth.uid();
$$;

-- Product back office. Deliberately a third, separate identity: a super admin
-- is not an owner of anything and inherits no operator powers.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.super_admins where user_id = auth.uid());
$$;

-- --------------------------------------------------------------------------
-- Resident identity — the second tenancy layer
-- --------------------------------------------------------------------------
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.tenants where portal_user_id = auth.uid();
$$;

create or replace function public.current_tenant_unit_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.unit_id
  from public.leases l
  where l.tenant_id = public.current_tenant_id();
$$;

create or replace function public.current_tenant_property_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct u.property_id
  from public.units u
  where u.id in (select public.current_tenant_unit_ids());
$$;

create or replace function public.current_tenant_lease_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.id
  from public.leases l
  where l.tenant_id = public.current_tenant_id();
$$;

create or replace function public.current_tenant_invoice_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id
  from public.invoices i
  where i.lease_id in (select public.current_tenant_lease_ids());
$$;

create or replace function public.current_tenant_maintenance_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.id
  from public.maintenance_requests m
  where m.tenant_id = public.current_tenant_id();
$$;

create or replace function public.current_tenant_org_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select org_id from public.tenants where portal_user_id = auth.uid();
$$;

-- Anonymous callers have no identity to resolve; keep them out entirely.
revoke all on function
  public.is_super_admin(),
  public.current_org_id(),
  public.current_user_role(),
  public.current_tenant_id(),
  public.current_tenant_unit_ids(),
  public.current_tenant_property_ids(),
  public.current_tenant_lease_ids(),
  public.current_tenant_invoice_ids(),
  public.current_tenant_maintenance_ids(),
  public.current_tenant_org_id()
from public, anon;

grant execute on function
  public.is_super_admin(),
  public.current_org_id(),
  public.current_user_role(),
  public.current_tenant_id(),
  public.current_tenant_unit_ids(),
  public.current_tenant_property_ids(),
  public.current_tenant_lease_ids(),
  public.current_tenant_invoice_ids(),
  public.current_tenant_maintenance_ids(),
  public.current_tenant_org_id()
to authenticated, service_role;
