# Text message sign-in (Send SMS hook)

Coho Drive texts sign-in codes through an Australian SMS provider using Supabase's Send SMS hook,
not one of Supabase's built-in SMS providers.

## How it works
1. A driver enters a work mobile on the sign-in screen.
2. Supabase Auth calls the Edge Function `send-sms` (supabase/functions/send-sms) with a signed request.
3. The function asks the database (`public.sms_hook_check`) whether the number may get a code:
   - it must be an Australian mobile,
   - it must be an active number in Admin > Logins and roles or Admin > Work phones,
   - at most 5 codes per number per hour, and 1,000 per day across everyone.
4. If allowed, it texts the code through the provider and records the result in `public.sms_log`.
5. Blocked or failed attempts show a plain message on the sign-in screen and are logged too.

## Settings (Supabase dashboard)
- Authentication > Hooks > Send SMS: HTTPS, URL `https://fdosognpipepotmxxutr.supabase.co/functions/v1/send-sms`.
- Edge Functions > Secrets: `SEND_SMS_HOOK_SECRET`, `SMS_PROVIDER` (`mobilemessage` or `test`),
  `SMS_SENDER` (approved sender ID), `MOBILEMESSAGE_USERNAME`, `MOBILEMESSAGE_PASSWORD`.
- Never put these values in the repo.

## Day-to-day support
- See recent texts (admins): Data > Query, `select created_at, phone, status, reason from sms_log order by created_at desc limit 50`.
- "This number is not set up": add it in Admin > Logins and roles (role driver) or Admin > Work phones.
- `failed` rows: the `reason` column holds the provider's reply (for example no credit or a bad sender ID).
- Change the limits: edit `per_hour` / `per_day` in `sms_hook_check` with a new migration.
- Switch provider: add a send function in index.ts and set `SMS_PROVIDER`. The database side does not change.
- Turn text sign-in off quickly: disable the hook in Authentication > Hooks. Email sign-in keeps working.
