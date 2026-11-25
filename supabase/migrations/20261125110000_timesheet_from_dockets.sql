-- Coho Drive: the driver's timesheet fills itself in from their dockets (25 Nov 2026)
-- Whenever a docket is started, changed, closed, reassigned or deleted (on any device, by anyone),
-- the database works out that driver's day again: hours, standby, shift times, unit, rig, truck and dog.
-- The driver only adds what dockets do not know (work diary page, wet days, R&R) and sends the fortnight.
-- Rules (same as web/src/lib/timesheetSync.ts, which the demo uses):
--  * a docket counts once it is started: status open or closed, or it has a start time
--  * the day is the docket date, else the start date (Queensland time), else the shift date
--  * two-shift daily reports: each shift's operator gets 12 hours for that shift time, plus that shift's standby
--  * other forms: the shift's driver (else the drivers ticked on the docket) gets start to end;
--    a closed docket with a shift time but no start/end counts as 12 hours
--  * total hours = sign-in to sign-out of the shift when both are known, else the docket hours;
--    travel = total minus docket hours
--  * never touches a line that is submitted or approved; keeps hours the driver typed in themselves

alter table public.timesheet_lines
  add column if not exists source text,                              -- dockets / end_shift / manual
  add column if not exists hours_edited boolean not null default false;  -- the driver typed their own hours: keep them

-- a uuid from text, or null (extras are free JSON, so never let a bad value break a save)
create or replace function public.try_uuid(p text) returns uuid
language plpgsql immutable as $$
begin return nullif(p, '')::uuid; exception when others then return null; end $$;

create or replace function public.try_numeric(p text) returns numeric
language plpgsql immutable as $$
begin return nullif(p, '')::numeric; exception when others then return null; end $$;

-- the paper forms write shift times in different ways; the timesheet uses four
create or replace function public.ts_band(p text) returns text
language sql immutable as $$
  select case
    when p is null or p = '' then null
    when p in ('00:00 to 12:00', '12:00 to 24:00', '06:00 to 18:00', '18:00 to 06:00') then p
    when p = '12:00 to 00:00' then '12:00 to 24:00'
    when p ilike '6am%' or p = '0600 - 1800' then '06:00 to 18:00'
    when p ilike '6pm%' or p = '1800 - 0600' then '18:00 to 06:00'
    else p end
$$;

-- every (driver, day) a docket gives time to
create or replace function public.timesheet_entries(p_person uuid, p_day date)
returns table(person_id uuid, day date, hours numeric, standby numeric, band text, truck_id uuid, location_id uuid, with_dog boolean, shift_id uuid, docket_id uuid)
language sql stable security definer set search_path = public as $$
  with d as (
    select dk.*, s.driver_id, s.day_night,
           coalesce(dk.work_date, (dk.start_at at time zone 'Australia/Brisbane')::date, s.shift_date) as day,
           (nullif(dk.extras ->> 's1_operator_id', '') is not null or nullif(dk.extras ->> 's2_operator_id', '') is not null) as two_shift
    from public.dockets dk left join public.shifts s on s.id = dk.shift_id
    where dk.status in ('open', 'closed') or dk.start_at is not null
  ), e as (
    select public.try_uuid(d.extras ->> ('s' || n || '_operator_id')) as person_id, d.day,
           case when public.ts_band(d.extras ->> ('s' || n || '_band')) is not null then 12::numeric end as hours,
           public.try_numeric(d.extras ->> ('s' || n || '_standby_hours')) as standby,
           public.ts_band(d.extras ->> ('s' || n || '_band')) as band,
           coalesce(public.try_uuid(d.extras ->> ('s' || n || '_truck_id')), d.truck_id) as truck_id,
           d.location_id,
           case when d.extras ->> ('s' || n || '_truck_config') = 'Dog' then true end as with_dog,
           d.shift_id, d.id as docket_id
    from d cross join generate_series(1, 2) as n
    where d.two_shift
    union all
    select p, d.day,
           case when d.start_at is not null and d.end_at is not null and d.end_at > d.start_at then extract(epoch from d.end_at - d.start_at) / 3600
                when d.status = 'closed' and coalesce(public.ts_band(d.extras ->> 'shift_band'), d.day_night) is not null then 12 end,
           d.standby_minutes / 60.0,
           coalesce(public.ts_band(d.extras ->> 'shift_band'), case d.day_night when 'Day' then '06:00 to 18:00' when 'Night' then '18:00 to 06:00' end),
           d.truck_id, d.location_id, null::boolean, d.shift_id, d.id
    from d cross join lateral unnest(case when d.driver_id is not null then array[d.driver_id] else coalesce(d.assigned_person_ids, '{}') end) as p
    where not d.two_shift
  )
  select * from e where e.person_id = p_person and e.day = p_day
