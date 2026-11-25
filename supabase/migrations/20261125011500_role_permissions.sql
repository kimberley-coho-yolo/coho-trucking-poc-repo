-- Roles and access settings: admins can create roles and choose hidden / read only / edit
-- for every function in the app, per role. The database enforces the same settings (row level security),
-- so hiding something on screen is backed by the server refusing it too.

-- ---------- roles ----------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  label text not null,
  description text,
  rank int not null default 50,          -- if a person has several logins, the lowest rank wins
  is_system boolean not null default false,
  active boolean not null default true,
  created_at timestamptz default now(),
  created_by uuid default auth.uid()
);
insert into public.roles(code, label, description, rank, is_system) values
  ('admin', 'Admin', 'Full access, including settings, logins and integrations. Cannot be restricted.', 1, true),
  ('office', 'Office', 'Sets up people, trucks, customers and jobs; uploads and downloads data.', 20, true),
  ('supervisor', 'Supervisor', 'Sees all crews'' work, approves timesheets, views reports.', 30, true),
  ('driver', 'Driver', 'The basics: shifts, prestart, dockets, faults and their own drafts.', 90, true);

-- logins now pick from the roles list
alter table public.app_logins drop constraint if exists app_logins_role_check;
alter table public.app_logins add constraint app_logins_role_fk foreign key (role) references public.roles(code) on update cascade on delete restrict;

-- system roles keep their code; admin cannot be retired
create or replace function public.protect_roles() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then raise exception 'Built-in roles cannot be deleted. You can rename them instead.'; end if;
    return old;
  end if;
  if old.is_system and new.code <> old.code then raise exception 'Built-in role codes cannot change. Change the name instead.'; end if;
  if old.code = 'admin' and (new.active is false or new.rank <> old.rank) then raise exception 'The admin role must stay active and first.'; end if;
  new.is_system := old.is_system;
  return new;
end $$;
create trigger t_roles_protect before update or delete on public.roles for each row execute function public.protect_roles();

-- ---------- functions (features) ----------
create table public.features (
  code text primary key,
  label text not null,
  grp text not null,
  description text,
  max_level text not null default 'edit' check (max_level in ('read','edit')),  -- 'read' = nothing to edit
  admin_only_edit boolean not null default false,                                 -- only admin can ever edit
  sort int not null default 100
);
insert into public.features(code, label, grp, description, max_level, admin_only_edit, sort) values
  ('shifts','Shifts, prestart and end of shift','Driver','Start a shift, prestart check and the end-of-shift timesheet (own records).','edit',false,10),
  ('dockets','Dockets, loads and sign-offs','Driver','Customer dockets, loads and client sign-off (own records).','edit',false,20),
  ('faults','Fault reports','Driver','Report a truck or equipment fault (own records).','edit',false,30),
  ('drafts','My drafts','Driver','List of unfinished work to carry on.','read',false,40),
  ('all_work','All crews'' shifts and dockets','Supervision','Read only: see everyone''s shifts, dockets and faults. Edit: change them too.','edit',false,50),
  ('approvals','Timesheet approvals','Supervision','Read only: see timesheets waiting. Edit: approve or query them.','edit',false,60),
  ('reports','Reports','Supervision','Hours and km per customer, rig, truck and travel.','read',false,70),
  ('people','People, work phones and phone sharing','Admin lists','Who can be picked as a driver, crew phones and who uses which phone.','edit',false,80),
  ('fleet','Trucks, trailers and equipment','Admin lists','Truck and trailer lists, QR codes, tracker and Gearbox IDs.','edit',false,90),
  ('customers','Customers, rigs and locations','Admin lists','Customer and location lists.','edit',false,100),
  ('planning','Jobs and allocations','Admin lists','Customer jobs and which truck does which job each day.','edit',false,110),
  ('data_transfer','Upload and download spreadsheets','Data','Read only: download and browse tables. Edit: upload spreadsheets too.','edit',false,120),
  ('integration_data','GPS trips, prestart records and km matching','Data','Integration stand-in data. Edit: upload and run km matching.','edit',false,130),
  ('query','Query console (SQL)','Data','Read-only SQL queries. Results still respect these access settings.','read',false,140),
  ('integrations','Integrations','Admin only','The list of systems to connect and their settings. Only admin can add or edit.','edit',true,150),
  ('logins','Logins and roles','Admin only','Who can sign in (email or mobile) and which role they have. Only admin can edit.','edit',true,160),
  ('settings','Settings: roles and access','Admin only','This screen. Only admin can change it.','edit',true,170),
  ('audit','Audit log and text message log','Admin only','History of changes and sign-in texts.','read',false,180),
  ('help','Help','General','How-to pages.','read',false,190);

