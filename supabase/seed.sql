-- RentEase · local seed
--
-- Two organizations that deliberately mirror each other. Every isolation test
-- works by signing in as someone from one and reaching for something in the
-- other, so the two sides must be structurally similar — otherwise a test could
-- pass because the data simply wasn't there rather than because RLS held.
--
--   Northside Rentals (org A) — Cedar Court, units 101 / 102 / 103
--     alice@northside.test  owner    | mike@northside.test  manager
--     dana@resident.test    unit 101 | ray@resident.test    unit 102
--     Nina Alvarez          unit 103 — no portal account yet, on purpose:
--                                      billing must work before the invite.
--
--   Lakeview Property Group (org B) — Lakeview Flats, units A1 / A2
--     bob@lakeview.test     owner
--     sam@resident.test     unit A1
--
--   Riverbend Residential (demo org, D23) — SKELETON ONLY
--     demo-owner@example.com    owner
--     demo-manager@example.com  manager
--     The organization, its two operators and a subscription that never
--     expires are created here; the properties, leases, invoices and the rest
--     are NOT. They are a pure function of today's date and are written by
--     app/api/cron/demo-reset (`pnpm demo:reset`), which is also what rebuilds
--     them every night. One definition of the demo dataset, not two that drift.
--
--   super@rentease.test — the product back office (D11)
--     A row in super_admins, which has no INSERT policy: membership can only
--     be granted by direct SQL, and this is that SQL. It exists so the e2e
--     suite can prove the (super) area both works for a super admin and turns
--     everyone else away.
--
-- Password for every account: password123
--
-- Invoice statuses are NOT written here. They are derived by the triggers in
-- migration 0900, so a successful seed is itself a check that the invariants
-- work. Period 2026-07 is fully settled/overdue; 2026-08 has readings entered
-- but only unit 101 invoiced — that leaves a realistic starting point for the
-- bulk-issue flow and its duplicate-protection test.

-- ===========================================================================
-- Auth accounts
-- ===========================================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', '', false, false
from (values
  ('a0000000-0000-4000-8000-000000000010'::uuid, 'alice@northside.test'),
  ('a0000000-0000-4000-8000-000000000011'::uuid, 'mike@northside.test'),
  ('a0000000-0000-4000-8000-000000000020'::uuid, 'dana@resident.test'),
  ('a0000000-0000-4000-8000-000000000021'::uuid, 'ray@resident.test'),
  ('b0000000-0000-4000-8000-000000000010'::uuid, 'bob@lakeview.test'),
  ('b0000000-0000-4000-8000-000000000020'::uuid, 'sam@resident.test'),
  -- Demo operators. @example.com is reserved and cannot receive mail (D23).
  ('d0000000-0000-4000-8000-000000000010'::uuid, 'demo-owner@example.com'),
  ('d0000000-0000-4000-8000-000000000011'::uuid, 'demo-manager@example.com'),
  -- The product back office. Belongs to no organization, by design.
  ('e0000000-0000-4000-8000-000000000001'::uuid, 'super@rentease.test')
) as u(id, email);

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u;

-- ===========================================================================
-- Organizations and operators
-- ===========================================================================
insert into public.organizations (id, name, plan, status) values
  ('a0000000-0000-4000-8000-000000000001', 'Northside Rentals',       'standard', 'active'),
  ('b0000000-0000-4000-8000-000000000001', 'Lakeview Property Group', 'mini',     'active');

insert into public.users (id, org_id, email, full_name, role) values
  ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000001', 'alice@northside.test', 'Alice Nguyen', 'owner'),
  ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', 'mike@northside.test',  'Mike Ortiz',   'manager'),
  ('b0000000-0000-4000-8000-000000000010', 'b0000000-0000-4000-8000-000000000001', 'bob@lakeview.test',    'Bob Tran',     'owner');

