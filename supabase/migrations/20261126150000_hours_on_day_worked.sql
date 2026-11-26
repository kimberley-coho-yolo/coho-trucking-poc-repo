-- UAT 26/11/2026: keep hours on the day they were worked, and no 12 hour cap.
-- A shift that runs past midnight puts its hours on each calendar day (Queensland time). Example: 6pm to 6am is
-- 6 hours on the day it starts and 6 hours on the next day. The night band (18:00 to 06:00) on a two-shift
-- daily report, or on a closed docket with no times, is also 6 + 6. Only shifts over 24 hours are flagged 24 h+.
-- Days over 12.5 hours are still highlighted for the supervisor in the app (nothing here caps hours).

create or replace function public.crosses_midnight(a timestamptz, b timestamptz) returns boolean
language sql immutable as $$
  select a is not null and b is not null and b > a
     and (b at time zone 'Australia/Brisbane')::date > (a at time zone 'Australia/Brisbane')::date
     and public.hours_on_day(a, b, (b at time zone 'Australia/Brisbane')::date) > 0
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
           public.is_long(dk.start_at, dk.end_at, dk.over_24h) as long,
           public.crosses_midnight(dk.start_at, dk.end_at) as crosses,
           (dk.start_at is not null and dk.end_at is not null and dk.end_at > dk.start_at) as timed
    from public.dockets dk left join public.shifts s on s.id = dk.shift_id
    where dk.status in ('open', 'closed') or dk.start_at is not null
  ), e as (
    -- two-shift daily reports: 12 hours per operator for their shift
    -- (the night band 18:00 to 06:00 is 6 hours on the day it starts and 6 on the next)
    select public.try_uuid(d.extras ->> ('s' || n || '_operator_id')) as person_id, d.day + k as day,
           case when b.band is null then null when b.band = '18:00 to 06:00' then 6::numeric else 12::numeric end as hours,
           case when k = 0 then public.try_numeric(d.extras ->> ('s' || n || '_standby_hours')) end as standby,
           b.band,
           coalesce(public.try_uuid(d.extras ->> ('s' || n || '_truck_id')), d.truck_id) as truck_id,
           d.location_id,
           case when d.extras ->> ('s' || n || '_truck_config') = 'Dog' then true end as with_dog,
           d.shift_id, d.id as docket_id, false as split, null::text as note
    from d cross join generate_series(1, 2) as n
    cross join lateral (select public.ts_band(d.extras ->> ('s' || n || '_band')) as band) b
    cross join generate_series(0, 1) as k
    where d.two_shift and (k = 0 or b.band = '18:00 to 06:00')
    union all
    -- a shift that runs past midnight (or is over 24 hours): one entry per calendar day it covers, with that day's hours.
    -- Only a shift over 24 hours is flagged 24 h+.
    select p, gd::date,
           public.hours_on_day(d.start_at, d.end_at, gd::date),
           case when gd::date = (d.start_at at time zone 'Australia/Brisbane')::date then d.standby_minutes / 60.0 end,
           coalesce(public.ts_band(d.extras ->> 'shift_band'), case d.day_night when 'Day' then '06:00 to 18:00' when 'Night' then '18:00 to 06:00' end),
           d.truck_id, d.location_id, null::boolean, d.shift_id, d.id, d.long, case when d.long then public.long_note(d.start_at, d.end_at) end
    from d
    cross join lateral unnest(case when d.driver_id is not null then array[d.driver_id] else coalesce(d.assigned_person_ids, '{}') end) as p
    cross join lateral generate_series((d.start_at at time zone 'Australia/Brisbane')::date, least((d.end_at at time zone 'Australia/Brisbane')::date,
                                       (d.start_at at time zone 'Australia/Brisbane')::date + 14), interval '1 day') as gd
    where not d.two_shift and (d.long or d.crosses) and public.hours_on_day(d.start_at, d.end_at, gd::date) > 0
    union all
    -- everything else: the whole docket on its day (closed with no times on the night band: 6 hours on each day)
    select p, d.day + k,
           case when d.timed then extract(epoch from d.end_at - d.start_at) / 3600
                when d.status = 'closed' and b.band = '18:00 to 06:00' then 6
                when d.status = 'closed' and coalesce(b.band, d.day_night) is not null then 12 end,
           case when k = 0 then d.standby_minutes / 60.0 end,
           b.band,
           d.truck_id, d.location_id, null::boolean, d.shift_id, d.id, false, null
    from d cross join lateral unnest(case when d.driver_id is not null then array[d.driver_id] else coalesce(d.assigned_person_ids, '{}') end) as p
    cross join lateral (select coalesce(public.ts_band(d.extras ->> 'shift_band'), case d.day_night when 'Day' then '06:00 to 18:00' when 'Night' then '18:00 to 06:00' end) as band) b
    cross join generate_series(0, 1) as k
    where not d.two_shift and not d.long and not d.crosses
      and (k = 0 or (not d.timed and d.status = 'closed' and b.band = '18:00 to 06:00'))
  )
  select * from e where e.person_id = p_person and e.day = p_day
