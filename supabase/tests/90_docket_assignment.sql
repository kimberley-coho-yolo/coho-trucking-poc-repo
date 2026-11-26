-- Tests: assigning dockets to crew phones, texts, and review of completed dockets.
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function pg_temp.as_user(sub text, claims text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', sub, false); perform set_config('request.jwt.claims', claims, false); end $$;
insert into public.app_logins(label, email, role, departments) values ('Drilling supervisor', 'drillsup@example.com', 'supervisor', array['Drilling']);
delete from public.sms_outbox;

-- the office assigns a Landspray docket to crew phone 2 (no driver picked)
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000006', '{"email":"office@example.com"}');
set role authenticated;
insert into public.dockets(id, form_type, status, department, work_date, assigned_phone_id)
values ('99999999-0000-0000-0000-000000000020', 'landspray_runsheet', 'draft', 'Landspray', '2026-11-25', '55555555-0000-0000-0000-000000000002');
select pg_temp.check((select assigned_by from public.dockets where id = '99999999-0000-0000-0000-000000000020') = 'aaaaaaaa-0000-0000-0000-000000000006', 'records who assigned it');
reset role;
select pg_temp.check((select count(*) from public.sms_outbox where kind = 'docket_assigned' and phone = '0400 000 002') = 1, 'assigning queues a text to the crew phone');
select pg_temp.check((select body from public.sms_outbox limit 1) like 'Coho Drive: docket % (Landspray runsheet) for 25/11 is assigned to your phone.%', 'the text says which docket and day');

-- crew phone 2 sees it (assigned by phone) but cannot reassign or cancel it
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000007', '{"phone":"61400000002"}');
set role authenticated;
select pg_temp.check((select count(*) from public.dockets where id = '99999999-0000-0000-0000-000000000020') = 1, 'the crew phone sees the docket assigned to it');
do $$ begin
  begin update public.dockets set assigned_phone_id = null where id = '99999999-0000-0000-0000-000000000020';
    raise exception 'FAIL: driver cancelled the assignment';
  exception when insufficient_privilege then raise notice 'ok - a driver cannot cancel or reassign a docket'; end;
end $$;
update public.dockets set notes = 'started' where id = '99999999-0000-0000-0000-000000000020';
reset role;
select pg_temp.check((select count(*) from public.sms_outbox) = 1, 'editing a docket sends no text');

-- the office reassigns it to crew phone 1: phone 1 is told, phone 2 is told it moved
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000006', '{"email":"office@example.com"}');
set role authenticated;
update public.dockets set assigned_phone_id = '55555555-0000-0000-0000-000000000001' where id = '99999999-0000-0000-0000-000000000020';
reset role;
select pg_temp.check((select count(*) from public.sms_outbox where kind = 'docket_assigned' and phone = '0400 000 001') = 1
  and (select count(*) from public.sms_outbox where kind = 'docket_moved' and phone = '0400 000 002') = 1, 'reassigning texts the new phone and the old phone');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000007', '{"phone":"61400000002"}');
set role authenticated;
select pg_temp.check((select count(*) from public.dockets where id = '99999999-0000-0000-0000-000000000020') = 0, 'the old crew phone no longer sees it');
reset role;

-- phone 1 completes it: it goes for review
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003', '{"phone":"61400000001"}');
set role authenticated;
update public.dockets set status = 'closed', start_at = '2026-11-25 06:00+10', end_at = '2026-11-25 18:00+10' where id = '99999999-0000-0000-0000-000000000020';
select pg_temp.check((select review_status = 'to_review' and completed_at is not null from public.dockets where id = '99999999-0000-0000-0000-000000000020'), 'completing a docket sends it for review');
do $$ begin
  begin update public.dockets set review_status = 'reviewed' where id = '99999999-0000-0000-0000-000000000020';
    raise exception 'FAIL: driver reviewed own docket';
  exception when insufficient_privilege then raise notice 'ok - a driver cannot review their own docket'; end;
end $$;
reset role;

-- a Drilling supervisor cannot review a Landspray docket; a supervisor for all departments can return it
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000011', '{"email":"drillsup@example.com"}');
set role authenticated;
select pg_temp.check(public.my_review_departments() = array['Drilling'], 'a login can be limited to departments');
do $$ begin
  begin update public.dockets set review_status = 'reviewed' where id = '99999999-0000-0000-0000-000000000020';
    raise exception 'FAIL: other department reviewed it';
  exception when insufficient_privilege then raise notice 'ok - supervisors only review their own departments'; end;
end $$;
reset role;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000008', '{"email":"sup@example.com"}');
set role authenticated;
update public.dockets set review_status = 'returned', review_comment = 'Add the Westrex docket numbers' where id = '99999999-0000-0000-0000-000000000020';
select pg_temp.check((select status = 'open' and reviewed_by = 'aaaaaaaa-0000-0000-0000-000000000008' from public.dockets where id = '99999999-0000-0000-0000-000000000020'), 'returning a docket reopens it for the driver');
reset role;
select pg_temp.check((select count(*) from public.sms_outbox) = 3, 'review and return send no texts');

-- driver fixes and completes again, supervisor marks it reviewed, then it is locked for the driver
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003', '{"phone":"61400000001"}');
set role authenticated;
update public.dockets set notes = 'Westrex 1234', status = 'closed' where id = '99999999-0000-0000-0000-000000000020';
select pg_temp.check((select review_status from public.dockets where id = '99999999-0000-0000-0000-000000000020') = 'to_review', 'completing again sends it back for review');
reset role;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000008', '{"email":"sup@example.com"}');
set role authenticated;
update public.dockets set review_status = 'reviewed' where id = '99999999-0000-0000-0000-000000000020';
reset role;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003', '{"phone":"61400000001"}');
set role authenticated;
do $$ begin
  begin update public.dockets set notes = 'late change' where id = '99999999-0000-0000-0000-000000000020';
    raise exception 'FAIL: reviewed docket changed by driver';
  exception when insufficient_privilege then raise notice 'ok - a reviewed docket is locked for the driver'; end;
end $$;
reset role;

-- cancelling texts the phone
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000006', '{"email":"office@example.com"}');
set role authenticated;
insert into public.dockets(id, form_type, status, work_date, assigned_phone_id) values ('99999999-0000-0000-0000-000000000021', 'general', 'draft', '2026-11-26', '55555555-0000-0000-0000-000000000001');
update public.dockets set assigned_phone_id = null where id = '99999999-0000-0000-0000-000000000021';
reset role;
select pg_temp.check((select count(*) from public.sms_outbox where kind = 'docket_cancelled' and phone = '0400 000 001') = 1, 'cancelling the assignment texts the phone');

-- only the texting function can claim texts
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000006', '{"email":"office@example.com"}');
set role authenticated;
do $$ begin
  begin perform public.claim_sms(5); raise exception 'FAIL: signed-in user claimed texts';
  exception when insufficient_privilege then raise notice 'ok - only the texting function can send texts'; end;
end $$;
select pg_temp.check((select count(*) from public.sms_outbox) >= 5, 'office can see the text log');
reset role;
set role service_role;
select pg_temp.check((select count(*) from public.claim_sms(10)) = 5, 'the texting function claims pending texts once');
select pg_temp.check((select count(*) from public.claim_sms(10)) = 0, 'and never twice');
reset role;
