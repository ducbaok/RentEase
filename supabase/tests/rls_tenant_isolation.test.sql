-- RentEase · RLS layer 2 — unit 201 cannot reach unit 202.
--
-- This is AC7.1, and the brief calls it out as the thing sloppy software gets
-- wrong: "not even by typing the address directly". So every read test here
-- asks for a row BY ITS EXACT ID. A test that only counted visible rows could
-- pass while a direct lookup still leaked.
--
-- Scaffolding rationale: supabase/tests/00_helpers.sql

begin;
create extension if not exists pgtap;
select plan(22);

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

-- Fixture (supabase/seed.sql): Dana rents unit 101, Ray rents unit 102, both in
-- org A. Sam rents unit A1 in org B.
\set dana_invoice '''a0000000-0000-4000-8000-000000000050'''
\set ray_invoice  '''a0000000-0000-4000-8000-000000000051'''
\set sam_invoice  '''b0000000-0000-4000-8000-000000000050'''
\set ray_unit     '''a0000000-0000-4000-8000-000000000102'''
\set dana_unit    '''a0000000-0000-4000-8000-000000000101'''
\set ray_request  '''a0000000-0000-4000-8000-000000000061'''
\set dana_tenant  '''a0000000-0000-4000-8000-000000000030'''
\set ray_tenant   '''a0000000-0000-4000-8000-000000000031'''
\set orgA         '''a0000000-0000-4000-8000-000000000001'''
\set dana_lease   '''a0000000-0000-4000-8000-000000000040'''
\set dana_inv2    '''a0000000-0000-4000-8000-000000000053'''
\set propA        '''a0000000-0000-4000-8000-000000000100'''

-- ===========================================================================
-- Dana — resident of unit 101
-- ===========================================================================
reset role;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000020","role":"authenticated"}';
set local role authenticated;

insert into public.tres values
  -- Identity: a resident is not an operator, and the disjointness is what makes
  -- every operator policy fail for her without any extra role check.
  ('dana_org_id_is_null', (select public.current_org_id() is null)::text),
  ('dana_tenant_id',      (select public.current_tenant_id())::text),

  -- Phrased as "everything I can see is mine", not "I see exactly N rows".
  -- A total count depends on data this file does not control -- the billing
  -- e2e issues invoices against org A leases -- so it would go red for a reason
  -- unrelated to isolation. See the same note in rls_org_isolation.test.sql.
  ('dana_own_invoices',    (select count(*) from public.invoices
                            where id in (:dana_invoice, :dana_inv2))::text),
  ('dana_own_invoice',     (select count(*) from public.invoices where id = :dana_invoice)::text),
  ('dana_foreign_invoices',(select count(*) from public.invoices where lease_id <> :dana_lease)::text),
  ('dana_foreign_units',   (select count(*) from public.units where id <> :dana_unit)::text),
  ('dana_foreign_props',   (select count(*) from public.properties where id <> :propA)::text),
  ('dana_foreign_leases',  (select count(*) from public.leases where tenant_id <> :dana_tenant)::text),
  ('dana_foreign_tenants', (select count(*) from public.tenants where id <> :dana_tenant)::text),
  ('dana_foreign_payments',(select count(*) from public.payments
                            where invoice_id not in (:dana_invoice, :dana_inv2))::text),

  -- What she must not see, asked for by exact id.
  ('dana_sees_ray_invoice',  (select count(*) from public.invoices where id = :ray_invoice)::text),
  ('dana_sees_sam_invoice',  (select count(*) from public.invoices where id = :sam_invoice)::text),
  ('dana_sees_ray_unit',     (select count(*) from public.units where id = :ray_unit)::text),
  ('dana_sees_ray_request',  (select count(*) from public.maintenance_requests where id = :ray_request)::text),
  ('dana_sees_ray_payments', (select count(*) from public.payments where invoice_id = :ray_invoice)::text),
  -- The rate card belongs to the landlord; the rates behind her own bill reach
  -- her inside invoices.breakdown instead.
  ('dana_tariffs',        (select count(*) from public.tariffs)::text),
  ('dana_meters',         (select count(*) from public.meter_readings)::text),
  ('dana_users',          (select count(*) from public.users)::text),
  ('dana_subscriptions',  (select count(*) from public.subscriptions)::text),

  -- Writes.
  ('dana_files_own_request', public.attempt(
     format('insert into public.maintenance_requests (org_id, unit_id, tenant_id, title) values (%L, %L, %L, %L)',
            :orgA, :dana_unit, :dana_tenant, 'Bathroom light out'))),
  ('dana_files_for_ray', public.attempt(
     format('insert into public.maintenance_requests (org_id, unit_id, tenant_id, title) values (%L, %L, %L, %L)',
            :orgA, :ray_unit, :ray_tenant, 'Not my unit'))),
  -- Advancing status is the operator's action — it is what notifies the
  -- resident, so a resident closing her own ticket would break AC8.1.
  ('dana_closes_own_request_rows', public.attempt_rows(
     format('update public.maintenance_requests set status = %L where tenant_id = %L', 'done', :dana_tenant))),
  ('dana_records_payment', public.attempt(
     format('insert into public.payments (org_id, invoice_id, amount_cents, method) values (%L, %L, 1000, %L)',
            :orgA, :dana_invoice, 'cash'))),
  ('dana_edits_own_invoice_rows', public.attempt_rows(
     format('update public.invoices set rent_cents = 1 where id = %L', :dana_invoice)));

