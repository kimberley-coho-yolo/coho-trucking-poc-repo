-- Hardening after Supabase security advisor review (24 Nov 2026)
-- 1. Fix search_path on helper functions
alter function public.norm_phone(text) set search_path = public;
alter function public.is_staff() set search_path = public;
alter function public.is_office() set search_path = public;
alter function public.is_admin() set search_path = public;
alter function public.has_access() set search_path = public;
alter function public.touch_updated_at() set search_path = public;
alter function public.lock_approved() set search_path = public;
-- 2. Signed-out visitors cannot call any function; the audit trigger function is not callable by anyone directly
revoke execute on all functions in schema public from anon, public;
revoke execute on function public.audit() from authenticated;
-- app_role, claim_first_admin and people_for_my_phone stay callable by signed-in users on purpose:
-- they only ever return or change the caller's own access.