-- ---------- role permissions ----------
create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role text not null references public.roles(code) on update cascade on delete cascade,
  feature text not null references public.features(code) on update cascade on delete cascade,
  access text not null default 'hidden' check (access in ('hidden','read','edit')),
  updated_at timestamptz default now(),
  created_by uuid default auth.uid(),
  unique (role, feature)
);
create trigger t_role_permissions_touch before update on public.role_permissions for each row execute function public.touch_updated_at();

-- defaults that match how the app behaved before this change
insert into public.role_permissions(role, feature, access)
select r.code, f.code, case
  when r.code = 'admin' then f.max_level
  when f.code in ('shifts','dockets','faults') then 'edit'
  when f.code in ('drafts','help') then 'read'
  when r.code = 'driver' then 'hidden'
  -- supervisor and office
  when f.code in ('all_work','approvals') then 'edit'
  when f.code in ('reports') then 'read'
  when f.code = 'integration_data' then case when r.code = 'office' then 'edit' else 'read' end
  when r.code = 'office' and f.code in ('people','fleet','customers','planning','data_transfer') then 'edit'
  when r.code = 'office' and f.code in ('query','integrations') then 'read'
  else 'hidden' end
from public.roles r cross join public.features f;

-- ---------- access checks ----------
-- Role of the signed-in user: lowest rank among their active logins with an active role.
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select l.role
  from public.app_logins l join public.roles r on r.code = l.role and r.active
  where l.active is not false
    and (
      (l.email is not null and lower(l.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
      or (l.phone is not null and public.norm_phone(l.phone) = public.norm_phone(coalesce(auth.jwt() ->> 'phone', '')))
    )
  order by r.rank, l.role
  limit 1
$$;

-- 'hidden', 'read' or 'edit' for the signed-in user. Admin always gets the most a function allows.
create or replace function public.access_for(p_role text, p_feature text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_role is null or f.code is null then 'hidden'
    when p_role = 'admin' then f.max_level
    else coalesce((select case when rp.access = 'edit' and (f.admin_only_edit or f.max_level = 'read') then 'read' else rp.access end
                   from public.role_permissions rp where rp.role = p_role and rp.feature = f.code), 'hidden')
  end
  from (select 1) one left join public.features f on f.code = p_feature
$$;
create or replace function public.access(p_feature text) returns text
language sql stable security definer set search_path = public as $$ select public.access_for(public.app_role(), p_feature) $$;
create or replace function public.can_read(p_feature text) returns boolean
language sql stable security definer set search_path = public as $$ select public.access(p_feature) in ('read','edit') $$;
create or replace function public.can_edit(p_feature text) returns boolean
language sql stable security definer set search_path = public as $$ select public.access(p_feature) = 'edit' $$;
-- Everything the app needs at sign-in: { "dockets": "edit", "reports": "hidden", ... }
create or replace function public.my_permissions() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(f.code, public.access_for(r.role, f.code)), '{}'::jsonb)
  from public.features f cross join (select public.app_role() as role) r
$$;

-- older helpers now follow the settings too
create or replace function public.is_staff() returns boolean language sql stable set search_path = public as $$ select public.can_read('all_work') $$;
create or replace function public.is_office() returns boolean language sql stable set search_path = public as $$ select public.can_edit('people') $$;

create or replace function public.run_select(q text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare result jsonb;
begin
  if not public.can_read('query') then raise exception 'Your role does not have the query console'; end if;
  if q !~* '^\s*(select|with)\s' then raise exception 'Only SELECT or WITH queries are allowed'; end if;
  if position(';' in rtrim(q, '; ' || chr(10))) > 0 then raise exception 'One statement only'; end if;
  perform set_config('transaction_read_only', 'on', true);
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', rtrim(q, '; ' || chr(10))) into result;
  return result;
end $$;

-- ---------- row level security follows the settings ----------
do $$
declare t text; f text; pair text[];
begin
  -- reference lists: anyone with access can read them (drop-downs on driver screens need them); editing follows the setting
  foreach pair slice 1 in array array[
    ['people','people'],['work_phones','people'],['phone_assignments','people'],
    ['trucks','fleet'],['equipment','fleet'],['customers','customers'],['locations','customers'],
    ['jobs','planning'],['allocations','planning']] loop
    t := pair[1]; f := pair[2];
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.has_access()))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.can_edit(%L)))', t || '_insert', t, f);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.can_edit(%L))) with check ((select public.can_edit(%L)))', t || '_update', t, f, f);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.can_edit(%L)))', t || '_delete', t, f);
  end loop;

  -- driver work: own records by the function's setting; everyone's records by "All crews' shifts and dockets"
  foreach pair slice 1 in array array[
    ['shifts','shifts'],['timesheet_lines','shifts'],['dockets','dockets'],['loads','dockets'],['signoffs','dockets'],['faults','faults']] loop
    t := pair[1]; f := pair[2];
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.can_read(''all_work'')) or (created_by = (select auth.uid()) and (select public.can_read(%L)))%s)',
      t || '_read', t, f, case when t = 'timesheet_lines' then ' or (select public.can_read(''approvals''))' else '' end);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.can_edit(''all_work'')) or (select public.can_edit(%L)))', t || '_insert', t, f);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.can_edit(''all_work'')) or (created_by = (select auth.uid()) and (select public.can_edit(%L)))%s) with check ((select public.has_access()))',
      t || '_update', t, f, case when t = 'timesheet_lines' then ' or (select public.can_edit(''approvals''))' else '' end);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.can_edit(''all_work'')) or (created_by = (select auth.uid()) and (select public.can_edit(%L))))', t || '_delete', t, f);
  end loop;

  -- integration stand-in data
  foreach t in array array['gps_trips','prestart_records','km_segments'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.can_read(''integration_data'')))', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.can_edit(''integration_data''))) with check ((select public.can_edit(''integration_data'')))', t || '_write', t);
  end loop;
