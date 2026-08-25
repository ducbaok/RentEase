-- RentEase · 0700 · Row-Level Security — the entire access-control surface
--
-- Every policy in the product lives in this one file on purpose. "One landlord
-- cannot see another landlord's data, and unit 201 cannot reach unit 202" is
-- the promise the product is sold on, so the rules enforcing it must be
-- readable end to end in a single sitting rather than scattered across the
-- migration that happened to create each table.
--
-- TWO LAYERS (docs/sot/30-data-model.md):
--   Layer 1 — operator: org_id = current_org_id(). Non-null only for members of
--             public.users, so residents fail it automatically.
--   Layer 2 — resident: rows reachable from their own tenant record. Read-only
--             everywhere except filing a maintenance request.
--
-- Identity functions are wrapped in (select ...) so Postgres evaluates them
-- once per query as an InitPlan instead of once per row.
--
-- Anything with no policy for a given action is DENIED — that is how
-- reminder_logs stays writable only by the cron job's service role, and how
-- audit_logs stays append-only.

alter table public.organizations        enable row level security;
alter table public.users                enable row level security;
alter table public.super_admins         enable row level security;
alter table public.properties           enable row level security;
alter table public.units                enable row level security;
alter table public.tenants              enable row level security;
alter table public.leases               enable row level security;
alter table public.tariffs              enable row level security;
alter table public.meter_readings       enable row level security;
alter table public.invoices             enable row level security;
alter table public.payments             enable row level security;
alter table public.maintenance_requests enable row level security;
alter table public.reminder_logs        enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.subscriptions        enable row level security;

-- ===========================================================================
-- organizations
-- ===========================================================================
create policy org_select_own on public.organizations
  for select to authenticated
  using (id = (select public.current_org_id()));

create policy org_update_by_owner on public.organizations
  for update to authenticated
  using (id = (select public.current_org_id())
         and (select public.current_user_role()) = 'owner')
  with check (id = (select public.current_org_id())
              and (select public.current_user_role()) = 'owner');

-- The product back office sees the org list and nothing inside the orgs.
create policy org_select_super on public.organizations
  for select to authenticated
  using ((select public.is_super_admin()));

-- No INSERT policy: organizations are created only through
-- public.create_organization_and_owner() (migration 0900), which also creates
-- the first owner in the same transaction. No DELETE policy: closing an account
-- is a support action, never a stray API call.

-- ===========================================================================
-- users (operators)
-- ===========================================================================
create policy users_select_same_org on public.users
  for select to authenticated
  using (org_id = (select public.current_org_id()));

create policy users_write_by_owner on public.users
  for all to authenticated
  using (org_id = (select public.current_org_id())
         and (select public.current_user_role()) = 'owner')
  with check (org_id = (select public.current_org_id())
              and (select public.current_user_role()) = 'owner');

-- ===========================================================================
-- properties
-- ===========================================================================
create policy properties_operator_all on public.properties
  for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

create policy properties_tenant_select on public.properties
  for select to authenticated
  using (id in (select public.current_tenant_property_ids()));

-- ===========================================================================
-- units
-- ===========================================================================
create policy units_operator_all on public.units
  for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

create policy units_tenant_select on public.units
  for select to authenticated
  using (id in (select public.current_tenant_unit_ids()));

-- ===========================================================================
-- tenants
-- ===========================================================================
create policy tenants_operator_all on public.tenants
  for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

create policy tenants_self_select on public.tenants
  for select to authenticated
  using (id = (select public.current_tenant_id()));

-- ===========================================================================
-- leases
-- ===========================================================================
create policy leases_operator_all on public.leases
  for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

create policy leases_tenant_select on public.leases
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

-- ===========================================================================
-- tariffs — operator only.
-- A resident has no business reading the org's whole rate card; the rates that
-- produced their own bill travel inside invoices.breakdown instead.
-- ===========================================================================
create policy tariffs_operator_all on public.tariffs
  for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

-- ===========================================================================
-- meter_readings — operator only, for the same reason as tariffs.
-- ===========================================================================
create policy meter_readings_operator_all on public.meter_readings
  for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

-- ===========================================================================
-- invoices
-- ===========================================================================
create policy invoices_operator_all on public.invoices
  for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