$$;

-- work out one driver's day again and write it to their timesheet line
create or replace function public.refresh_timesheet_day(p_person uuid, p_day date) returns void
language plpgsql security definer set search_path = public as $$
declare
  n int; hrs numeric; sb numeric; v_band text; v_truck uuid; v_dog boolean; v_shift uuid; v_locs text;
  l public.timesheet_lines%rowtype; has_line boolean; tot numeric; s_in timestamptz; s_out timestamptz;
begin
  if p_person is null or p_day is null then return; end if;
  select count(*), sum(t.hours), sum(t.standby),
         (array_agg(t.band) filter (where t.band is not null))[1],
         (array_agg(t.truck_id) filter (where t.truck_id is not null))[1],
         bool_or(t.with_dog),
         (array_agg(t.shift_id) filter (where t.shift_id is not null))[1],
         string_agg(distinct loc.name, ', ')
    into n, hrs, sb, v_band, v_truck, v_dog, v_shift, v_locs
    from public.timesheet_entries(p_person, p_day) t left join public.locations loc on loc.id = t.location_id;

  select * into l from public.timesheet_lines where person_id = p_person and work_date = p_day order by created_at limit 1;
  has_line := found;

  if n = 0 then
    -- the docket moved to someone else or was deleted: remove a line we made that nobody has touched
    if has_line and l.source = 'dockets' and l.status = 'draft' and not l.hours_edited and l.work_diary_page is null then
      delete from public.timesheet_lines where id = l.id;
    end if;
    return;
  end if;

  if v_shift is not null then
    select sign_in_at, sign_out_at into s_in, s_out from public.shifts where id = v_shift;
    if s_in is not null and s_out is not null and s_out > s_in then tot := extract(epoch from s_out - s_in) / 3600; end if;
  end if;
  tot := coalesce(tot, hrs);

  if not has_line then
    insert into public.timesheet_lines(person_id, work_date, status, on_shift, rr, shift_id, docket_hours, standby_hours, total_hours, travel_hours,
                                       shift_band, truck_id, with_dog, location, source)
    values (p_person, p_day, 'draft', true, false, v_shift, round(hrs, 2), round(sb, 2), round(tot, 2),
            round(greatest(coalesce(tot, 0) - coalesce(hrs, 0), 0), 2), v_band, v_truck, coalesce(v_dog, false), v_locs, 'dockets');
  elsif l.status in ('draft', 'queried') then
    update public.timesheet_lines set
      shift_id = coalesce(l.shift_id, v_shift),
      docket_hours = round(hrs, 2), standby_hours = round(sb, 2),
      total_hours = case when l.hours_edited then l.total_hours else round(tot, 2) end,
      travel_hours = case when l.hours_edited then l.travel_hours else round(greatest(coalesce(tot, 0) - coalesce(hrs, 0), 0), 2) end,
      shift_band = coalesce(v_band, l.shift_band), truck_id = coalesce(v_truck, l.truck_id),
      with_dog = coalesce(v_dog, l.with_dog), location = coalesce(v_locs, l.location),
      on_shift = true, rr = false,
      source = coalesce(l.source, 'dockets')
    where id = l.id;
  end if;
