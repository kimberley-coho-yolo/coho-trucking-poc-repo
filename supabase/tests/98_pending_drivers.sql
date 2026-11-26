-- Tests: a new driver added on a crew phone, flagged, then approved or paired to a same-surname driver.
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function pg_temp.as_user(sub text, claims text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', sub, false); perform set_config('request.jwt.claims', claims, false); end $$;
insert into public.app_logins(label, email, role) values ('Pay office', 'pay@example.com', 'office') on conflict do nothing;
insert into public.people(id, full_name, department) values ('77777777-0000-0000-0000-000000000010', 'Robert Nguyen', 'Drilling');

select pg_temp.check(public.surname('Simon Ennor (Tank)') = 'ennor' and public.surname(' Bob  Nguyen ') = 'nguyen', 'surname ignores spaces and nicknames');

-- on crew phone 1 a driver adds himself
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003', '{"phone":"61400000001"}');
set role authenticated;
do $$ begin
  begin perform public.add_pending_driver('Bob'); raise exception 'FAIL: one name accepted';
  exception when invalid_parameter_value then raise notice 'ok - a first name and surname are needed'; end;
  begin perform public.add_pending_driver('Alex Driver'); raise exception 'FAIL: duplicate accepted';
  exception when unique_violation then raise notice 'ok - an existing driver''s exact name is refused (use cover driver)'; end;
end $$;
select set_config('t.bob', (public.add_pending_driver('  Bob   Nguyen ')).id::text, false);
select pg_temp.check((select full_name = 'Bob Nguyen' and pending and added_phone_id = '55555555-0000-0000-0000-000000000001' from public.people where id = current_setting('t.bob')::uuid), 'the new name is added as pending on that crew phone');
select pg_temp.check((public.add_pending_driver('bob nguyen')).id = current_setting('t.bob')::uuid, 'adding the same name twice gives the same person');
select pg_temp.check(current_setting('t.bob')::uuid in (select id from public.people_for_my_phone()), 'the crew phone now lists Bob');
reset role;
-- a crew phone is needed
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000006', '{"email":"pay@example.com"}');
set role authenticated;
do $$ begin
  begin perform public.add_pending_driver('Someone Else'); raise exception 'FAIL: added from an office login';
  exception when insufficient_privilege then raise notice 'ok - only a crew phone can add a new driver'; end;
end $$;
reset role;

-- Bob works: a docket on his shift creates his timesheet day; he sends it
insert into public.shifts(id, status, shift_date, day_night, driver_id, sign_in_at, sign_out_at)
values ('99999999-0000-0000-0000-000000000098', 'submitted', '2026-11-20', 'Day', current_setting('t.bob')::uuid, '2026-11-20 05:45+10', '2026-11-20 18:15+10');
insert into public.dockets(id, status, shift_id, form_type, work_date, start_at, end_at, assigned_person_ids)
values ('99999999-0000-0000-0000-000000000099', 'closed', '99999999-0000-0000-0000-000000000098', 'potable_water', '2026-11-20', '2026-11-20 06:00+10', '2026-11-20 18:00+10', array[current_setting('t.bob')::uuid]);
update public.timesheet_lines set status = 'submitted', work_diary_page = '12' where person_id = current_setting('t.bob')::uuid;
select pg_temp.check((select count(*) from public.timesheet_lines where person_id = current_setting('t.bob')::uuid and status = 'submitted') = 1, 'the new driver''s docket fills in his timesheet');

-- Robert already has a timesheet line for the same day: a clash
insert into public.timesheet_lines(id, person_id, work_date, status, total_hours, work_diary_page)
values ('88888888-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000010', '2026-11-20', 'submitted', 10, '7');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000006', '{"email":"pay@example.com"}');
set role authenticated;
do $$ begin
  begin update public.timesheet_lines set status = 'approved' where person_id = current_setting('t.bob')::uuid;
    raise exception 'FAIL: pending driver approved';
  exception when insufficient_privilege then raise notice 'ok - a pending driver''s days cannot be approved before he is checked'; end;
  begin perform public.pair_pending_driver(current_setting('t.bob')::uuid, '44444444-0000-0000-0000-000000000001');
    raise exception 'FAIL: paired to a different surname';
  exception when invalid_parameter_value then raise notice 'ok - hours only pair to the same surname'; end;
end $$;
-- pair Bob's hours to Robert Nguyen
select pg_temp.check(public.pair_pending_driver(current_setting('t.bob')::uuid, '77777777-0000-0000-0000-000000000010') = 1, 'pairing moves one timesheet day');
reset role;
select pg_temp.check((select person_id = '77777777-0000-0000-0000-000000000010' and status = 'submitted' and work_diary_page = '12' from public.timesheet_lines where work_date = '2026-11-20' and driver_comment like '%Bob Nguyen%'),
  'the day, its status and what the driver typed move to Robert');
select pg_temp.check((select driver_id from public.shifts where id = '99999999-0000-0000-0000-000000000098') = '77777777-0000-0000-0000-000000000010'
  and (select assigned_person_ids from public.dockets where id = '99999999-0000-0000-0000-000000000099') = array['77777777-0000-0000-0000-000000000010'::uuid], 'the shift and docket move to Robert');
select pg_temp.check((select not pending and not active and review_outcome = 'paired' and paired_to = '77777777-0000-0000-0000-000000000010' and reviewed_by_name = 'Pay office' and reviewed_at is not null
  from public.people where id = current_setting('t.bob')::uuid), 'the pending name is retired, with who paired it and when');
select pg_temp.check(exists (select 1 from public.phone_assignments where work_phone_id = '55555555-0000-0000-0000-000000000001' and person_id = '77777777-0000-0000-0000-000000000010')
  and not exists (select 1 from public.phone_assignments where person_id = current_setting('t.bob')::uuid), 'Robert now shares the crew phone instead of the pending name');

-- the clash: both lines kept for the approver, neither can be approved until it is resolved
select pg_temp.check((select count(*) from public.timesheet_lines where person_id = '77777777-0000-0000-0000-000000000010' and work_date = '2026-11-20') = 2
  and (select clash_with = '88888888-0000-0000-0000-000000000001' and clash_from = 'Bob Nguyen' from public.timesheet_lines where driver_comment like '%Bob Nguyen%'),
  'a clash day keeps both lines, the new one pointing at the existing one');
select pg_temp.check((select total_hours = 10 and work_diary_page = '7' from public.timesheet_lines where id = '88888888-0000-0000-0000-000000000001'), 'the existing line is left as it was');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000006', '{"email":"pay@example.com"}');
set role authenticated;
do $$ begin
  begin update public.timesheet_lines set status = 'approved' where id = '88888888-0000-0000-0000-000000000001';
    raise exception 'FAIL: clash day approved';
  exception when insufficient_privilege then raise notice 'ok - a clash day cannot be approved until it is resolved'; end;
end $$;
-- keep the new driver's line, amended to 11.5 hours
select set_config('t.bobline', (select id::text from public.timesheet_lines where driver_comment like '%Bob Nguyen%'), false);
select pg_temp.check((public.resolve_timesheet_clash(current_setting('t.bobline')::uuid, '88888888-0000-0000-0000-000000000001', 11.5, null, 'Kept Bob''s day')).total_hours = 11.5,
  'the approver keeps one line and amends its hours');
update public.timesheet_lines set status = 'approved' where id = current_setting('t.bobline')::uuid;
reset role;
select pg_temp.check((select count(*) from public.timesheet_lines where person_id = '77777777-0000-0000-0000-000000000010' and work_date = '2026-11-20') = 1
  and (select clash_with is null and hours_edited and status = 'approved' and work_diary_page = '12' and supervisor_comment = 'Kept Bob''s day' from public.timesheet_lines where id = current_setting('t.bobline')::uuid),
  'the other line is removed, and the kept day can then be approved');

-- a second new driver with no match is approved as new, once he has sent his timesheet
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003', '{"phone":"61400000001"}');
set role authenticated;
select set_config('t.kim', (public.add_pending_driver('Kim Quinlan')).id::text, false);
reset role;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000006', '{"email":"pay@example.com"}');
set role authenticated;
do $$ begin
  begin perform public.approve_pending_driver(current_setting('t.kim')::uuid); raise exception 'FAIL: approved before a timesheet was sent';
  exception when invalid_parameter_value then raise notice 'ok - checked only once the timesheet is sent'; end;
end $$;
reset role;
insert into public.timesheet_lines(person_id, work_date, status, total_hours) values (current_setting('t.kim')::uuid, '2026-11-21', 'submitted', 12);
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003', '{"phone":"61400000001"}');
set role authenticated;
do $$ begin
  begin perform public.approve_pending_driver(current_setting('t.kim')::uuid); raise exception 'FAIL: driver approved a new driver';
  exception when insufficient_privilege then raise notice 'ok - only timesheet approvers can approve a new driver'; end;
end $$;
reset role;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000006', '{"email":"pay@example.com"}');
set role authenticated;
select pg_temp.check((public.approve_pending_driver(current_setting('t.kim')::uuid)).review_outcome = 'approved', 'an approver approves the new driver');
update public.timesheet_lines set status = 'approved' where person_id = current_setting('t.kim')::uuid;
reset role;
select pg_temp.check((select not pending and active and reviewed_by_name = 'Pay office' from public.people where id = current_setting('t.kim')::uuid)
  and (select status from public.timesheet_lines where person_id = current_setting('t.kim')::uuid) = 'approved', 'once approved, his days can be approved');