reset role;
select is((select v from public.tres where k = 'dana_org_id_is_null'), 'true',
  'a resident has no operator identity at all');
select is((select v from public.tres where k = 'dana_own_invoices'), '2',
  'resident can see both of her own invoices');
select is((select v from public.tres where k = 'dana_own_invoice'), '1',
  'resident can open her own invoice');
select is((select v from public.tres where k = 'dana_foreign_invoices'), '0',
  'every invoice a resident can see is on her own lease');
select is((select v from public.tres where k = 'dana_foreign_units'), '0',
  'every unit a resident can see is the one she rents');
select is((select v from public.tres where k = 'dana_foreign_props'), '0',
  'every property a resident can see is the one she lives in');
select is((select v from public.tres where k = 'dana_foreign_leases'), '0',
  'every lease a resident can see is her own');
select is((select v from public.tres where k = 'dana_foreign_tenants'), '0',
  'every resident record a resident can see is her own');
select is((select v from public.tres where k = 'dana_foreign_payments'), '0',
  'every payment a resident can see is against one of her own invoices');

select is((select v from public.tres where k = 'dana_sees_ray_invoice'), '0',
  'AC7.1: resident of 101 cannot read the invoice of 102 by exact id');
select is((select v from public.tres where k = 'dana_sees_sam_invoice'), '0',
  'resident cannot read an invoice from another organization by exact id');
select is((select v from public.tres where k = 'dana_sees_ray_unit'), '0',
  'resident cannot read a neighbour''s unit by exact id');
select is((select v from public.tres where k = 'dana_sees_ray_request'), '0',
  'resident cannot read a neighbour''s maintenance request by exact id');
select is((select v from public.tres where k = 'dana_sees_ray_payments'), '0',
  'resident cannot read payments against a neighbour''s invoice');
select is((select v from public.tres where k = 'dana_tariffs'), '0',
  'resident cannot read the landlord''s rate card');
select is((select v from public.tres where k = 'dana_meters'), '0',
  'resident cannot read raw meter readings');
select is((select v from public.tres where k = 'dana_users'), '0',
  'resident cannot enumerate the landlord''s staff');
select is((select v from public.tres where k = 'dana_subscriptions'), '0',
  'resident cannot see the landlord''s subscription');

select is((select v from public.tres where k = 'dana_files_own_request'), 'ok',
  'resident can report a problem with her own unit');
select is((select v from public.tres where k = 'dana_files_for_ray'), '42501',
  'resident cannot file a request against a unit she does not rent');
select is((select v from public.tres where k = 'dana_closes_own_request_rows'), '0',
  'resident cannot advance a request status — that is what notifies her');
select is((select v from public.tres where k = 'dana_records_payment'), '42501',
  'resident cannot record a payment against her own invoice');

select * from finish();
rollback;
