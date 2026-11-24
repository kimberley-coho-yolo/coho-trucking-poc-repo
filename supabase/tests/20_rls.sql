\set ON_ERROR_STOP 1
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;
-- run as the authenticated role so row level security applies
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000001","phone":"61400000001"}',false);
insert into public.shifts(shift_date, day_night, truck_id, driver_id) values (current_date,'Night','33333333-0000-0000-0000-000000000004','44444444-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) from public.shifts) = 1, 'driver sees own shift');
select pg_temp.check((select count(*) from public.trucks) = 2, 'driver reads trucks');
do $$ begin
  begin insert into public.trucks(unit_no) values ('99'); raise exception 'FAIL: driver inserted a truck';
  exception when insufficient_privilege then raise notice 'ok - driver cannot add trucks'; end;
end $$;
do $$ begin
  begin perform public.run_select('select 1'); raise exception 'FAIL: driver ran a query';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok - driver cannot use query console'; end;
end $$;
-- another driver login cannot see the first driver's shift
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000002',false);
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000002","phone":"61400000001"}',false);
select pg_temp.check((select count(*) from public.shifts) = 0, 'other login does not see the shift');
-- admin sees everything and can query
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000009',false);
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000009","email":"boss@example.com"}',false);
select pg_temp.check((select count(*) from public.shifts) = 1, 'admin sees all shifts');
select pg_temp.check(jsonb_array_length(public.run_select('select unit_no from trucks order by unit_no')) = 2, 'admin query console returns rows');
do $$ begin
  begin perform public.run_select('delete from trucks'); raise exception 'FAIL: delete allowed';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok - query console refuses delete'; end;
end $$;
-- timesheet lock
insert into public.timesheet_lines(person_id, work_date, status) values ('44444444-0000-0000-0000-000000000001', current_date, 'approved');
reset role;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000001","phone":"61400000001"}',false);
do $$ begin
  begin update public.timesheet_lines set total_hours = 99; raise exception 'FAIL: approved line edited';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok - approved timesheet is locked for non-admin'; end;
end $$;
select pg_temp.check((select count(*) from public.audit_log where table_name='shifts') >= 1, 'audit log records changes');