insert into public.subscriptions (org_id, plan, status) values
  ('a0000000-0000-4000-8000-000000000001', 'standard', 'active'),
  ('b0000000-0000-4000-8000-000000000001', 'mini',     'active');

-- ===========================================================================
-- Properties and units
-- ===========================================================================
insert into public.properties (id, org_id, name, address) values
  ('a0000000-0000-4000-8000-000000000100', 'a0000000-0000-4000-8000-000000000001', 'Cedar Court',    '1420 Cedar St, Austin, TX'),
  ('b0000000-0000-4000-8000-000000000100', 'b0000000-0000-4000-8000-000000000001', 'Lakeview Flats', '88 Lake Rd, Austin, TX');

insert into public.units (id, org_id, property_id, code, area, base_rent_cents) values
  ('a0000000-0000-4000-8000-000000000101', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000100', '101', 55.00, 120000),
  ('a0000000-0000-4000-8000-000000000102', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000100', '102', 48.00, 105000),
  ('a0000000-0000-4000-8000-000000000103', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000100', '103', 45.00,  98000),
  ('b0000000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000100', 'A1',  62.00, 140000),
  ('b0000000-0000-4000-8000-000000000102', 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000100', 'A2',  60.00, 135000);

-- ===========================================================================
-- Residents. Nina has no portal_user_id — she is billed like everyone else.
-- ===========================================================================
insert into public.tenants (id, org_id, full_name, phone, email, portal_user_id) values
  ('a0000000-0000-4000-8000-000000000030', 'a0000000-0000-4000-8000-000000000001', 'Dana Whitfield', '+1-512-555-0130', 'dana@resident.test', 'a0000000-0000-4000-8000-000000000020'),
  ('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000001', 'Ray Coleman',    '+1-512-555-0131', 'ray@resident.test',  'a0000000-0000-4000-8000-000000000021'),
  ('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000001', 'Nina Alvarez',   '+1-512-555-0132', 'nina@resident.test', null),
  ('b0000000-0000-4000-8000-000000000030', 'b0000000-0000-4000-8000-000000000001', 'Sam Porter',     '+1-512-555-0230', 'sam@resident.test',  'b0000000-0000-4000-8000-000000000020');

-- Unit occupancy is set by the trigger in migration 0900, not written here.
insert into public.leases (id, org_id, unit_id, tenant_id, start_date, end_date, rent_cents, deposit_cents, billing_day) values
  ('a0000000-0000-4000-8000-000000000040', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000101', 'a0000000-0000-4000-8000-000000000030', '2026-01-01', '2026-12-31', 120000, 120000, 5),
  ('a0000000-0000-4000-8000-000000000041', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000102', 'a0000000-0000-4000-8000-000000000031', '2026-03-01', '2026-09-30', 105000, 105000, 5),
  ('a0000000-0000-4000-8000-000000000042', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000103', 'a0000000-0000-4000-8000-000000000032', '2026-02-15', null,       98000,  98000, 5),
  ('b0000000-0000-4000-8000-000000000040', 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-000000000030', '2026-01-01', '2026-12-31', 140000, 140000, 5);

-- ===========================================================================
-- Tariffs
-- ===========================================================================
insert into public.tariffs (org_id, electric_rate_per_kwh, water_rate_per_unit, service_fee_cents, effective_from) values
  ('a0000000-0000-4000-8000-000000000001', 0.1400, 0.0120, 2500, '2026-01-01'),
  ('b0000000-0000-4000-8000-000000000001', 0.1650, 0.0150, 1500, '2026-01-01');

-- ===========================================================================
-- Meter readings
-- ===========================================================================
insert into public.meter_readings (org_id, unit_id, period, electric_prev, electric_curr, water_prev, water_curr) values
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000101', '2026-07', 1420, 2047, 3100, 3450),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000102', '2026-07',  980, 1310, 2200, 2390),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000103', '2026-07',  500,  790, 1500, 1660),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000101', '2026-08', 2047, 2610, 3450, 3760),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000102', '2026-08', 1310, 1655, 2390, 2585),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000103', '2026-08',  790, 1050, 1660, 1830),
  ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000101', '2026-07',  800, 1150,  900, 1080);

-- ===========================================================================
-- Invoices. breakdown carries the arithmetic (AC4.3); this is the shape the
-- bulk-issue flow in Batch 1B must produce.
-- ===========================================================================
insert into public.invoices (id, org_id, lease_id, period, rent_cents, electric_cents, water_cents, service_cents, due_date, issued_at, breakdown) values
  ('a0000000-0000-4000-8000-000000000050', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000040', '2026-07', 120000, 8778, 420, 2500, '2026-08-05', '2026-08-01 09:00+00',
   '[{"kind":"rent","label":"Rent","amount_cents":120000},
     {"kind":"electric","label":"Electricity","prev":1420,"curr":2047,"consumption":627,"unit":"kWh","rate":0.14,"amount_cents":8778},
     {"kind":"water","label":"Water","prev":3100,"curr":3450,"consumption":350,"unit":"gal","rate":0.012,"amount_cents":420},
     {"kind":"service","label":"Service fee","amount_cents":2500}]'::jsonb),
  ('a0000000-0000-4000-8000-000000000051', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000041', '2026-07', 105000, 4620, 228, 2500, '2026-08-05', '2026-08-01 09:00+00',
   '[{"kind":"rent","label":"Rent","amount_cents":105000},
     {"kind":"electric","label":"Electricity","prev":980,"curr":1310,"consumption":330,"unit":"kWh","rate":0.14,"amount_cents":4620},
     {"kind":"water","label":"Water","prev":2200,"curr":2390,"consumption":190,"unit":"gal","rate":0.012,"amount_cents":228},
     {"kind":"service","label":"Service fee","amount_cents":2500}]'::jsonb),
  ('a0000000-0000-4000-8000-000000000052', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000042', '2026-07',  98000, 4060, 192, 2500, '2026-08-05', '2026-08-01 09:00+00',
   '[{"kind":"rent","label":"Rent","amount_cents":98000},
     {"kind":"electric","label":"Electricity","prev":500,"curr":790,"consumption":290,"unit":"kWh","rate":0.14,"amount_cents":4060},
     {"kind":"water","label":"Water","prev":1500,"curr":1660,"consumption":160,"unit":"gal","rate":0.012,"amount_cents":192},
     {"kind":"service","label":"Service fee","amount_cents":2500}]'::jsonb),
  -- Current period, not yet due: exercises 'sent'. Units 102 and 103 are left
  -- uninvoiced for 2026-08 so the bulk-issue flow has real work to do.
  ('a0000000-0000-4000-8000-000000000053', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000040', '2026-08', 120000, 7882, 372, 2500, '2026-09-05', '2026-08-20 09:00+00',
   '[{"kind":"rent","label":"Rent","amount_cents":120000},
     {"kind":"electric","label":"Electricity","prev":2047,"curr":2610,"consumption":563,"unit":"kWh","rate":0.14,"amount_cents":7882},
     {"kind":"water","label":"Water","prev":3450,"curr":3760,"consumption":310,"unit":"gal","rate":0.012,"amount_cents":372},
     {"kind":"service","label":"Service fee","amount_cents":2500}]'::jsonb),
  ('b0000000-0000-4000-8000-000000000050', 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000040', '2026-07', 140000, 5775, 270, 1500, '2026-08-05', '2026-08-01 09:00+00',
   '[{"kind":"rent","label":"Rent","amount_cents":140000},
     {"kind":"electric","label":"Electricity","prev":800,"curr":1150,"consumption":350,"unit":"kWh","rate":0.165,"amount_cents":5775},
     {"kind":"water","label":"Water","prev":900,"curr":1080,"consumption":180,"unit":"gal","rate":0.015,"amount_cents":270},
     {"kind":"service","label":"Service fee","amount_cents":1500}]'::jsonb);

-- ===========================================================================
-- Payments. Dana settled in full → 'paid'. Ray paid part of it and is past due
-- → 'overdue', which is the case that proves overdue outranks partial. Nina
-- paid nothing → 'overdue'.
-- ===========================================================================
insert into public.payments (org_id, invoice_id, amount_cents, paid_at, method, note, recorded_by) values
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000050', 131698, '2026-08-03 14:00+00', 'bank_transfer', 'Paid in full',       'a0000000-0000-4000-8000-000000000011'),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000051',  50000, '2026-08-04 10:00+00', 'cash',          'Partial, rest later','a0000000-0000-4000-8000-000000000011'),
  ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000050', 147545, '2026-08-02 11:00+00', 'bank_transfer', null,                 'b0000000-0000-4000-8000-000000000010');

-- ===========================================================================
-- Maintenance requests
-- ===========================================================================
insert into public.maintenance_requests (id, org_id, unit_id, tenant_id, title, description, status) values
  ('a0000000-0000-4000-8000-000000000060', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000101', 'a0000000-0000-4000-8000-000000000030', 'Kitchen faucet is leaking', 'Drips steadily even when closed.', 'submitted'),
  ('a0000000-0000-4000-8000-000000000061', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000102', 'a0000000-0000-4000-8000-000000000031', 'Bedroom window will not latch', 'Latch spins without catching.',  'in_progress'),
  ('b0000000-0000-4000-8000-000000000060', 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-000000000030', 'AC making a rattling noise',    null,                             'submitted');

-- ===========================================================================
-- The demo organization (D23) — skeleton only
--
-- What is here: the organization, its two operators, and a subscription that
-- can never expire. What is NOT here: properties, units, residents, leases,
-- readings, invoices, payments, maintenance. Those depend on TODAY'S date —
-- all four invoice statuses have to be visible on every day of the year — so
-- they cannot be written as static SQL without going stale within a week.
--
-- They are built instead by app/api/cron/demo-reset from a pure function of
-- the anchor day, which is the same code the nightly reset runs. Two copies of
-- a dataset drift; one copy cannot. Fill the demo after a reset with:
--
--   pnpm demo:reset
--
-- D23 constraint 2 is set here and re-asserted on every reset: an ACTIVE
-- subscription on the top plan, ending in 2099. A public demo that locks
-- itself behind an expired trial overnight is worse than no demo.
-- ===========================================================================
insert into public.organizations (id, name, plan, status) values
  ('d0000000-0000-4000-8000-000000000001', 'Riverbend Residential (demo)', 'pro', 'active');

insert into public.users (id, org_id, email, full_name, role) values
  ('d0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000001', 'demo-owner@example.com',   'Dana Rivera (demo owner)',   'owner'),
  ('d0000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000001', 'demo-manager@example.com', 'Marco Ellis (demo manager)', 'manager');

insert into public.subscriptions (org_id, plan, status, period_end) values
  ('d0000000-0000-4000-8000-000000000001', 'pro', 'active', '2099-12-31 00:00+00');

-- ===========================================================================
-- The product back office (D11 / D12)
--
-- super_admins has no INSERT policy, so this INSERT — running as the seed's
-- superuser connection, not through the API — is the only kind of statement
-- that can create a member. That is the point of the design: no account can
-- promote itself, and there is no code path in the application that grants it.
--
-- This account belongs to no organization and has no tenant record, so it is
-- neither an operator nor a resident: it fails every layer-1 and layer-2
-- policy by construction and can read exactly two things, the organization
-- list and the subscription list.
-- ===========================================================================
insert into public.super_admins (user_id, note) values
  ('e0000000-0000-4000-8000-000000000001', 'Local fixture — the e2e suite signs in as this account.');