-- AC7.1 lives here: a resident reaching for another unit's invoice by guessing
-- the URL gets no row back, because the id is not in their lease set.
create policy invoices_tenant_select on public.invoices
  for select to authenticated
  using (lease_id in (select public.current_tenant_lease_ids()));

-- ===========================================================================
-- payments
-- ===========================================================================
create policy payments_operator_all on public.payments
  for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

create policy payments_tenant_select on public.payments
  for select to authenticated
  using (invoice_id in (select public.current_tenant_invoice_ids()));

-- ===========================================================================
-- maintenance_requests
-- ===========================================================================
create policy maintenance_operator_all on public.maintenance_requests
  for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

create policy maintenance_tenant_select on public.maintenance_requests
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

-- Residents may open a request against a unit they actually lease, and it
-- always starts at 'submitted'. They get no UPDATE policy: advancing the status
-- is the operator's action, which is what triggers the notification in AC8.1.
create policy maintenance_tenant_insert on public.maintenance_requests
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and org_id = (select public.current_tenant_org_id())
    and unit_id in (select public.current_tenant_unit_ids())
    and status = 'submitted'
  );

-- ===========================================================================
-- reminder_logs — readable by the org, writable only by the cron job's
-- service role. If the app could insert here it could also fake "already
-- reminded" and silence a real reminder.
-- ===========================================================================
create policy reminder_logs_operator_select on public.reminder_logs
  for select to authenticated
  using (org_id = (select public.current_org_id()));

-- ===========================================================================
-- audit_logs — append-only. INSERT and SELECT only; no UPDATE or DELETE policy
-- exists, so the record of who changed what cannot be edited from the API by
-- anyone, including the owner.
-- ===========================================================================
create policy audit_logs_operator_select on public.audit_logs
  for select to authenticated
  using (org_id = (select public.current_org_id()));

create policy audit_logs_operator_insert on public.audit_logs
  for insert to authenticated
  with check (org_id = (select public.current_org_id())
              and actor_id = (select auth.uid()));

-- ===========================================================================
-- subscriptions — owners only (a manager runs the buildings, not the billing
-- relationship). All writes come from the Stripe webhook via service_role.
-- ===========================================================================
create policy subscriptions_owner_select on public.subscriptions
  for select to authenticated
  using (org_id = (select public.current_org_id())
         and (select public.current_user_role()) = 'owner');

create policy subscriptions_super_select on public.subscriptions
  for select to authenticated
  using ((select public.is_super_admin()));

-- ===========================================================================
-- super_admins — a member may confirm their own membership and nothing more.
-- There is no INSERT policy, so the only way in is direct SQL or the service
-- role: an account cannot promote itself to the product back office.
-- ===========================================================================
create policy super_admins_self_select on public.super_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ===========================================================================
-- TABLE PRIVILEGES — the layer underneath RLS.
--
-- RLS decides which ROWS you may touch; grants decide whether you may attempt
-- the verb at all. Spelling the grants out per table rather than inheriting
-- Supabase's blanket defaults gives a second, independent barrier: even if a
-- policy were mistakenly written too wide, `authenticated` still has no UPDATE
-- on reminder_logs and no DELETE on audit_logs to abuse.
--
-- Nothing in RentEase is readable without an account, so anon gets nothing.
-- ===========================================================================
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

grant usage on schema public to authenticated;

-- Full CRUD: the day-to-day operating tables.
grant select, insert, update, delete on
  public.properties,
  public.units,
  public.tenants,
  public.leases,
  public.tariffs,
  public.meter_readings,
  public.invoices,
  public.payments,
  public.maintenance_requests,
  public.users
to authenticated;

-- Read-only by verb, not just by policy.
grant select on public.organizations to authenticated;
grant update on public.organizations to authenticated;  -- owners only, per policy above

-- Append-only: the audit trail can be written and read, never altered.
grant select, insert on public.audit_logs to authenticated;

-- Written exclusively by the reminder job's service role.
grant select on public.reminder_logs to authenticated;

-- Written exclusively by the Stripe webhook's service role.
grant select on public.subscriptions to authenticated;

-- Membership in the product back office is readable, never writable.
grant select on public.super_admins to authenticated;
