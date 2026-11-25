-- Coho Drive: docket forms (25 Nov 2026)
-- Office, supervisors and admin create, clone and edit dockets from the paper/Jotform layouts.
-- A docket can be assigned to one or more drivers, who then see it on their phone.
-- Every save bumps a version number, so two devices cannot silently overwrite each other,
-- and dockets, loads and sign-offs are published to Supabase Realtime so open screens update.

-- ---------- new docket columns ----------
create sequence if not exists public.docket_no_seq start 100001;

alter table public.dockets
  add column if not exists form_type text,                                   -- which layout (see web/src/lib/docketForms.ts)
  add column if not exists docket_no bigint default nextval('public.docket_no_seq'),
  add column if not exists work_date date,
  add column if not exists truck_id uuid references public.trucks(id) on delete set null,
  add column if not exists assigned_person_ids uuid[] not null default '{}',   -- drivers who see this docket
  add column if not exists cloned_from uuid references public.dockets(id) on delete set null,
  add column if not exists version int not null default 1,
  add column if not exists updated_by uuid;

alter sequence public.docket_no_seq owned by public.dockets.docket_no;
grant usage, select on sequence public.docket_no_seq to authenticated, service_role;
update public.dockets set docket_no = nextval('public.docket_no_seq') where docket_no is null;
create unique index if not exists dockets_docket_no_key on public.dockets(docket_no);
create index if not exists dockets_assigned_idx on public.dockets using gin(assigned_person_ids);
create index if not exists dockets_work_date_idx on public.dockets(work_date);
create index if not exists dockets_truck_idx on public.dockets(truck_id);
create index if not exists dockets_cloned_from_idx on public.dockets(cloned_from);

alter table public.loads
  add column if not exists sort int,
  add column if not exists updated_at timestamptz default now();
create trigger t_loads_touch before update on public.loads for each row execute function public.touch_updated_at();

-- ---------- version check: refuse a save made from an out-of-date copy ----------
-- The app sends back the version it loaded. If someone else saved in between, the numbers differ
-- and the save is refused with a plain message. Updates that do not send a version (e.g. km matching) pass.
create or replace function public.docket_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.version is distinct from old.version then
    raise exception 'This docket was changed on another device after you opened it. Tap Reload to get the latest copy, then make your change again.'
      using errcode = '40001';
  end if;
  new.version := old.version + 1;
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists t_dockets_version on public.dockets;
create trigger t_dockets_version before update on public.dockets for each row execute function public.docket_version();

-- ---------- who am I (as a driver)? ----------
-- People on the signed-in work phone, plus a person linked directly to the login.
create or replace function public.my_person_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct pid), '{}'::uuid[]) from (
    select a.person_id as pid
    from public.phone_assignments a join public.work_phones w on w.id = a.work_phone_id
    where w.active is not false
      and public.norm_phone(w.phone) = public.norm_phone(coalesce(auth.jwt() ->> 'phone', ''))
    union
    select l.person_id
    from public.app_logins l
    where l.person_id is not null and l.active is not false and (
      (l.email is not null and lower(l.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
      or (l.phone is not null and public.norm_phone(l.phone) = public.norm_phone(coalesce(auth.jwt() ->> 'phone', ''))))
  ) x where pid is not null
$$;

-- Is this docket assigned to one of my people? (used by the loads and sign-off rules)
create or replace function public.docket_assigned_to_me(p_docket uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dockets d where d.id = p_docket and d.assigned_person_ids && public.my_person_ids())
$$;

revoke execute on function public.docket_version() from public, anon, authenticated;
revoke execute on function public.my_person_ids() from public, anon;
revoke execute on function public.docket_assigned_to_me(uuid) from public, anon;
grant execute on function public.my_person_ids() to authenticated;
grant execute on function public.docket_assigned_to_me(uuid) to authenticated;

-- ---------- row level security: assigned drivers can see and fill in the docket ----------
drop policy if exists dockets_read on public.dockets;
drop policy if exists dockets_update on public.dockets;
create policy dockets_read on public.dockets for select to authenticated using (
  (select public.can_read('all_work'))
  or ((created_by = (select auth.uid()) or assigned_person_ids && (select public.my_person_ids())) and (select public.can_read('dockets'))));
create policy dockets_update on public.dockets for update to authenticated using (
  (select public.can_edit('all_work'))
  or ((created_by = (select auth.uid()) or assigned_person_ids && (select public.my_person_ids())) and (select public.can_edit('dockets'))))
  with check ((select public.has_access()));

do $$
declare t text;
begin
  foreach t in array array['loads','signoffs'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.can_read(''all_work'')) or ((created_by = (select auth.uid()) or public.docket_assigned_to_me(docket_id)) and (select public.can_read(''dockets''))))', t || '_read', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.can_edit(''all_work'')) or ((created_by = (select auth.uid()) or public.docket_assigned_to_me(docket_id)) and (select public.can_edit(''dockets'')))) with check ((select public.has_access()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.can_edit(''all_work'')) or ((created_by = (select auth.uid()) or public.docket_assigned_to_me(docket_id)) and (select public.can_edit(''dockets''))))', t || '_delete', t);
  end loop;
end $$;

-- ---------- wording on the Settings screen ----------
update public.features
  set description = 'Read only: see everyone''s shifts, dockets and faults. Edit: change them, and create, clone and edit dockets for any crew.'
  where code = 'all_work';
update public.features
  set description = 'Customer dockets, loads and client sign-off (own records and dockets assigned to them).'
  where code = 'dockets';

-- ---------- live updates (Supabase Realtime) ----------
-- Realtime still applies row level security, so each device only hears about dockets it can see.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['dockets','loads','signoffs'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