$$;
revoke execute on function public.timesheet_entries(uuid, date) from public, anon, authenticated;

-- the day's line (as in 20261126130000, clash lines still left alone), with shift totals split at midnight
create or replace function public.refresh_timesheet_day(p_person uuid, p_day date) returns void
language plpgsql security definer set search_path = public as $$
declare
  n int; hrs numeric; sb numeric; v_band text; v_truck uuid; v_dog boolean; v_shift uuid; v_locs text; v_split boolean; v_note text;
  l public.timesheet_lines%rowtype; has_line boolean; tot numeric; s_long boolean; v_noshift numeric; v_lnote text; v_shift2 uuid; v_struck uuid;
begin
  if p_person is null or p_day is null then return; end if;
  -- the day's band is the band of the entry with the most hours (a day can hold the end of last night and a new shift)
  select count(*), sum(t.hours), sum(t.standby),
         (array_agg(t.band order by t.hours desc nulls last) filter (where t.band is not null))[1],
         (array_agg(t.truck_id) filter (where t.truck_id is not null))[1],
         bool_or(t.with_dog),
         (array_agg(t.shift_id) filter (where t.shift_id is not null))[1],
         string_agg(distinct loc.name, ', '),
         coalesce(bool_or(t.split), false),
         (array_agg(t.note) filter (where t.note is not null))[1]
    into n, hrs, sb, v_band, v_truck, v_dog, v_shift, v_locs, v_split, v_note
    from public.timesheet_entries(p_person, p_day) t left join public.locations loc on loc.id = t.location_id;

  -- a line waiting for a clash to be resolved is left alone (the approver decides)
  select * into l from public.timesheet_lines where person_id = p_person and work_date = p_day and clash_with is null order by created_at limit 1;
  has_line := found;

  -- total: sign-in to sign-out of each shift worked on this day. A shift that runs past midnight counts only its hours on this day,
  -- so a 6pm to 6am shift is 6 hours on each day. Shifts are the ones this day's dockets belong to, plus any of this driver's shifts
  -- (with dockets) that ran past midnight into this day.
  select sum(case when public.is_long(s.sign_in_at, s.sign_out_at, s.over_24h) or public.crosses_midnight(s.sign_in_at, s.sign_out_at)
                  then public.hours_on_day(s.sign_in_at, s.sign_out_at, p_day)
                  when s.sign_in_at is not null and s.sign_out_at > s.sign_in_at then extract(epoch from s.sign_out_at - s.sign_in_at) / 3600 end),
         coalesce(bool_or(public.is_long(s.sign_in_at, s.sign_out_at, s.over_24h)), false),
         (array_agg(public.long_note(s.sign_in_at, s.sign_out_at)) filter (where public.is_long(s.sign_in_at, s.sign_out_at, s.over_24h)))[1],
         (array_agg(s.id order by s.sign_in_at))[1],
         (array_agg(s.truck_id order by s.sign_in_at) filter (where s.truck_id is not null))[1]
    into tot, s_long, v_lnote, v_shift2, v_struck
    from public.shifts s
   where s.id in (select t.shift_id from public.timesheet_entries(p_person, p_day) t where t.shift_id is not null)
      or (s.driver_id = p_person
          and (public.is_long(s.sign_in_at, s.sign_out_at, s.over_24h) or public.crosses_midnight(s.sign_in_at, s.sign_out_at))
          and public.hours_on_day(s.sign_in_at, s.sign_out_at, p_day) > 0
          and exists (select 1 from public.dockets dk where dk.shift_id = s.id));

  if n = 0 and coalesce(tot, 0) = 0 then
    if has_line and l.source = 'dockets' and l.status = 'draft' and not l.hours_edited and l.work_diary_page is null then
      delete from public.timesheet_lines where id = l.id;
    end if;
    return;
  end if;

  v_shift := coalesce(v_shift, v_shift2); v_truck := coalesce(v_truck, v_struck);
  v_split := v_split or s_long; v_note := coalesce(v_note, v_lnote);
  -- dockets not on any shift add their own hours to the shift time
  select sum(t.hours) into v_noshift from public.timesheet_entries(p_person, p_day) t where t.shift_id is null;
  tot := case when tot is not null then tot + coalesce(v_noshift, 0) else hrs end;

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

-- a docket also refreshes the next day (a night shift can put hours on it)
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
                                     greatest(base.d0 + 1, coalesce(base.d1, base.d0)), interval '1 day') as gd
  where base.d0 is not null
$$;
revoke execute on function public.docket_people_days(uuid, date, timestamptz, timestamptz, jsonb, uuid[]) from public, anon, authenticated;
