-- New drivers added on a crew phone, checked by a timesheet approver.
--
-- 1. On a crew phone, a driver whose name is not in the list types their full name. They are added straight
--    away as a PENDING driver on that phone, so their shift, dockets and timesheet record against that name.
-- 2. Everything under a pending name is flagged to the approvers. Their days cannot be approved yet.
-- 3. Once the pending driver has sent their timesheet, an approver (anyone with "Timesheet approvals: edit")
--    either APPROVES them as a new driver, or PAIRS their hours to an existing person with exactly the same
--    surname: shifts, dockets and timesheet days move to that person and the pending name is retired.
--    If that person already has a timesheet line on the same day (a CLASH), both lines are kept and the
--    approver resolves it: keep one or the other, amend it if needed; the other line is then removed.
-- 4. Who added the name, when, and who approved or paired it and when, are kept on the person for reporting.

alter table public.people
  add column if not exists pending boolean not null default false,
  add column if not exists added_phone_id uuid references public.work_phones(id) on delete set null,
  add column if not exists added_at timestamptz,
  add column if not exists added_by uuid,
  add column if not exists review_outcome text check (review_outcome in ('approved', 'paired')),
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_by_name text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists paired_to uuid references public.people(id) on delete set null;
create index if not exists people_pending_idx on public.people(pending) where pending;

-- a clash: the new driver's line for a day the matched person already has. Points at that person's own line.
alter table public.timesheet_lines
  add column if not exists clash_with uuid references public.timesheet_lines(id) on delete set null,
  add column if not exists clash_from text;      -- the name the new driver sent it under
create index if not exists timesheet_lines_clash_idx on public.timesheet_lines(clash_with) where clash_with is not null;

-- the day's line is worked out from the dockets as before, but a clash line is never picked or changed by it
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

  -- a line waiting for a clash to be resolved is left alone (the approver decides)
  select * into l from public.timesheet_lines where person_id = p_person and work_date = p_day and clash_with is null order by created_at limit 1;
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


-- surname: the last word of the name, ignoring a nickname in brackets ("Simon Ennor (Tank)" -> "ennor")
create or replace function public.surname(p_name text) returns text
language sql immutable set search_path = public as $$
  select lower((regexp_split_to_array(trim(regexp_replace(coalesce(p_name, ''), '\([^)]*\)', '', 'g')), '\s+'))[
    array_length(regexp_split_to_array(trim(regexp_replace(coalesce(p_name, ''), '\([^)]*\)', '', 'g')), '\s+'), 1)])
$$;

-- the signed-in login's name, for "approved by"
create or replace function public.my_login_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(l.label, l.email, l.phone) from public.app_logins l
                   where l.active is not false and (
                     (l.email is not null and lower(l.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
                     or (l.phone is not null and public.norm_phone(l.phone) = public.norm_phone(coalesce(auth.jwt() ->> 'phone', ''))))
                   order by l.person_id nulls first limit 1),
                  auth.jwt() ->> 'email', auth.jwt() ->> 'phone')
$$;

-- ---------- 1. a driver adds their own name on a crew phone ----------
create or replace function public.add_pending_driver(p_full_name text) returns public.people
language plpgsql security definer set search_path = public as $$
declare v_name text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g'); v_phone uuid; v_person public.people;
begin
  if not public.has_access() then raise exception 'Sign in first.' using errcode = '42501'; end if;
  v_phone := (public.my_phone_ids())[1];
  if v_phone is null then raise exception 'Only a crew phone can add a new driver.' using errcode = '42501'; end if;
  if length(v_name) < 3 or length(v_name) > 80 or v_name !~ '\S+\s+\S+' then
    raise exception 'Type your first name and surname.' using errcode = '22023';
  end if;
  if exists (select 1 from public.people where lower(full_name) = lower(v_name) and active is not false and not pending) then
    raise exception '% is already a driver. Tap "I am a cover driver" and pick your name.', v_name using errcode = '23505';
  end if;
  select * into v_person from public.people where lower(full_name) = lower(v_name) and pending and added_phone_id = v_phone limit 1;
  if found then return v_person; end if;    -- added already on this phone (e.g. tapped twice)
  insert into public.people(full_name, is_driver, active, pending, added_phone_id, added_at, added_by, notes)
  values (v_name, true, true, true, v_phone, now(), auth.uid(), 'Added on a crew phone. Waiting for a supervisor to check.')
  returning * into v_person;
  insert into public.phone_assignments(work_phone_id, person_id) values (v_phone, v_person.id);
  return v_person;
