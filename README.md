# Coho Trucking PoC

Proof of concept for the Coho Driver App design (Coho_Driver_App_Design_v0.2): one web app for driver sign-in with a work mobile,
truck QR, prestart, dockets per customer job, loads, client sign-off, km matching, timesheets, approvals and reports.

- **Web app:** `web/` (React + TypeScript + Vite, installable as a Progressive Web App)
- **Database:** `supabase/` (Postgres on Supabase project `coho-trucking-poc`, Sydney)
- **Manuals:** `docs/` (User Manual and Developer Manual, Word)

## Quick start

```bash
cd web
npm install
npm run dev          # http://localhost:5173  (uses the live Supabase project from .env.development)
# or demo mode, no database:  http://localhost:5173/?demo=1   code 123456
```

Demo logins: `0400 000 001` (driver phone), `admin@demo.local`, `office@demo.local`, `supervisor@demo.local`.

## Tests

```bash
bash scripts/test-db.sh       # database: roles, row level security, query console, timesheet lock
cd web && npm test            # unit: km matching, timesheets, spreadsheet import, phone numbers, demo access rules
cd web && npm run e2e         # end to end: driver flow, admin adds a login
```

## Change loop (iterate over and over)

1. Branch from `main`.
2. Change the database with a **new** file in `supabase/migrations/` (never edit an applied one) and add a test in `supabase/tests/`.
3. Change the app; fields live in `web/src/lib/schema.ts`.
4. Run the three test commands. Open a pull request; CI runs them again.
5. Merge. Apply migrations (Actions > "Apply database migrations", or through the Supabase connector). The web app deploys from `main`.

See the Developer Manual for structure, principles and the full workflow.
