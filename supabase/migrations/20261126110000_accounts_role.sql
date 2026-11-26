-- Accounts role (payroll and invoicing) and the Accounts reports.
--
-- 1. Role "accounts": starts with exactly the same access as Office (copied from Office's settings when this runs).
--    Admins can change it afterwards in Settings like any other role.
-- 2. Function "accounts_reports": overdue timesheets, docket totals by customer / asset / user / status, and
--    timesheets compared with their dockets. Read only (the reports change nothing).
--    Given to Accounts, Office and Supervisor (admin always has everything).
-- The reports only read tables these roles can already read (dockets, loads, shifts, timesheet lines),
-- so no row level security changes are needed.

insert into public.roles(code, label, description, rank, is_system, active)
select 'accounts', 'Accounts', 'Payroll and invoicing. Same as Office, plus the Accounts reports.', 25, true, true
where not exists (select 1 from public.roles where code = 'accounts');

insert into public.features(code, label, grp, description, max_level, admin_only_edit, sort) values
  ('accounts_reports', 'Accounts reports', 'Supervision',
   'Overdue timesheets, docket totals per customer, asset, user and status, and timesheets compared with their dockets. Read only.', 'read', false, 75)
on conflict (code) do nothing;

-- Accounts gets what Office has
insert into public.role_permissions(role, feature, access)
select 'accounts', rp.feature, rp.access from public.role_permissions rp where rp.role = 'office'
on conflict (role, feature) do nothing;

-- the new reports (other roles have no row, which means hidden)
insert into public.role_permissions(role, feature, access)
select r.code, 'accounts_reports', 'read'
from public.roles r where r.code in ('admin', 'accounts', 'office', 'supervisor')
on conflict (role, feature) do nothing;
