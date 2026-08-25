-- RentEase · 0400 · The money: tariffs, meter readings, invoices, payments
-- Requirements: F3, F4, F5 (docs/sot/10-requirements.md)

-- Rates are time-versioned: billing a period picks the newest row with
-- effective_from <= the period's billing date. Changing a rate today therefore
-- never rewrites last month's arithmetic.
create table public.tariffs (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations (id) on delete cascade,
  electric_rate_per_kwh  numeric(12, 4) not null check (electric_rate_per_kwh >= 0),
  water_rate_per_unit    numeric(12, 4) not null check (water_rate_per_unit >= 0),
  service_fee_cents      integer not null default 0 check (service_fee_cents >= 0),
  effective_from         date not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (org_id, effective_from)
);

create index tariffs_org_effective_idx on public.tariffs (org_id, effective_from desc);

create trigger tariffs_set_updated_at
  before update on public.tariffs
  for each row execute function public.set_updated_at();

-- AC3.3: one reading row per (unit, period). Re-entering a period edits that
-- row (and writes an audit_logs entry) rather than creating a second one.
--
-- There is deliberately NO check that curr >= prev: meters roll over and get
-- replaced, so AC3.1 requires a confirmation, not a prohibition. The fact is
-- recorded in `flags` plus `override_reason` instead of being silently lost.
create table public.meter_readings (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  unit_id         uuid not null,
  period          public.billing_period not null,
  electric_prev   numeric(12, 2) not null default 0 check (electric_prev >= 0),
  electric_curr   numeric(12, 2) not null check (electric_curr >= 0),
  water_prev      numeric(12, 2) not null default 0 check (water_prev >= 0),
  water_curr      numeric(12, 2) not null check (water_curr >= 0),
  -- e.g. {'electric_decreased','electric_spike','water_decreased','water_spike'}
  flags           text[] not null default '{}',
  override_reason text,
  recorded_by     uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (unit_id, org_id) references public.units (id, org_id) on delete cascade,
  unique (unit_id, period)
);

create index meter_readings_org_period_idx on public.meter_readings (org_id, period);

create trigger meter_readings_set_updated_at
  before update on public.meter_readings
  for each row execute function public.set_updated_at();

-- AC4.1: UNIQUE (lease_id, period) is the real defence against double issuing.
-- Clicking twice, a retried request, or a direct API call all collide here.
--
-- total_cents, paid_cents and status are all DERIVED, never written by hand:
-- migration 0900 installs a BEFORE trigger that recomputes them on every write,
-- including writes that bypass the application. The total therefore cannot
-- drift from its parts, and the status cannot drift from the payments — two
-- whole classes of "the invoice doesn't add up" bug removed at the source.
--
-- breakdown (AC4.3) snapshots the arithmetic at issue time — meter numbers and
-- the rates applied — so an invoice explains itself forever, even after the
-- tariff changes.
create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  lease_id       uuid not null,
  period         public.billing_period not null,
  rent_cents     integer not null default 0 check (rent_cents >= 0),
  electric_cents integer not null default 0 check (electric_cents >= 0),
  water_cents    integer not null default 0 check (water_cents >= 0),
  service_cents  integer not null default 0 check (service_cents >= 0),
  other_cents    integer not null default 0 check (other_cents >= 0),
  total_cents    integer not null default 0 check (total_cents >= 0),
  paid_cents     integer not null default 0 check (paid_cents >= 0),
  breakdown      jsonb not null default '[]'::jsonb,
  due_date       date not null,
  status         public.invoice_status not null default 'draft',
  issued_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (lease_id, org_id) references public.leases (id, org_id) on delete cascade,
  unique (lease_id, period),
  unique (id, org_id)
);

create index invoices_org_period_idx on public.invoices (org_id, period);
create index invoices_lease_id_idx on public.invoices (lease_id);
create index invoices_due_status_idx on public.invoices (due_date, status);

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

-- Many payments per invoice (F5). Amounts are strictly positive; a mistaken
-- payment is deleted, and the deletion is what audit_logs records. Allowing
-- negative rows would make "how much was actually received" ambiguous.
create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  invoice_id    uuid not null,
  amount_cents  integer not null check (amount_cents > 0),
  paid_at       timestamptz not null default now(),
  method        public.payment_method not null,
  note          text,
  recorded_by   uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade
);

create index payments_org_id_idx on public.payments (org_id);
create index payments_invoice_id_idx on public.payments (invoice_id);