end $$;
-- km matching writes km onto dockets; drivers still read prestart records to check a passed prestart
-- (prestart_records_driver_read from the first security migration stays in place)

drop policy if exists import_batches_read on public.import_batches;
drop policy if exists import_batches_write on public.import_batches;
create policy import_batches_read on public.import_batches for select to authenticated
  using ((select public.can_read('data_transfer')) or (select public.can_read('integration_data')));
create policy import_batches_write on public.import_batches for all to authenticated
  using ((select public.can_edit('data_transfer')) or (select public.can_edit('integration_data')))
  with check ((select public.can_edit('data_transfer')) or (select public.can_edit('integration_data')));

-- integrations: only admin edits (enforced by admin_only_edit)
drop policy if exists integrations_read on public.integrations;
drop policy if exists integrations_write on public.integrations;
create policy integrations_read on public.integrations for select to authenticated using ((select public.can_read('integrations')));
create policy integrations_write on public.integrations for all to authenticated using ((select public.can_edit('integrations'))) with check ((select public.can_edit('integrations')));

-- logins
drop policy if exists app_logins_admin on public.app_logins;
create policy app_logins_read on public.app_logins for select to authenticated using ((select public.can_read('logins')));
create policy app_logins_write on public.app_logins for all to authenticated using ((select public.can_edit('logins'))) with check ((select public.can_edit('logins')));

-- audit and text logs
drop policy if exists audit_admin on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using ((select public.can_read('audit')));
drop policy if exists sms_log_admin_read on public.sms_log;
create policy sms_log_read on public.sms_log for select to authenticated using ((select public.can_read('audit')));

-- the settings tables: everyone signed in can read them (the app needs role names); only admin changes them
alter table public.roles enable row level security;
alter table public.features enable row level security;
alter table public.role_permissions enable row level security;
create policy roles_read on public.roles for select to authenticated using ((select public.has_access()));
create policy roles_write on public.roles for all to authenticated using ((select public.can_edit('settings'))) with check ((select public.can_edit('settings')));
create policy features_read on public.features for select to authenticated using ((select public.has_access()));
create policy role_permissions_read on public.role_permissions for select to authenticated using ((select public.has_access()));
create policy role_permissions_write on public.role_permissions for all to authenticated
  using ((select public.can_edit('settings'))) with check ((select public.can_edit('settings')) and role <> 'admin');

-- audit changes to roles and access
create trigger t_roles_audit after insert or update or delete on public.roles for each row execute function public.audit();
create trigger t_role_permissions_audit after insert or update or delete on public.role_permissions for each row execute function public.audit();

-- grants: signed-in users use the tables through RLS; visitors get nothing
grant select, insert, update, delete on public.roles, public.role_permissions to authenticated;
grant select on public.features to authenticated;
revoke all on public.roles, public.features, public.role_permissions from anon;
revoke execute on function public.access_for(text, text) from public, anon;
revoke execute on function public.access(text), public.can_read(text), public.can_edit(text), public.my_permissions() from public, anon;
grant execute on function public.access(text), public.can_read(text), public.can_edit(text), public.my_permissions(), public.access_for(text, text) to authenticated;
revoke execute on function public.protect_roles() from public, anon, authenticated;

-- integrations: extra fields so admin can track each one (never store keys here)
alter table public.integrations add column if not exists status text, add column if not exists owner text, add column if not exists notes text;
create trigger t_integrations_audit after insert or update or delete on public.integrations for each row execute function public.audit();
update public.integrations set status = coalesce(status, 'Not started');
update public.integrations set system = 'SMS provider: Mobile Message', api_status = 'Connected via Supabase Send SMS hook',
  status = 'Connected', stand_in = 'Email sign-in' where system ilike 'SMS provider%';
