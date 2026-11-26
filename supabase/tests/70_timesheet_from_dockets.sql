-- Tests: timesheet lines fill themselves in from dockets.
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function pg_temp.as_user(sub text, claims text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', sub, false); perform set_config('request.jwt.claims', claims, false); end $$;
-- Sam Driver: 44444444-...-0002 (crew phone 1). Jo Cover: ...-0003 (crew phone 2).
delete from public.timesheet_lines where person_id in ('44444444-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000003');

-- the office prepares a landspray runsheet for Sam: not started yet, so no timesheet line
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000006', '{"email":"office@example.com"}');
set role authenticated;
insert into public.dockets(id, form_type, status, work_date, truck_id, location_id, assigned_person_ids, extras)
values ('99999999-0000-0000-0000-000000000001', 'landspray_runsheet', 'draft', '2026-11-20', '33333333-0000-0000-0000-000000000087',
        '22222222-0000-0000-0000-000000000001', array['44444444-0000-0000-0000-000000000002']::uuid[], '{"shift_band":"6am - 6pm DAY Shift"}');
reset role;
select pg_temp.check((select count(*) from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000002' and work_date = '2026-11-20') = 0, 'a docket not started yet adds nothing');

-- Sam starts it on the crew phone (start time), then closes it: the line appears, then has the hours
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003', '{"phone":"61400000001"}');
set role authenticated;
update public.dockets set status = 'open', start_at = '2026-11-20 06:00+10', version = 1 where id = '99999999-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000002' and work_date = '2026-11-20') = 1, 'starting the docket starts the timesheet line');
select pg_temp.check((select shift_band = '06:00 to 18:00' and truck_id = '33333333-0000-0000-0000-000000000087' from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000002' and work_date = '2026-11-20'), 'shift times and unit come from the docket');
update public.dockets set status = 'closed', end_at = '2026-11-20 17:30+10', standby_minutes = 30, version = 2 where id = '99999999-0000-0000-0000-000000000001';
select pg_temp.check((select docket_hours = 11.5 and total_hours = 11.5 and standby_hours = 0.5 and location is not null from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000002' and work_date = '2026-11-20'), 'closing the docket fills in hours, standby and rig');
-- Sam can see the line even though it was made by the database
select pg_temp.check((select count(*) from public.timesheet_lines where work_date = '2026-11-20') = 1, 'the driver sees their line');
-- Sam types his own hours: later docket changes keep them
update public.timesheet_lines set total_hours = 12, hours_edited = true, work_diary_page = '508117' where person_id = '44444444-0000-0000-0000-000000000002' and work_date = '2026-11-20';
update public.dockets set end_at = '2026-11-20 17:00+10', version = 3 where id = '99999999-0000-0000-0000-000000000001';
select pg_temp.check((select total_hours = 12 and docket_hours = 11 from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000002' and work_date = '2026-11-20'), 'hours the driver typed are kept; docket hours still update');
reset role;

-- a two-shift daily report gives each shift's operator 12 hours, standby and truck and dog
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000006', '{"email":"office@example.com"}');
set role authenticated;
insert into public.dockets(id, form_type, status, work_date, truck_id, extras)
values ('99999999-0000-0000-0000-000000000002', 'daily_report_drilling', 'closed', '2026-11-19', '33333333-0000-0000-0000-000000000087',
        '{"s1_operator_id":"44444444-0000-0000-0000-000000000002","s1_band":"06:00 to 18:00","s1_truck_config":"Dog",
          "s2_operator_id":"44444444-0000-0000-0000-000000000003","s2_band":"18:00 to 06:00","s2_standby_hours":12}');
reset role;
select pg_temp.check((select total_hours = 12 and with_dog and shift_band = '06:00 to 18:00' from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000002' and work_date = '2026-11-19'), 'shift 1 operator: 12 hours, truck and dog');
select pg_temp.check((select total_hours = 6 and standby_hours = 12 and shift_band = '18:00 to 06:00' from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000003' and work_date = '2026-11-19'), 'shift 2 operator (night): 6 hours on the day it starts, with standby');
select pg_temp.check((select total_hours = 6 and standby_hours is null from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000003' and work_date = '2026-11-20'), 'and 6 hours on the next day');

-- the office moves shift 2 to Sam: Jo's untouched line goes, Sam now has both shifts' dockets counted
update public.dockets set extras = extras || '{"s2_operator_id":"44444444-0000-0000-0000-000000000002"}' where id = '99999999-0000-0000-0000-000000000002';
select pg_temp.check((select count(*) from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000003' and work_date = '2026-11-19') = 0, 'reassigning removes the old driver''s untouched line');
select pg_temp.check((select total_hours from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000002' and work_date = '2026-11-19') = 18, 'and adds the hours to the new driver (12 day + 6 of the night)');
select pg_temp.check((select count(*) from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000003' and work_date = '2026-11-20') = 0, 'the old driver''s next-day line goes too');

-- a submitted line is never changed by later docket edits
update public.timesheet_lines set status = 'submitted' where person_id = '44444444-0000-0000-0000-000000000002' and work_date = '2026-11-19';
update public.dockets set extras = extras - 's2_operator_id' where id = '99999999-0000-0000-0000-000000000002';
select pg_temp.check((select total_hours from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000002' and work_date = '2026-11-19') = 18, 'submitted lines are left alone');

-- a bad value in the form JSON never stops the docket saving
update public.dockets set extras = extras || '{"s1_operator_id":"not-a-uuid"}' where id = '99999999-0000-0000-0000-000000000002';
select pg_temp.check(true, 'bad operator value does not break the save');
