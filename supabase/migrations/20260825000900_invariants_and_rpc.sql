-- RentEase · 0900 · Business invariants enforced in the database, plus signup RPC
--
-- What lives here is everything that must stay true no matter which code path
-- writes the row: invoice arithmetic, invoice status, unit occupancy. Putting
-- these in the application would make them true only for the paths that
-- remembered to call them.

-- ===========================================================================
-- Invoice status rule — the single authoritative definition.
--
-- MIRROR WARNING: lib/domain/invoice-status.ts reproduces this exact rule for
-- previewing state in the UI before a write. If you change one, change the
-- other and re-run both tests/unit/invoice-status.test.ts and the
-- compute_invoice_status assertions in supabase/tests/billing.test.sql.
--
-- 'overdue' deliberately outranks 'partial': someone who paid half and is past
-- the due date still owes money, and the collections view must show them.
-- How much they paid is never lost — paid_cents carries it.
-- ===========================================================================
create or replace function public.compute_invoice_status(
  p_issued_at timestamptz,
  p_total_cents integer,
  p_paid_cents integer,
  p_due_date date,
  p_as_of date default current_date
)
returns public.invoice_status
language sql
immutable
as $$
  select case
    when p_issued_at is null                then 'draft'::public.invoice_status
    when p_paid_cents >= p_total_cents      then 'paid'::public.invoice_status
    when p_as_of > p_due_date               then 'overdue'::public.invoice_status
    when p_paid_cents > 0                   then 'partial'::public.invoice_status
    else                                         'sent'::public.invoice_status
  end;
$$;

-- Recomputes the two derived money columns and the status on every write.
create or replace function public.invoices_before_write()
returns trigger
language plpgsql
as $$
begin
  new.total_cents := new.rent_cents + new.electric_cents + new.water_cents
                     + new.service_cents + new.other_cents;
  new.status := public.compute_invoice_status(
    new.issued_at, new.total_cents, new.paid_cents, new.due_date, current_date
  );
  return new;
end;
$$;

create trigger invoices_derive_totals
  before insert or update on public.invoices
  for each row execute function public.invoices_before_write();

-- ===========================================================================
-- AC5.1 — payments drive invoice state.
-- paid_cents is recomputed by summing the payments, never by adding a delta,
-- so an edited or deleted payment can never leave a stale balance behind.
-- ===========================================================================
create or replace function public.recalc_invoice_paid(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.invoices i
  set paid_cents = coalesce(
        (select sum(p.amount_cents) from public.payments p where p.invoice_id = i.id), 0)
  where i.id = p_invoice_id;
end;
$$;

create or replace function public.payments_after_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalc_invoice_paid(old.invoice_id);
  else
    perform public.recalc_invoice_paid(new.invoice_id);
    if tg_op = 'UPDATE' and old.invoice_id is distinct from new.invoice_id then
      perform public.recalc_invoice_paid(old.invoice_id);
    end if;
  end if;
  return null;
end;
$$;

create trigger payments_recalc_invoice
  after insert or update or delete on public.payments
  for each row execute function public.payments_after_change();

-- ===========================================================================
-- AC6.3 — the daily job calls this to move newly-late invoices to 'overdue'.
-- The status rule itself is date-dependent, so something has to re-evaluate it
-- when the date changes; this is that something. It is idempotent: running it
-- twice in a day changes nothing the second time.
-- ===========================================================================
create or replace function public.refresh_overdue_invoices(p_as_of date default current_date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with updated as (
    update public.invoices i
    set status = public.compute_invoice_status(
          i.issued_at, i.total_cents, i.paid_cents, i.due_date, p_as_of)
    where i.status is distinct from public.compute_invoice_status(
          i.issued_at, i.total_cents, i.paid_cents, i.due_date, p_as_of)
    returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

revoke all on function public.refresh_overdue_invoices(date) from public, anon, authenticated;
grant execute on function public.refresh_overdue_invoices(date) to service_role;

-- ===========================================================================
-- AC2.2 — occupancy follows the leases, always.
-- Occupancy feeds the dashboard number a landlord checks first, so it is
-- derived from the lease table rather than being a flag someone must remember
-- to flip.
-- ===========================================================================
create or replace function public.sync_unit_status_for(p_unit_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.units u
  set status = case
        when exists (
          select 1 from public.leases l
          where l.unit_id = u.id
            and l.status = 'active'
            and l.start_date <= current_date
            and (l.end_date is null or l.end_date >= current_date)
        ) then 'occupied'::public.unit_status
        else 'vacant'::public.unit_status
      end
  where u.id = p_unit_id;
end;
$$;

create or replace function public.leases_after_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_unit_status_for(old.unit_id);
  else
    perform public.sync_unit_status_for(new.unit_id);
    if tg_op = 'UPDATE' and old.unit_id is distinct from new.unit_id then
      perform public.sync_unit_status_for(old.unit_id);
    end if;
  end if;
  return null;
end;
$$;

create trigger leases_sync_unit_status
  after insert or update or delete on public.leases
  for each row execute function public.leases_after_change();

-- ===========================================================================
-- Signup. Creating an organization and its first owner must be atomic: a user
-- with no org row has no identity under RLS and would be stranded. It also
-- cannot be done under RLS — at that moment current_org_id() is still NULL —
-- so it runs as SECURITY DEFINER with its own explicit guards.
-- ===========================================================================
create or replace function public.create_organization_and_owner(
  p_org_name text,
  p_full_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_org   uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if coalesce(trim(p_org_name), '') = '' then
    raise exception 'organization name is required' using errcode = '22023';
  end if;

  -- One account belongs to one organization in the MVP. Silently creating a
  -- second one would strand the first.
  if exists (select 1 from public.users where id = v_uid) then
    raise exception 'this account already belongs to an organization'
      using errcode = '23505';
  end if;

  -- A resident portal account must never be able to become an operator.
  if exists (select 1 from public.tenants where portal_user_id = v_uid) then
    raise exception 'resident accounts cannot create an organization'
      using errcode = '42501';
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.organizations (name)
  values (trim(p_org_name))
  returning id into v_org;

  insert into public.users (id, org_id, email, full_name, role)
  values (v_uid, v_org, coalesce(v_email, ''), nullif(trim(coalesce(p_full_name, '')), ''), 'owner');

  insert into public.subscriptions (org_id, plan, status)
  values (v_org, 'mini', 'trialing');

  return v_org;
end;
$$;

revoke all on function public.create_organization_and_owner(text, text) from public, anon;
grant execute on function public.create_organization_and_owner(text, text) to authenticated;