end $$;

-- everyone a docket row could give time to (old or new version of the row)
create or replace function public.docket_people_days(p_shift uuid, p_work_date date, p_start timestamptz, p_extras jsonb, p_assigned uuid[])
returns table(person_id uuid, day date)
language sql stable security definer set search_path = public as $$
  select distinct p, coalesce(p_work_date, (p_start at time zone 'Australia/Brisbane')::date, s.shift_date)
  from (select 1) x
  left join public.shifts s on s.id = p_shift
  cross join lateral unnest(array_remove(
    array[s.driver_id, public.try_uuid(p_extras ->> 's1_operator_id'), public.try_uuid(p_extras ->> 's2_operator_id')] || coalesce(p_assigned, '{}'),
    null)) as p
$$;

create or replace function public.dockets_timesheet_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select distinct x.person_id, x.day from (
      select * from public.docket_people_days(new.shift_id, new.work_date, new.start_at, new.extras, new.assigned_person_ids) where tg_op <> 'DELETE'
      union
      select * from public.docket_people_days(old.shift_id, old.work_date, old.start_at, old.extras, old.assigned_person_ids) where tg_op <> 'INSERT'
    ) x where x.person_id is not null and x.day is not null
  loop
    perform public.refresh_timesheet_day(r.person_id, r.day);
  end loop;
  return null;
end $$;
drop trigger if exists t_dockets_timesheet on public.dockets;
create trigger t_dockets_timesheet after insert or update or delete on public.dockets
  for each row execute function public.dockets_timesheet_sync();

-- signing in or out of a shift changes total and travel hours
create or replace function public.shifts_timesheet_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_timesheet_day(new.driver_id, new.shift_date);
  if old.driver_id is distinct from new.driver_id or old.shift_date is distinct from new.shift_date then
    perform public.refresh_timesheet_day(old.driver_id, old.shift_date);
  end if;
  return null;
end $$;
drop trigger if exists t_shifts_timesheet on public.shifts;
create trigger t_shifts_timesheet after update of sign_in_at, sign_out_at, driver_id, shift_date on public.shifts
  for each row execute function public.shifts_timesheet_sync();

revoke execute on function public.refresh_timesheet_day(uuid, date) from public, anon, authenticated;
revoke execute on function public.timesheet_entries(uuid, date) from public, anon, authenticated;
revoke execute on function public.docket_people_days(uuid, date, timestamptz, jsonb, uuid[]) from public, anon, authenticated;
revoke execute on function public.dockets_timesheet_sync() from public, anon, authenticated;
revoke execute on function public.shifts_timesheet_sync() from public, anon, authenticated;

-- ---------- drivers see and fix their own timesheet lines, whoever's device made them ----------
drop policy if exists timesheet_lines_read on public.timesheet_lines;
drop policy if exists timesheet_lines_update on public.timesheet_lines;
create policy timesheet_lines_read on public.timesheet_lines for select to authenticated using (
  (select public.can_read('all_work')) or (select public.can_read('approvals'))
  or ((created_by = (select auth.uid()) or person_id = any(public.my_person_ids()))
      and ((select public.can_read('shifts')) or (select public.can_read('forms')))));
create policy timesheet_lines_update on public.timesheet_lines for update to authenticated using (
  (select public.can_edit('all_work')) or (select public.can_edit('approvals'))
  or ((created_by = (select auth.uid()) or person_id = any(public.my_person_ids()))
      and ((select public.can_edit('shifts')) or (select public.can_edit('forms')))))
  with check ((select public.has_access()));

-- fill in lines for dockets already in the system
do $$
declare r record;
begin
  for r in select distinct x.person_id, x.day
           from public.dockets d cross join lateral public.docket_people_days(d.shift_id, d.work_date, d.start_at, d.extras, d.assigned_person_ids) x
           where x.person_id is not null and x.day is not null loop
    perform public.refresh_timesheet_day(r.person_id, r.day);
  end loop;
end $$;
