-- RentEase · 0300 · Asset tree: properties → units → leases, and tenants
-- Requirements: F1, F2 (docs/sot/10-requirements.md)

create table public.properties (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  address    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target for the composite FK from units. Redundant with the PK on its own,
  -- but required so children can prove they share the parent's organization.
  unique (id, org_id)
);

create index properties_org_id_idx on public.properties (org_id);

create trigger properties_set_updated_at
  before update on public.properties
  for each row execute function public.set_updated_at();

-- AC1.2: a unit code is unique within its property.
create table public.units (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  property_id     uuid not null,
  code            text not null check (length(trim(code)) > 0),
  area            numeric(10, 2) check (area is null or area > 0),
  base_rent_cents integer not null default 0 check (base_rent_cents >= 0),
  status          public.unit_status not null default 'vacant',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (property_id, org_id)
    references public.properties (id, org_id) on delete cascade,
  unique (property_id, code),
  unique (id, org_id)
);

create index units_org_id_idx on public.units (org_id);
create index units_property_id_idx on public.units (property_id);

create trigger units_set_updated_at
  before update on public.units
  for each row execute function public.set_updated_at();

-- Residents. portal_user_id links to Supabase Auth once the tenant accepts the
-- magic-link invite (F7); it stays NULL until then, so a tenant record can be
-- created and billed before the portal is ever opened.
create table public.tenants (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  full_name      text not null check (length(trim(full_name)) > 0),
  phone          text,
  email          text,
  portal_user_id uuid unique references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, org_id)
);

create index tenants_org_id_idx on public.tenants (org_id);
create index tenants_portal_user_id_idx on public.tenants (portal_user_id);

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

-- AC2.1: two active leases can never overlap on the same unit. The EXCLUDE
-- constraint enforces it in the database, so a double-submit, a race between
-- two managers, or a direct API call all fail identically. NULL end_date means
-- open-ended, which daterange treats as unbounded.
create table public.leases (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  unit_id        uuid not null,
  tenant_id      uuid not null,
  start_date     date not null,
  end_date       date,
  rent_cents     integer not null check (rent_cents >= 0),
  deposit_cents  integer not null default 0 check (deposit_cents >= 0),
  -- Capped at 28 so a billing day exists in every month, February included.
  billing_day    smallint not null default 1 check (billing_day between 1 and 28),
  status         public.lease_status not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (unit_id, org_id) references public.units (id, org_id) on delete cascade,
  foreign key (tenant_id, org_id) references public.tenants (id, org_id) on delete restrict,
  check (end_date is null or end_date >= start_date),
  unique (id, org_id),
  exclude using gist (
    unit_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status = 'active')
);

create index leases_org_id_idx on public.leases (org_id);
create index leases_unit_id_idx on public.leases (unit_id);
create index leases_tenant_id_idx on public.leases (tenant_id);
create index leases_active_end_date_idx on public.leases (end_date) where status = 'active';

create trigger leases_set_updated_at
  before update on public.leases
  for each row execute function public.set_updated_at();
