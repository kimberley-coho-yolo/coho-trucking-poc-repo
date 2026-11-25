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
select pg_temp.check((select value::int from public.app_settings where id = 'timesheet_week_start') = 3, 'timesheet weeks start on Wednesday by default');
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
update public.app_settings set value = '3' where id = 'timesheet_week_start';
reset role;

-- a 30 hour docket (Mon 06:00 to Tue 12:00, Queensland) for Jo: split across the two days
insert into public.dockets(id, form_type, status, assigned_person_ids, start_at, end_at)
values ('99999999-0000-0000-0000-000000000010', 'general', 'closed', array['44444444-0000-0000-0000-000000000003']::uuid[],
        '2026-11-23 06:00+10', '2026-11-24 12:00+10');
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-23')).total_hours = 18, 'over 24 h: first day gets 18 hours (to midnight)');
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-24')).total_hours = 12, 'second day gets the other 12 hours');
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-24')).over_24h, 'both days are flagged over 24 hours');
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-23')).split_note like 'Part of a 30.0 h shift%', 'the line says which shift it is part of');

-- shortened to 20 hours: no longer over 24 h, all hours back on the first day, the second day's line goes
update public.dockets set end_at = '2026-11-24 02:00+10' where id = '99999999-0000-0000-0000-000000000010';
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-23')).total_hours = 20 and not (pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-23')).over_24h, 'a 20 hour shift stays on its first day');
select pg_temp.check((select count(*) from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000003' and work_date = '2026-11-24') = 0, 'the second day''s untouched line is removed');

-- ticked "over 24 hours" on a 20 hour docket: split at midnight anyway
update public.dockets set over_24h = true where id = '99999999-0000-0000-0000-000000000010';
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-23')).total_hours = 18 and (pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-24')).total_hours = 2, 'ticking over 24 hours splits at midnight');

-- a normal night shift (18:00 to 06:00) is not split
insert into public.dockets(id, form_type, status, assigned_person_ids, start_at, end_at)
values ('99999999-0000-0000-0000-000000000011', 'general', 'closed', array['44444444-0000-0000-0000-000000000003']::uuid[], '2026-11-26 18:00+10', '2026-11-27 06:00+10');
select pg_temp.check((pg_temp.line('44444444-0000-0000-0000-000000000003', '2026-11-26')).total_hours = 12, 'night shift stays on the day it started');
select pg_temp.check((select count(*) from public.timesheet_lines where person_id = '44444444-0000-0000-0000-000000000003' and work_date = '2026-11-27') = 0, 'and adds nothing to the next day');
