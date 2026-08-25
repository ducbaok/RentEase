-- RentEase · 0100 · Extensions, shared types, generic triggers
-- Design source of truth: docs/sot/30-data-model.md
--
-- Money is stored as INTEGER CENTS everywhere (never float). Consumption rates
-- are NUMERIC(12,4) in currency units because real utility tariffs carry four
-- decimals (e.g. $0.1425/kWh); a line total is round(consumption * rate * 100).

create extension if not exists btree_gist;  -- lease overlap exclusion constraint
create extension if not exists pgcrypto;    -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Enumerations. Each one mirrors a state list in docs/sot/30-data-model.md.
-- ---------------------------------------------------------------------------
create type public.user_role          as enum ('owner', 'manager');
create type public.org_plan           as enum ('mini', 'standard', 'pro');
create type public.org_status         as enum ('trialing', 'active', 'past_due', 'canceled');
create type public.unit_status        as enum ('vacant', 'occupied');
create type public.lease_status       as enum ('active', 'ended');
create type public.invoice_status     as enum ('draft', 'sent', 'partial', 'paid', 'overdue');
create type public.payment_method     as enum ('cash', 'bank_transfer');
create type public.maintenance_status as enum ('submitted', 'in_progress', 'done');
create type public.reminder_kind      as enum ('before_due', 'overdue_1', 'overdue_7');

-- Billing periods are 'YYYY-MM'. A domain enforces the shape on every column
-- that stores one, so a malformed period can never reach the uniqueness
-- constraints that protect against duplicate invoices (AC4.1).
create domain public.billing_period as text
  check (value ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