end $$;
revoke execute on function public.add_pending_driver(text) from public, anon;
grant execute on function public.add_pending_driver(text) to authenticated;

-- ---------- 2. a pending driver's days cannot be approved until they are checked ----------
create or replace function public.pending_line_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
     and exists (select 1 from public.people where id = new.person_id and pending) then
    raise exception 'This is a new driver waiting to be checked. Approve them as a new driver, or pair their hours to an existing driver, first.' using errcode = '42501';
  end if;
  if new.status = 'approved' and old.status is distinct from 'approved'
     and (new.clash_with is not null or exists (select 1 from public.timesheet_lines c where c.clash_with = new.id)) then
    raise exception 'This day has two timesheet lines (a new driver''s hours were paired to this driver). Resolve the clash first.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists t_ts_pending_guard on public.timesheet_lines;
create trigger t_ts_pending_guard before update on public.timesheet_lines for each row execute function public.pending_line_guard();
revoke execute on function public.pending_line_guard() from public, anon, authenticated;

-- shared checks for 3a and 3b
create or replace function public.pending_ready(p_person uuid) returns public.people
language plpgsql stable security definer set search_path = public as $$
declare v public.people;
begin
  if not public.can_edit('approvals') then
    raise exception 'Only people who approve timesheets can check a new driver.' using errcode = '42501';
  end if;
  select * into v from public.people where id = p_person;
  if not found or not v.pending then raise exception 'This driver is not waiting to be checked.' using errcode = '22023'; end if;
  if not exists (select 1 from public.timesheet_lines where person_id = p_person and status = 'submitted') then
    raise exception '% has not sent a timesheet yet. Check them once they send it.', v.full_name using errcode = '22023';
  end if;
  return v;
end $$;
revoke execute on function public.pending_ready(uuid) from public, anon, authenticated;

-- ---------- 3a. approve as a new driver ----------
create or replace function public.approve_pending_driver(p_person uuid) returns public.people
language plpgsql security definer set search_path = public as $$
declare v public.people;
begin
  perform public.pending_ready(p_person);
  update public.people set pending = false, review_outcome = 'approved', reviewed_by = auth.uid(),
         reviewed_by_name = public.my_login_name(), reviewed_at = now(), notes = 'Added on a crew phone. Approved as a new driver.'
  where id = p_person returning * into v;
  return v;
end $$;
revoke execute on function public.approve_pending_driver(uuid) from public, anon;
grant execute on function public.approve_pending_driver(uuid) to authenticated;

