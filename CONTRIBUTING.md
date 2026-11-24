# Working on the PoC

- Every business field is optional (nullable) during the PoC. Do not add NOT NULL constraints without agreement.
- One source of field definitions: `web/src/lib/schema.ts`. Department extras: `web/src/lib/extras.ts` (stored in `dockets.extras`, no migration needed).
- Database changes: new timestamped migration file, plus a test in `supabase/tests/`. Run `./scripts/test-db.sh`.
- Security: row level security on every table. Run the Supabase security advisor after every migration.
- Keep the demo backend (`web/src/lib/demoBackend.ts`) in step with the database rules so training and tests stay realistic.
- Commit messages: what changed and why, in plain words.
