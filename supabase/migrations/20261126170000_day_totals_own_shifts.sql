-- Fix (26/11/2026): a day's total counts only the person's OWN shift time.
-- 20261126150000 added up every shift linked to the day's dockets. On a two-shift daily report the docket sits on the day
-- operator's shift, so the night operator was also given the day operator's shift time (for example 25 hours in a day).
-- Now: own shifts split at midnight, plus dockets with no shift at all (not two-shift reports); with no own shift time, the docket hours.

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

  -- total: the person's OWN shift time on this day (sign-in to sign-out, split at midnight, so a 6pm to 6am shift is 6 hours on each day).
  -- Only shifts this person signed (driver_id) count: on a two-shift daily report the docket sits on the day operator's shift, and that
  -- time must never be added to the night operator. Own shifts count when the person has dockets on this day, or when the shift itself
  -- has dockets (the end of last night's shift carried past midnight).
  select sum(public.hours_on_day(s.sign_in_at, s.sign_out_at, p_day)),
         coalesce(bool_or(public.is_long(s.sign_in_at, s.sign_out_at, s.over_24h)), false),
         (array_agg(public.long_note(s.sign_in_at, s.sign_out_at)) filter (where public.is_long(s.sign_in_at, s.sign_out_at, s.over_24h)))[1],
         (array_agg(s.id order by s.sign_in_at))[1],
         (array_agg(s.truck_id order by s.sign_in_at) filter (where s.truck_id is not null))[1]
    into tot, s_long, v_lnote, v_shift2, v_struck
    from public.shifts s
   where s.driver_id = p_person
     and s.sign_in_at is not null and s.sign_out_at > s.sign_in_at
     and public.hours_on_day(s.sign_in_at, s.sign_out_at, p_day) > 0
     and (n > 0 or exists (select 1 from public.dockets dk where dk.shift_id = s.id));

  if n = 0 and coalesce(tot, 0) = 0 then
    if has_line and l.source = 'dockets' and l.status = 'draft' and not l.hours_edited and l.work_diary_page is null then
      delete from public.timesheet_lines where id = l.id;
    end if;
    return;
  end if;

  v_shift := coalesce(v_shift2, v_shift); v_truck := coalesce(v_truck, v_struck);   -- the line links to the person's own shift first
  v_split := v_split or s_long; v_note := coalesce(v_note, v_lnote);
  -- dockets not on any shift add their own hours to the shift time (not two-shift daily reports: their operators sign their own shifts)
  select sum(t.hours) into v_noshift from public.timesheet_entries(p_person, p_day) t join public.dockets dk on dk.id = t.docket_id
   where t.shift_id is null
     and not (nullif(dk.extras ->> 's1_operator_id', '') is not null or nullif(dk.extras ->> 's2_operator_id', '') is not null);
  tot := case when coalesce(tot, 0) > 0 then tot + coalesce(v_noshift, 0) else hrs end;

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
