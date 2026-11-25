-- Coho Drive: timesheet periods and shifts over 24 hours (25 Nov 2026)
--  1. App settings (admin): the day timesheet weeks start on (default Wednesday) and the default view
--     (fortnight, or week for supervisors who approve one week at a time before handover).
--  2. Shifts over 24 hours: a docket or shift can be marked "over 24 hours". Its hours are then split
--     across each calendar day it covers (Queensland time), and every timesheet line it touches is flagged.
--     A docket that runs longer than 24 hours is treated the same way even if nobody ticked the box.
--     Normal night shifts (e.g. 18:00 to 06:00) are NOT split: they stay on the day they started.

-- ---------- 1. app settings ----------
create table if not exists public.app_settings (
  id text primary key,                 -- setting name
  value jsonb,
  description text,
  updated_at timestamptz default now(),
  updated_by uuid default auth.uid()
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_read on public.app_settings;
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated using ((select public.has_access()));
create policy app_settings_write on public.app_settings for all to authenticated
  using ((select public.can_edit('settings'))) with check ((select public.can_edit('settings')));
grant select, insert, update, delete on public.app_settings to authenticated;
insert into public.app_settings(id, value, description) values
  ('timesheet_week_start', '3', 'Day timesheet weeks start on: 0 Sunday, 1 Monday ... 3 Wednesday ... 6 Saturday'),
  ('timesheet_default_view', '"fortnight"', 'Timesheet and approvals open showing a fortnight or a week'),
  ('timesheet_cycle_anchor', '"2026-11-11"', 'Any first day of a pay fortnight; fortnights repeat every 14 days from it')
on conflict (id) do nothing;
-- (audit_log keys records by uuid; settings keep updated_by and updated_at instead)
create trigger t_app_settings_touch before update on public.app_settings for each row execute function public.touch_updated_at();

-- ---------- 2. over 24 hours ----------
alter table public.dockets add column if not exists over_24h boolean not null default false;
alter table public.shifts add column if not exists over_24h boolean not null default false;
alter table public.timesheet_lines
  add column if not exists over_24h boolean not null default false,   -- this day is part of a shift over 24 hours
  add column if not exists split_note text;                            -- e.g. "Part of a 30 h shift: 24/11 06:00 to 25/11 12:00"

-- hours of [a, b) that fall on calendar day d in Queensland
create or replace function public.hours_on_day(a timestamptz, b timestamptz, d date) returns numeric
language sql immutable as $$
  select greatest(0, extract(epoch from (
    least(b, ((d + 1)::timestamp at time zone 'Australia/Brisbane')) - greatest(a, (d::timestamp at time zone 'Australia/Brisbane'))
  )) / 3600)::numeric
$$;
create or replace function public.is_long(a timestamptz, b timestamptz, flagged boolean) returns boolean
language sql immutable as $$
  select a is not null and b is not null and b > a and (coalesce(flagged, false) or b - a > interval '24 hours')
$$;
create or replace function public.long_note(a timestamptz, b timestamptz) returns text
language sql immutable as $$
  select format('Part of a %s h shift: %s to %s', round(extract(epoch from b - a) / 3600, 1),
    to_char(a at time zone 'Australia/Brisbane', 'DD/MM HH24:MI'), to_char(b at time zone 'Australia/Brisbane', 'DD/MM HH24:MI'))
$$;

drop function if exists public.timesheet_entries(uuid, date);
create or replace function public.timesheet_entries(p_person uuid, p_day date)
returns table(person_id uuid, day date, hours numeric, standby numeric, band text, truck_id uuid, location_id uuid, with_dog boolean,
              shift_id uuid, docket_id uuid, split boolean, note text)
language sql stable security definer set search_path = public as $$
  with d as (
    select dk.*, s.driver_id, s.day_night,
           coalesce(dk.work_date, (dk.start_at at time zone 'Australia/Brisbane')::date, s.shift_date) as day,
           (nullif(dk.extras ->> 's1_operator_id', '') is not null or nullif(dk.extras ->> 's2_operator_id', '') is not null) as two_shift,
           public.is_long(dk.start_at, dk.end_at, dk.over_24h) as long
    from public.dockets dk left join public.shifts s on s.id = dk.shift_id
    where dk.status in ('open', 'closed') or dk.start_at is not null
  ), e as (
    -- two-shift daily reports: 12 hours per operator for their shift
    select public.try_uuid(d.extras ->> ('s' || n || '_operator_id')) as person_id, d.day,
           case when public.ts_band(d.extras ->> ('s' || n || '_band')) is not null then 12::numeric end as hours,
           public.try_numeric(d.extras ->> ('s' || n || '_standby_hours')) as standby,
           public.ts_band(d.extras ->> ('s' || n || '_band')) as band,
           coalesce(public.try_uuid(d.extras ->> ('s' || n || '_truck_id')), d.truck_id) as truck_id,
           d.location_id,
           case when d.extras ->> ('s' || n || '_truck_config') = 'Dog' then true end as with_dog,
           d.shift_id, d.id as docket_id, false as split, null::text as note
    from d cross join generate_series(1, 2) as n
    where d.two_shift
    union all
    -- shift over 24 hours: one entry per calendar day it covers, with that day's hours
    select p, gd::date,
           public.hours_on_day(d.start_at, d.end_at, gd::date),
           case when gd::date = (d.start_at at time zone 'Australia/Brisbane')::date then d.standby_minutes / 60.0 end,
           coalesce(public.ts_band(d.extras ->> 'shift_band'), case d.day_night when 'Day' then '06:00 to 18:00' when 'Night' then '18:00 to 06:00' end),
           d.truck_id, d.location_id, null::boolean, d.shift_id, d.id, true, public.long_note(d.start_at, d.end_at)
    from d
    cross join lateral unnest(case when d.driver_id is not null then array[d.driver_id] else coalesce(d.assigned_person_ids, '{}') end) as p
    cross join lateral generate_series((d.start_at at time zone 'Australia/Brisbane')::date, least((d.end_at at time zone 'Australia/Brisbane')::date,
                                       (d.start_at at time zone 'Australia/Brisbane')::date + 14), interval '1 day') as gd
    where not d.two_shift and d.long and public.hours_on_day(d.start_at, d.end_at, gd::date) > 0
    union all
    -- everything else: the whole docket on its day
    select p, d.day,
           case when d.start_at is not null and d.end_at is not null and d.end_at > d.start_at then extract(epoch from d.end_at - d.start_at) / 3600
                when d.status = 'closed' and coalesce(public.ts_band(d.extras ->> 'shift_band'), d.day_night) is not null then 12 end,
           d.standby_minutes / 60.0,
           coalesce(public.ts_band(d.extras ->> 'shift_band'), case d.day_night when 'Day' then '06:00 to 18:00' when 'Night' then '18:00 to 06:00' end),
           d.truck_id, d.location_id, null::boolean, d.shift_id, d.id, false, null
    from d cross join lateral unnest(case when d.driver_id is not null then array[d.driver_id] else coalesce(d.assigned_person_ids, '{}') end) as p
    where not d.two_shift and not d.long
  )
  select * from e where e.person_id = p_person and e.day = p_day
$$;
revoke execute on function public.timesheet_entries(uuid, date) from public, anon, authenticated;

create or replace function public.refresh_timesheet_day(p_person uuid, p_day date) returns void
language plpgsql security definer set search_path = public as $$
declare
  n int; hrs numeric; sb numeric; v_band text; v_truck uuid; v_dog boolean; v_shift uuid; v_locs text; v_split boolean; v_note text;
  l public.timesheet_lines%rowtype; has_line boolean; tot numeric; s_in timestamptz; s_out timestamptz; s_long boolean;
begin
  if p_person is null or p_day is null then return; end if;
  select count(*), sum(t.hours), sum(t.standby),
         (array_agg(t.band) filter (where t.band is not null))[1],
         (array_agg(t.truck_id) filter (where t.truck_id is not null))[1],
         bool_or(t.with_dog),
         (array_agg(t.shift_id) filter (where t.shift_id is not null))[1],
         string_agg(distinct loc.name, ', '),
         coalesce(bool_or(t.split), false),
         (array_agg(t.note) filter (where t.note is not null))[1]
    into n, hrs, sb, v_band, v_truck, v_dog, v_shift, v_locs, v_split, v_note
    from public.timesheet_entries(p_person, p_day) t left join public.locations loc on loc.id = t.location_id;

  select * into l from public.timesheet_lines where person_id = p_person and work_date = p_day order by created_at limit 1;
  has_line := found;

  if n = 0 then
    if has_line and l.source = 'dockets' and l.status = 'draft' and not l.hours_edited and l.work_diary_page is null then
      delete from public.timesheet_lines where id = l.id;
    end if;
    return;
  end if;

  -- total: sign-in to sign-out of the shift; for a shift over 24 hours, only the part on this day
  if v_shift is not null then
    select sign_in_at, sign_out_at, public.is_long(sign_in_at, sign_out_at, over_24h) into s_in, s_out, s_long from public.shifts where id = v_shift;
    if s_long then
      tot := public.hours_on_day(s_in, s_out, p_day); v_split := true; v_note := coalesce(v_note, public.long_note(s_in, s_out));
    elsif s_in is not null and s_out is not null and s_out > s_in then
      tot := extract(epoch from s_out - s_in) / 3600;
    end if;
  end if;
  tot := coalesce(tot, hrs);

  if not has_line then
    insert into public.timesheet_lines(person_id, work_date, status, on_shift, rr, shift_id, docket_hours, standby_hours, total_hours, travel_hours,
                                       shift_band, truck_id, with_dog, location, source, over_24h, split_note)
    values (p_person, p_day, 'draft', true, false, v_shift, round(hrs, 2), round(sb, 2), round(tot, 2),
            round(greatest(coalesce(tot, 0) - coalesce(hrs, 0), 0), 2), v_band, v_truck, coalesce(v_dog, false), v_locs, 'dockets', v_split, v_note);
  elsif l.status in ('draft', 'queried') then
    update public.timesheet_lines set
      shift_id = coalesce(l.shift_id, v_shift),
      docket_hours = round(hrs, 2), standby_hours = round(sb, 2),
      total_hours = case when l.hours_edited then l.total_hours else round(tot, 2) end,
      travel_hours = case when l.hours_edited then l.travel_hours else round(greatest(coalesce(tot, 0) - coalesce(hrs, 0), 0), 2) end,
      shift_band = coalesce(v_band, l.shift_band), truck_id = coalesce(v_truck, l.truck_id),
      with_dog = coalesce(v_dog, l.with_dog), location = coalesce(v_locs, l.location),
      on_shift = true, rr = false, source = coalesce(l.source, 'dockets'),
      over_24h = v_split, split_note = v_note
    where id = l.id;
  end if;
end $$;

-- every driver and every day a docket covers (a long docket covers several days)
drop trigger if exists t_dockets_timesheet on public.dockets;
drop function if exists public.docket_people_days(uuid, date, timestamptz, jsonb, uuid[]);
create or replace function public.docket_people_days(p_shift uuid, p_work_date date, p_start timestamptz, p_end timestamptz, p_extras jsonb, p_assigned uuid[])
returns table(person_id uuid, day date)
language sql stable security definer set search_path = public as $$
  with base as (
    select coalesce(p_work_date, (p_start at time zone 'Australia/Brisbane')::date, s.shift_date) as d0,
           case when p_start is not null and p_end is not null and p_end > p_start
                then least((p_end at time zone 'Australia/Brisbane')::date, (p_start at time zone 'Australia/Brisbane')::date + 14) end as d1,
           array_remove(array[s.driver_id, public.try_uuid(p_extras ->> 's1_operator_id'), public.try_uuid(p_extras ->> 's2_operator_id')]
                        || coalesce(p_assigned, '{}'), null) as people
    from (select 1) x left join public.shifts s on s.id = p_shift
  )
  select distinct p, gd::date
  from base
  cross join lateral unnest(base.people) as p
  cross join lateral generate_series(least(base.d0, coalesce((p_start at time zone 'Australia/Brisbane')::date, base.d0)),
                                     greatest(base.d0, coalesce(base.d1, base.d0)), interval '1 day') as gd
  where base.d0 is not null
$$;
revoke execute on function public.docket_people_days(uuid, date, timestamptz, timestamptz, jsonb, uuid[]) from public, anon, authenticated;

create or replace function public.dockets_timesheet_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select distinct x.person_id, x.day from (
      select * from public.docket_people_days(new.shift_id, new.work_date, new.start_at, new.end_at, new.extras, new.assigned_person_ids) where tg_op <> 'DELETE'
      union
      select * from public.docket_people_days(old.shift_id, old.work_date, old.start_at, old.end_at, old.extras, old.assigned_person_ids) where tg_op <> 'INSERT'
    ) x where x.person_id is not null and x.day is not null
  loop
    perform public.refresh_timesheet_day(r.person_id, r.day);
  end loop;
  return null;
end $$;
create trigger t_dockets_timesheet after insert or update or delete on public.dockets
  for each row execute function public.dockets_timesheet_sync();

-- shifts: refresh every day the shift covers
create or replace function public.shifts_timesheet_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  for d in
    select distinct gd::date from (
      select generate_series(coalesce((x.a at time zone 'Australia/Brisbane')::date, x.sd), greatest(x.sd, coalesce(least((x.b at time zone 'Australia/Brisbane')::date,
             (x.a at time zone 'Australia/Brisbane')::date + 14), x.sd)), interval '1 day') as gd
      from (values (new.sign_in_at, new.sign_out_at, new.shift_date), (old.sign_in_at, old.sign_out_at, old.shift_date)) as x(a, b, sd)
      where x.sd is not null or x.a is not null
    ) y
  loop
    perform public.refresh_timesheet_day(new.driver_id, d);
    if old.driver_id is distinct from new.driver_id then perform public.refresh_timesheet_day(old.driver_id, d); end if;
  end loop;
  return null;
end $$;
drop trigger if exists t_shifts_timesheet on public.shifts;
create trigger t_shifts_timesheet after update of sign_in_at, sign_out_at, driver_id, shift_date, over_24h on public.shifts
  for each row execute function public.shifts_timesheet_sync();
