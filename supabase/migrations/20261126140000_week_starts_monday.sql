-- UAT 26/11/2026: timesheet weeks start on Monday (pays are done on Wednesday).
-- Fortnights repeat every 14 days from Monday 9 November 2026 (9-22 Nov, then 23 Nov-6 Dec). Admin can still change both in Settings.
update public.app_settings set value = '1',
  description = 'Day timesheet weeks start on: 0 Sunday, 1 Monday ... 3 Wednesday ... 6 Saturday'
where id = 'timesheet_week_start';
update public.app_settings set value = '"2026-11-09"' where id = 'timesheet_cycle_anchor';
