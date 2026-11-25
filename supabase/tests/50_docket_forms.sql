-- Tests: office creates dockets, assigns them to drivers, version check stops silent overwrites.
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function pg_temp.as_user(sub text, claims text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', sub, false); perform set_config('request.jwt.claims', claims, false); end $$;

-- set-up as the database owner: a second crew phone used only by Jo Cover
insert into public.work_phones(id, phone, label) values ('55555555-0000-0000-0000-000000000002', '0400 000 002', 'Crew phone 2');
insert into public.phone_assignments(work_phone_id, person_id) values ('55555555-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000003');
insert into public.app_logins(label, phone, role) values ('Crew phone 2', '0400 000 002', 'driver');

-- office creates two dockets: one for Alex, one for nobody yet
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000006', '{"email":"office@example.com"}');
set role authenticated;
insert into public.dockets(id, form_type, status, work_date, truck_id, assigned_person_ids, notes)
values ('77777777-0000-0000-0000-000000000001', 'landspray_runsheet', 'draft', current_date, '33333333-0000-0000-0000-000000000087',
        array['44444444-0000-0000-0000-000000000001']::uuid[], 'from the office'),
       ('77777777-0000-0000-0000-000000000002', 'potable_water', 'draft', current_date, null, '{}', 'not assigned');
insert into public.loads(docket_id, material, volume_in_l, extras) values ('77777777-0000-0000-0000-000000000001', 'Dirty mud', 8000, '{"sprayfield":"MMP4"}');
select pg_temp.check((select docket_no from public.dockets where id = '77777777-0000-0000-0000-000000000001') >= 100001, 'new dockets get a docket number');
select pg_temp.check((select version from public.dockets where id = '77777777-0000-0000-0000-000000000001') = 1, 'new docket starts at version 1');
reset role;

-- Alex's crew phone sees the assigned docket and its loads, but not the unassigned one
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003', '{"phone":"61400000001"}');
set role authenticated;
select pg_temp.check('44444444-0000-0000-0000-000000000001' = any(public.my_person_ids()), 'crew phone resolves to its drivers');
select pg_temp.check((select count(*) from public.dockets where id = '77777777-0000-0000-0000-000000000001') = 1, 'assigned driver sees the office docket');
select pg_temp.check((select count(*) from public.dockets where id = '77777777-0000-0000-0000-000000000002') = 0, 'driver does not see an unassigned office docket');
select pg_temp.check((select count(*) from public.loads where docket_id = '77777777-0000-0000-0000-000000000001') = 1, 'assigned driver sees the docket rows');
-- the driver fills it in (sends back version 1)
update public.dockets set notes = 'driver added notes', version = 1 where id = '77777777-0000-0000-0000-000000000001';
select pg_temp.check((select version from public.dockets where id = '77777777-0000-0000-0000-000000000001') = 2, 'a save bumps the version');
select pg_temp.check((select updated_by from public.dockets where id = '77777777-0000-0000-0000-000000000001') = 'aaaaaaaa-0000-0000-0000-000000000003', 'the save records who changed it');
update public.loads set volume_in_l = 9000 where docket_id = '77777777-0000-0000-0000-000000000001';
select pg_temp.check((select volume_in_l from public.loads where docket_id = '77777777-0000-0000-0000-000000000001') = 9000, 'assigned driver can edit the docket rows');
insert into public.loads(docket_id, material) values ('77777777-0000-0000-0000-000000000001', 'Dirty mud');
select pg_temp.check((select count(*) from public.loads where docket_id = '77777777-0000-0000-0000-000000000001') = 2, 'assigned driver can add rows');
reset role;

-- the office copy is now out of date: saving it is refused, not silently overwriting the driver
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000006', '{"email":"office@example.com"}');
set role authenticated;
do $$ begin
  begin update public.dockets set notes = 'stale office edit', version = 1 where id = '77777777-0000-0000-0000-000000000001';
    raise exception 'FAIL: stale save went through';
  exception when serialization_failure then raise notice 'ok - a save from an out-of-date copy is refused';
  end;
end $$;
select pg_temp.check((select notes from public.dockets where id = '77777777-0000-0000-0000-000000000001') = 'driver added notes', 'the driver''s change is kept');
-- updates that do not send a version (km matching) still work
update public.dockets set km = 42 where id = '77777777-0000-0000-0000-000000000001';
select pg_temp.check((select km from public.dockets where id = '77777777-0000-0000-0000-000000000001') = 42, 'km matching can still write km');
reset role;

-- Jo Cover's phone sees neither docket
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000007', '{"phone":"61400000002"}');
set role authenticated;
select pg_temp.check((select count(*) from public.dockets where id in ('77777777-0000-0000-0000-000000000001','77777777-0000-0000-0000-000000000002')) = 0, 'other crew does not see dockets assigned to someone else');
select pg_temp.check((select count(*) from public.loads where docket_id = '77777777-0000-0000-0000-000000000001') = 0, 'other crew does not see those rows');
do $$ begin
  update public.dockets set notes = 'hijack' where id = '77777777-0000-0000-0000-000000000001';
  if found then raise exception 'FAIL: other crew changed the docket'; end if;
  raise notice 'ok - other crew cannot change it';
end $$;
reset role;

-- reassigning to Jo gives Jo access straight away
update public.dockets set assigned_person_ids = array['44444444-0000-0000-0000-000000000003']::uuid[] where id = '77777777-0000-0000-0000-000000000002';
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000007', '{"phone":"61400000002"}');
set role authenticated;
select pg_temp.check((select count(*) from public.dockets where id = '77777777-0000-0000-0000-000000000002') = 1, 'assigning a driver shows the docket on their phone');
reset role;
