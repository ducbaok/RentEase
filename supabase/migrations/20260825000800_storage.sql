-- RentEase · 0800 · Storage bucket for maintenance photos (F8, AC8.2)
--
-- Object paths are always '{org_id}/{request_id}/{filename}'. The policies read
-- that structure directly, so an object's location IS its permission — there is
-- no separate table to fall out of sync.
--
-- Upload order matters: the maintenance_requests row must exist before its
-- photos are uploaded, because the resident's insert policy checks that folder
-- two names a request they own.

insert into storage.buckets (id, name, public)
values ('maintenance-photos', 'maintenance-photos', false)
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- Operators: full access within their own organization's folder.
-- --------------------------------------------------------------------------
create policy maintenance_photos_operator_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'maintenance-photos'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  )
  with check (
    bucket_id = 'maintenance-photos'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  );

-- --------------------------------------------------------------------------
-- Residents: only folders belonging to their own requests. Note the second
-- path segment check — without it a resident could read every photo in the
-- organization, which is exactly the unit-201-sees-unit-202 failure.
-- --------------------------------------------------------------------------
create policy maintenance_photos_tenant_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'maintenance-photos'
    and (storage.foldername(name))[1] = (select public.current_tenant_org_id())::text
    and (storage.foldername(name))[2] in
        (select id::text from public.maintenance_requests
         where id in (select public.current_tenant_maintenance_ids()))
  );

create policy maintenance_photos_tenant_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'maintenance-photos'
    and (storage.foldername(name))[1] = (select public.current_tenant_org_id())::text
    and (storage.foldername(name))[2] in
        (select id::text from public.maintenance_requests
         where id in (select public.current_tenant_maintenance_ids()))
  );
