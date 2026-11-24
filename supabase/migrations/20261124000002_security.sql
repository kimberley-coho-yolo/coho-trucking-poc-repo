-- Coho Trucking PoC: roles, row level security, audit, helper functions

-- Role of the signed-in user, from app_logins matched on email or mobile.
-- Highest role wins if a person has several logins.
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select l.role
  from public.app_logins l
  where l.active is not false
    and (
      (l.email is not null and lower(l.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
      or (l.phone is not null and public.norm_phone(l.phone) = public.norm_phone(coalesce(auth.jwt() ->> 'phone', '')))
    )
  order by case l.role when 'admin' then 1 when 'office' then 2 when 'supervisor' then 3 else 4 end
  limit 1
$$;

create or replace function public.is_staff() returns boolean
language sql stable as $$ select coalesce(public.app_role() in ('admin','office','supervisor'), false) $$;

create or replace function public.is_office() returns boolean
language sql stable as $$ select coalesce(public.app_role() in ('admin','office'), false) $$;

create or replace function public.is_admin() returns boolean
language sql stable as $$ select coalesce(public.app_role() = 'admin', false) $$;

create or replace function public.has_access() returns boolean
language sql stable as $$ select public.app_role() is not null $$;

-- First person to sign in can make themselves admin, but only while no admin exists.
create or replace function public.claim_first_admin(p_label text default null) returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.app_logins where role = 'admin' and active is not false) then
    return 'An admin already exists. Ask them to add you.';
  end if;
  insert into public.app_logins(label, email, phone, role, active)
  values (coalesce(p_label, 'First admin'), auth.jwt() ->> 'email', auth.jwt() ->> 'phone', 'admin', true);
  return 'You are now the admin.';
end $$;

-- People a work phone may sign in as (the name drop-down). Cover drivers: all active drivers.
create or replace function public.people_for_my_phone() returns setof public.people
language sql stable security definer set search_path = public as $$
  select p.* from public.people p
  join public.phone_assignments a on a.person_id = p.id
  join public.work_phones w on w.id = a.work_phone_id
  where p.active is not false
    and public.norm_phone(w.phone) = public.norm_phone(coalesce(auth.jwt() ->> 'phone', ''))
  order by p.full_name
$$;

-- Read-only query console for admin and office. Runs as the caller, so row level security still applies.
create or replace function public.run_select(q text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare result jsonb;
begin
  if not public.is_office() then raise exception 'Only admin or office can run queries'; end if;
  if q !~* '^\s*(select|with)\s' then raise exception 'Only SELECT or WITH queries are allowed'; end if;
  if position(';' in rtrim(q, '; ' || chr(10))) > 0 then raise exception 'One statement only'; end if;
  perform set_config('transaction_read_only', 'on', true);
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', rtrim(q, '; ' || chr(10))) into result;
  return result;
end $$;

-- Keep updated_at current
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger t_shifts_touch before update on public.shifts for each row execute function public.touch_updated_at();
create trigger t_dockets_touch before update on public.dockets for each row execute function public.touch_updated_at();
create trigger t_ts_touch before update on public.timesheet_lines for each row execute function public.touch_updated_at();

-- Approved timesheet lines are locked except for admin
create or replace function public.lock_approved() returns trigger language plpgsql as $$
begin
  if old.status = 'approved' and not public.is_admin() then
    raise exception 'This timesheet line is approved and locked';
  end if;
  return new;
end $$;
create trigger t_ts_lock before update on public.timesheet_lines for each row execute function public.lock_approved();

-- Audit every change to transactional tables
create or replace function public.audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log(table_name, record_id, action, before_data, after_data)
  values (tg_table_name,
          coalesce((case when tg_op = 'DELETE' then old.id else new.id end), null),
          tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['shifts','dockets','loads','signoffs','faults','timesheet_lines','app_logins','people','work_phones','phone_assignments'] loop
    execute format('create trigger t_%s_audit after insert or update or delete on public.%I for each row execute function public.audit()', t, t);
  end loop;
end $$;

-- ---------- Row level security ----------
do $$
declare t text;
begin
  -- reference tables: everyone with access reads, office and admin write
  foreach t in array array['people','work_phones','phone_assignments','trucks','equipment','customers','locations','jobs','allocations','integrations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_access())', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_office()) with check (public.is_office())', t || '_write', t);
  end loop;

  -- driver work: staff see all; drivers see and edit what their login created
  foreach t in array array['shifts','dockets','loads','signoffs','faults','timesheet_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff() or created_by = auth.uid())', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_access())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_staff() or created_by = auth.uid()) with check (public.has_access())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_office() or created_by = auth.uid())', t || '_delete', t);
  end loop;

  -- integration stand-ins and matching results: staff only
  foreach t in array array['gps_trips','prestart_records','km_segments','import_batches'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_office()) with check (public.is_office())', t || '_write', t);
  end loop;
end $$;

-- drivers can read prestart records so the app can check for a passed prestart
create policy prestart_records_driver_read on public.prestart_records for select to authenticated using (public.has_access());

alter table public.app_logins enable row level security;
create policy app_logins_admin on public.app_logins for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy app_logins_self on public.app_logins for select to authenticated using (
  lower(coalesce(email,'')) = lower(coalesce(auth.jwt() ->> 'email', '-'))
  or public.norm_phone(phone) = public.norm_phone(coalesce(auth.jwt() ->> 'phone', '')));

alter table public.audit_log enable row level security;
create policy audit_admin on public.audit_log for select to authenticated using (public.is_admin());

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.run_select(text) from anon;
