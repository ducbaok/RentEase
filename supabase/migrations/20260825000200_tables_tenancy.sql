-- RentEase · 0200 · Tenancy root: organizations and operator users
--
-- Every business table below carries org_id NOT NULL. Child tables additionally
-- reference their parent through a COMPOSITE foreign key (parent_id, org_id),
-- which makes it structurally impossible to stitch a row of one organization
-- onto a parent of another — even if application code has a bug. That is the
-- "barrier at the deepest layer" the brief asks for, sitting underneath RLS.

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  plan       public.org_plan not null default 'mini',
  status     public.org_status not null default 'trialing',
  currency   text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- Operator accounts (owner / manager). Tenants are NOT in this table — they
-- live in public.tenants and are linked to auth.users via portal_user_id.
-- Membership here is what makes someone an operator, and it is what
-- public.current_org_id() reads.
create table public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  org_id     uuid not null references public.organizations (id) on delete cascade,
  email      text not null,
  full_name  text,
  role       public.user_role not null default 'manager',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_org_id_idx on public.users (org_id);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- The product operator's own back office (the `super` role in the spec).
-- Membership is granted only by direct SQL or the service role — there is no
-- policy that permits INSERT, so no account can promote itself.
create table public.super_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