-- ---------- 3b. pair the hours to an existing driver with the same surname ----------
create or replace function public.pair_pending_driver(p_person uuid, p_target uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v public.people; t public.people; v_by uuid := auth.uid(); v_by_name text := public.my_login_name();
  v_claims text := current_setting('request.jwt.claims', true); v_sub text := current_setting('request.jwt.claim.sub', true);
  l record; v_days int := 0;
begin
  v := public.pending_ready(p_person);
  select * into t from public.people where id = p_target;
  if not found or t.pending or t.active is false or t.id = p_person then
    raise exception 'Pick an active driver to pair the hours to.' using errcode = '22023';
  end if;
  if public.surname(t.full_name) <> public.surname(v.full_name) then
    raise exception 'Hours can only be paired to someone with the same surname as %.', v.full_name using errcode = '22023';
  end if;
  if exists (select 1 from public.timesheet_lines where person_id = p_person and status = 'approved') then
    raise exception 'Some of %''s days are already approved. Ask an admin to reopen them first.', v.full_name using errcode = '22023';
  end if;

  -- the moves below are done by the database itself (no per-docket permission checks), as one change
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);

  -- timesheet days move to the person. If they already have that day, both lines are kept as a clash
  -- for the approver to resolve (keep one, amend it if needed).
  for l in select * from public.timesheet_lines where person_id = p_person loop
    update public.timesheet_lines set person_id = p_target,
      driver_comment = trim(both ' ' from coalesce(driver_comment, '') || ' (Sent as ' || v.full_name || ')'),
      clash_with = (select x.id from public.timesheet_lines x where x.person_id = p_target and x.work_date = l.work_date and x.id <> l.id and x.clash_with is null
                    order by x.created_at limit 1),
      clash_from = v.full_name
    where id = l.id;
    v_days := v_days + 1;
  end loop;
  update public.timesheet_lines set clash_from = null where person_id = p_target and clash_with is null and clash_from = v.full_name;
  -- the fortnight timesheet sheet
  update public.form_submissions s set person_id = p_target
  where s.person_id = p_person and s.status <> 'approved'
    and not exists (select 1 from public.form_submissions x where x.person_id = p_target and x.form_type = s.form_type and x.period_start is not distinct from s.period_start);
  -- shifts and dockets (this recalculates the person's timesheet days from the dockets)
  update public.shifts set driver_id = p_target where driver_id = p_person;
  update public.dockets d set
    assigned_person_ids = array_replace(d.assigned_person_ids, p_person, p_target),
    extras = d.extras
      || case when d.extras ->> 's1_operator_id' = p_person::text then jsonb_build_object('s1_operator_id', p_target::text) else '{}'::jsonb end
      || case when d.extras ->> 's2_operator_id' = p_person::text then jsonb_build_object('s2_operator_id', p_target::text) else '{}'::jsonb end
  where p_person = any(d.assigned_person_ids) or d.extras ->> 's1_operator_id' = p_person::text or d.extras ->> 's2_operator_id' = p_person::text;
  -- the crew phone: the matched person now shares it
  insert into public.phone_assignments(work_phone_id, person_id)
  select a.work_phone_id, p_target from public.phone_assignments a
  where a.person_id = p_person and not exists (select 1 from public.phone_assignments b where b.work_phone_id = a.work_phone_id and b.person_id = p_target);
  delete from public.phone_assignments where person_id = p_person;
  -- retire the pending name, keeping the record of what happened
  update public.people set pending = false, active = false, review_outcome = 'paired', paired_to = p_target,
         reviewed_by = v_by, reviewed_by_name = v_by_name, reviewed_at = now(),
         notes = 'Added on a crew phone. Hours paired to ' || t.full_name || '.'
  where id = p_person;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true); perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_days;
end $$;
revoke execute on function public.pair_pending_driver(uuid, uuid) from public, anon;
grant execute on function public.pair_pending_driver(uuid, uuid) to authenticated;

-- ---------- 4. resolve a clash: keep one line (amended if needed), remove the other ----------
create or replace function public.resolve_timesheet_clash(p_keep uuid, p_remove uuid, p_total_hours numeric default null,
                                                          p_work_diary_page text default null, p_comment text default null) returns public.timesheet_lines
language plpgsql security definer set search_path = public as $$
declare k public.timesheet_lines; r public.timesheet_lines;
begin
  if not public.can_edit('approvals') then
    raise exception 'Only people who approve timesheets can resolve a clash.' using errcode = '42501';
  end if;
  select * into k from public.timesheet_lines where id = p_keep;
  select * into r from public.timesheet_lines where id = p_remove;
  if k.id is null or r.id is null or not (k.clash_with = r.id or r.clash_with = k.id) then
    raise exception 'These two lines are not a clash.' using errcode = '22023';
  end if;
  if k.status = 'approved' or r.status = 'approved' then
    raise exception 'One of these lines is already approved. Ask an admin to reopen it first.' using errcode = '22023';
  end if;
  delete from public.timesheet_lines where id = r.id;
  update public.timesheet_lines set clash_with = null, clash_from = null,
    total_hours = coalesce(p_total_hours, total_hours),
    travel_hours = case when p_total_hours is null then travel_hours else round(greatest(p_total_hours - coalesce(docket_hours, 0), 0), 2) end,
    hours_edited = hours_edited or p_total_hours is not null,
    work_diary_page = coalesce(nullif(p_work_diary_page, ''), work_diary_page),
    supervisor_comment = coalesce(nullif(p_comment, ''), supervisor_comment)
  where id = k.id returning * into k;
  return k;
end $$;
revoke execute on function public.resolve_timesheet_clash(uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.resolve_timesheet_clash(uuid, uuid, numeric, text, text) to authenticated;
