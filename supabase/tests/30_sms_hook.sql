-- Tests: the Send SMS hook gate (registered numbers only, limits, logging). Run with scripts/test-db.sh
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;

select pg_temp.check((public.sms_hook_check('61400000001', 'test')->>'allowed')::boolean, 'registered crew phone is allowed');
select pg_temp.check(not (public.sms_hook_check('61499999999', 'test')->>'allowed')::boolean, 'unregistered mobile is blocked');
select pg_temp.check(not (public.sms_hook_check('14155550100', 'test')->>'allowed')::boolean, 'overseas number is blocked');
select public.sms_hook_check('61400000001', 'test') from generate_series(1, 4);
select pg_temp.check(not (public.sms_hook_check('61400000001', 'test')->>'allowed')::boolean, 'sixth code in an hour is blocked');
select pg_temp.check((select count(*) from public.sms_log where status = 'blocked') = 3, 'blocked attempts are logged');
select public.sms_hook_result((select id from public.sms_log where status = 'pending' limit 1), 'sent', 'abc');
select pg_temp.check(exists (select 1 from public.sms_log where status = 'sent' and provider_message_id = 'abc'), 'result is recorded');
select pg_temp.check(not has_function_privilege('authenticated', 'public.sms_hook_check(text, text)', 'execute'), 'signed-in users cannot call the gate');
select pg_temp.check(not has_function_privilege('anon', 'public.sms_hook_result(uuid, text, text, text)', 'execute'), 'visitors cannot write results');
