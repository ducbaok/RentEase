-- RentEase · 0500 · Operations: maintenance, reminder log, audit log, billing plan
-- Requirements: F6, F8, AC5.2, AC-S1 (docs/sot/10-requirements.md)

create table public.maintenance_requests (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  unit_id     uuid not null,
  tenant_id   uuid not null,
  title       text not null check (length(trim(title)) > 0),
  description text,
  -- Storage object paths, always '{org_id}/{request_id}/{filename}'. The
  -- storage policies in 0800 depend on that shape.
  photos      text[] not null default '{}',
  status      public.maintenance_status not null default 'submitted',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (unit_id, org_id) references public.units (id, org_id) on delete cascade,
  foreign key (tenant_id, org_id) references public.tenants (id, org_id) on delete cascade
);

create index maintenance_requests_org_status_idx on public.maintenance_requests (org_id, status);
create index maintenance_requests_tenant_id_idx on public.maintenance_requests (tenant_id);

create trigger maintenance_requests_set_updated_at
  before update on public.maintenance_requests
  for each row execute function public.set_updated_at();

-- AC6.2: idempotency of the daily reminder job lives here, not in job code.
-- UNIQUE (invoice_id, kind) means a re-run inserts nothing the second time, so
-- "the job ran twice" and "the job ran once" are indistinguishable to residents.
create table public.reminder_logs (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null,
  kind       public.reminder_kind not null,
  channel    text not null default 'email',
  recipient  text,
  sent_at    timestamptz not null default now(),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade,
  unique (invoice_id, kind)
);

create index reminder_logs_org_id_idx on public.reminder_logs (org_id);

-- AC5.2: every correction to money after issuing is recorded here. The table is
-- append-only by construction — 0700 grants INSERT and SELECT but no UPDATE or
-- DELETE policy, so not even an owner can quietly rewrite history.
create table public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  actor_id   uuid references auth.users (id) on delete set null,
  entity     text not null,
  entity_id  uuid not null,
  action     text not null,
  old_value  jsonb,
  new_value  jsonb,
  reason     text,
  created_at timestamptz not null default now()
);

create index audit_logs_org_created_idx on public.audit_logs (org_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id);

-- One subscription per organization. Readable by owners only (0700) — a manager
-- runs the buildings, not the billing relationship.
create table public.subscriptions (
  org_id             uuid primary key references public.organizations (id) on delete cascade,
  stripe_customer_id text unique,
  stripe_sub_id      text unique,
  plan               public.org_plan not null default 'mini',
  status             text not null default 'trialing',
  period_end         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();
