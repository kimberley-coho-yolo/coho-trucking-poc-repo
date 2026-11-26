-- Tests: timesheet settings and shifts over 24 hours.
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function pg_temp.as_user(sub text, claims text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', sub, false); perform set_config('request.jwt.claims', claims, false); end $$;
create or replace function pg_temp.line(p uuid, d date) returns public.timesheet_lines language sql as $$
  select * from public.timesheet_lines where person_id = p and work_date = d order by created_at limit 1 $$;
delete from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000003';

-- settings: everyone reads, only admin (settings) changes
select pg_temp.check((select value::int from public.app_settings where id = 'timesheet_week_start') = 1, 'timesheet weeks start on Monday by default');
select pg_temp.check((select value #>> '{}' from public.app_settings where id = 'timesheet_cycle_anchor') = '2026-11-09', 'fortnights repeat from Monday 9 Nov 2026 (9-22 Nov, 23 Nov-6 Dec)');
select pg_temp.check((select value #>> '{}' from public.app_settings where id = 'timesheet_default_view') = 'fortnight', 'fortnight view by default');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000007', '{"phone":"61400000002"}');
set role authenticated;
select pg_temp.check((select count(*) from public.app_settings) >= 3, 'drivers can read the settings');
do $$ begin
  update public.app_settings set value = '4' where id = 'timesheet_week_start';
  if found then raise exception 'FAIL: driver changed a setting'; end if;
  raise notice 'ok - drivers cannot change settings';
end $$;
reset role;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000009', '{"email":"boss@example.com"}');
set role authenticated;
update public.app_settings set value = '4' where id = 'timesheet_week_start';
select pg_temp.check((select value::int from public.app_settings where id = 'timesheet_week_start') = 4, 'admin can change the start day (Thursday)');
update public.app_settings set value = '1' where id = 'timesheet_week_start';
reset role;

-- a 30 hour docket (Mon 06:00 to Tue 12:00, Queensland) for Jo: split across the two days
insert into public.dockets(id, form_type, status, assigned_person_ids, start_at, end_at)
values ('99999999-0000-0000-0000-000000000010', 'general', 'closed', array['44444444-0000-0000-0000-000000000003']::uuid[],
        '2026-11-23 06:00+10', '2026-11-24 12:00+10');
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-23')).total_hours = 18, 'over 24 h: first day gets 18 hours (to midnight)');
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-24')).total_hours = 12, 'second day gets the other 12 hours');
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-24')).over_24h, 'both days are flagged over 24 hours');
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-23')).split_note like 'Part of a 30.0 h shift%', 'the line says which shift it is part of');

-- shortened to 20 hours: no longer over 24 h, but its hours still stay on the day worked (18 + 2), not flagged 24 h+
update public.dockets set end_at = '2026-11-24 02:00+10' where id = '99999999-0000-0000-0000-000000000010';
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-23')).total_hours = 18 and not (pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-23')).over_24h, 'a 20 hour shift: 18 hours on its first day, not flagged');
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-24')).total_hours = 2, 'and 2 hours on the day after midnight');
-- shortened to end at 22:00 the same day: the second day's untouched line is removed
update public.dockets set end_at = '2026-11-23 22:00+10' where id = '99999999-0000-0000-0000-000000000010';
select pg_temp.check((select count(*) from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000003' and work_date = '2026-11-24') = 0, 'the second day''s untouched line is removed');
update public.dockets set end_at = '2026-11-24 02:00+10' where id = '99999999-0000-0000-0000-000000000010';

-- ticked "over 24 hours" on a 20 hour docket: split at midnight anyway
update public.dockets set over_24h = true where id = '99999999-0000-0000-0000-000000000010';
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-23')).total_hours = 18 and (pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-24')).total_hours = 2, 'ticking over 24 hours splits at midnight');

-- a normal night shift (18:00 to 06:00): hours stay on the day worked, 6 + 6, not flagged 24 h+ (UAT 26/11/2026)
insert into public.dockets(id, form_type, status, assigned_person_ids, start_at, end_at)
values ('99999999-0000-0000-0000-000000000011', 'general', 'closed', array['44444444-0000-0000-0000-000000000003']::uuid[], '2026-11-26 18:00+10', '2026-11-27 06:00+10');
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-26')).total_hours = 6, 'night shift: 6 hours on the day it started');
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-27')).total_hours = 6, 'and 6 hours on the next day');
select pg_temp.check(not (pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-27')).over_24h, 'a night shift is not flagged 24 h+');
-- longer than 12 hours is not capped: 18:00 to 08:00 is 6 + 8
update public.dockets set end_at = '2026-11-27 08:00+10' where id = '99999999-0000-0000-0000-000000000011';
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-27')).total_hours = 8, 'no 12 hour cap: 8 hours after midnight');
-- two-shift daily report on the night band: 6 + 6
insert into public.dockets(id, form_type, status, work_date, extras)
values ('99999999-0000-0000-0000-000000000012', 'daily_report_drilling', 'closed', '2026-11-29',
        jsonb_build_object('s2_operator_id', '44444444-0000-0000-0000-000000000003', 's2_band', '18:00 to 06:00'));
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-29')).total_hours = 6
                 and (pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-30')).total_hours = 6, 'two-shift report night band: 6 + 6');
delete from public.dockets where id = '99999999-0000-0000-0000-000000000012';
select pg_temp.check((select count(*) from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000003' and work_date in ('2026-11-29', '2026-11-30')) = 0, 'removing it removes both days');

-- Two-shift daily reports where each operator signs their own shift (as in the trial week). The docket sits on the DAY operator's
-- shift; the night operator must get only their own shift time on each day, never the day operator's (bug fixed 26/11/2026).
-- Sam (002) works days, Jo (003) works nights, reports for 2 and 3 Dec.
delete from public.timesheet_lines where person_id in ('44444444-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000003') and work_date between '2026-12-01' and '2026-12-05';
insert into public.shifts(id, status, shift_date, day_night, driver_id, sign_in_at, sign_out_at) values
  ('99999999-0000-0000-0000-000000000021', 'submitted', '2026-12-02', 'Day',   '44444444-0000-0000-0000-000000000002', '2026-12-02 05:45+10', '2026-12-02 18:15+10'),
  ('99999999-0000-0000-0000-000000000022', 'submitted', '2026-12-03', 'Day',   '44444444-0000-0000-0000-000000000002', '2026-12-03 05:45+10', '2026-12-03 18:15+10'),
  ('99999999-0000-0000-0000-000000000023', 'submitted', '2026-12-02', 'Night', '44444444-0000-0000-0000-000000000003', '2026-12-02 17:45+10', '2026-12-03 06:15+10'),
  ('99999999-0000-0000-0000-000000000024', 'submitted', '2026-12-03', 'Night', '44444444-0000-0000-0000-000000000003', '2026-12-03 17:45+10', '2026-12-04 06:15+10');
insert into public.dockets(id, form_type, status, work_date, shift_id, start_at, end_at, extras) values
  ('99999999-0000-0000-0000-000000000031', 'daily_report_drilling', 'closed', '2026-12-02', '99999999-0000-0000-0000-000000000021', '2026-12-02 06:00+10', '2026-12-03 06:00+10',
   jsonb_build_object('s1_operator_id', '44444444-0000-0000-0000-000000000002', 's1_band', '06:00 to 18:00', 's2_operator_id', '44444444-0000-0000-0000-000000000003', 's2_band', '18:00 to 06:00')),
  ('99999999-0000-0000-0000-000000000032', 'daily_report_drilling', 'closed', '2026-12-03', '99999999-0000-0000-0000-000000000022', '2026-12-03 06:00+10', '2026-12-04 06:00+10',
   jsonb_build_object('s1_operator_id', '44444444-0000-0000-0000-000000000002', 's1_band', '06:00 to 18:00', 's2_operator_id', '44444444-0000-0000-0000-000000000003', 's2_band', '18:00 to 06:00'));
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-12-03')).total_hours = 12.5
                 and (pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-12-03')).docket_hours = 12,
  'night operator on a two-shift report: own shift time only (6.25 + 6.25), not the day operator''s');
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-12-02')).total_hours = 6.25, 'first night: 6.25 h before midnight');
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-12-04')).total_hours = 6.25, 'last morning: 6.25 h after midnight');
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000002', '2026-12-03')).total_hours = 12.5, 'day operator: own 12.5 h shift');
delete from public.dockets where id in ('99999999-0000-0000-0000-000000000031', '99999999-0000-0000-0000-000000000032');
delete from public.shifts where id::text like '99999999-0000-0000-0000-00000000002%';
