# Supabase database setup — 14 October 2026

The Supabase plugin installed and verified the UM18 database in the approved association project. The website is still the separate localhost interface preview. Live sign-in, email, hosting and pilot acceptance are pending.

## Project and migration ledger

- Project: `hpbzhaleqphfucnautpl`.
- [Supabase project dashboard](https://supabase.com/dashboard/project/hpbzhaleqphfucnautpl).
- API URL: `https://hpbzhaleqphfucnautpl.supabase.co`.
- Region: `eu-west-1`; PostgreSQL `17.11.0.003`.
- Installed: all eighteen prepared migrations plus `20261014171907_financial_history_access.sql`.
- All nineteen remote ledger versions and names match the repository files. The plugin generated execution timestamps; after each application, its ledger version was reconciled to the original filename prefix without reapplying the schema.
- [Installed migration manifest](supabase-installed-migrations.json) records the filenames, versions and SHA-256 hashes of the submitted UTF-8 SQL text. Preserve line endings when comparing hashes; Git may normalize them on checkout. Never edit an already applied migration; create a new migration for future changes.

An interrupted plugin connection initially prevented confirmation of migration six. After reconnection, the live ledger showed it had completed. Its version was reconciled before continuing with migration seven; it was not applied twice.

## Hosted permission correction

Live privilege checks found that Supabase's default grants gave `anon` and `authenticated` extra privileges on `payment_metadata_history`, and `authenticated` extra privileges on `payment_status_history`. RLS blocks unauthorised row operations but does not protect TRUNCATE. This issue was absent from the earlier embedded fixture's default grants.

The final migration revokes all browser/PUBLIC privileges on those tables, restores only authenticated SELECT under the existing finance-read policies, and removes automatic browser grants on future public tables created by the migration role (`postgres`). Existing server privileges and audited RPCs remain available. Tables created by other administrative roles still need explicit grant review and RLS. Welfare policies also cache `auth.uid()` per statement while keeping assignment and permission checks.

Five regression checks reproduce the hosted grants, confirm the correction denies direct mutations/TRUNCATE, preserve audited writes and authorized finance reads, deny read-only/anonymous history access, and verify future application tables require deliberate browser grants.

## Executed live checks

| Check | Result |
|---|---|
| Migration history | Nineteen exact filename versions and names |
| Public application tables | 37, all with RLS enabled |
| Browser direct table writes | No INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER privileges for anon/authenticated |
| Anonymous direct SELECT | Branding only |
| Public event feeds | Empty upcoming/gallery projections accessible anonymously |
| Executive offices | Eleven approved office definitions |
| Leadership review | Secretary role has no default review grant; installed permission function requires President/Vice President office plus current access |
| Storage | Public branding; private documents and event media |
| Unauthorised private access | Anonymous member/history reads, write RPC and bootstrap denied |
| Unauthorised authenticated access | No executive context, workspace snapshot or write authority; financial history not visible |
| Server history privileges | Service-role INSERT rights retained on both financial history tables |
| Definer function hardening | No PUBLIC execution grants; all public SECURITY DEFINER functions have fixed empty search paths |
| Operational records | No Auth users, executives, members, submissions, payments, expenses, events, reports or stored objects |

The access assertions ran with actual Postgres `anon` and `authenticated` roles inside rolled-back transactions. They did not create accounts or sample production records. They are direct SQL checks, not real signed-in sessions through PostgREST.

The complete local suite passed **307 tests**, with zero failures/skips. JavaScript syntax checks passed for **51 modules**. Production and interface-preview build checks also passed.

## Advisor results and interpretation

The database advisors reported no ERROR findings. Remaining notices were reviewed rather than represented as a clean, warning-free report:

- Eight [RLS-enabled tables without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy): internal role/grant/denial, command and rate-limit tables deliberately deny client access and are used by guarded database/server operations. Adding permissive policies would weaken this design.
- One [anonymous SECURITY DEFINER entry point](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable): `public_events(text)` is the deliberate public publicity feed. It validates the requested view and projects eligible event publicity and media identifiers, excluding private notes, attendance, object paths and financial details.
- Thirty [authenticated SECURITY DEFINER entry points](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable): intentional guarded RPCs and policy helpers. They retain explicit grants, fixed search paths and their existing account/session/MFA/permission checks; projection helpers return only their permitted outputs. Authenticated role alone does not grant executive access.
- Fifty-one [foreign keys without covering indexes](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys): informational performance candidates, including audit actor and historical links. Add indexes based on pilot queries and measured plans as the dataset grows.
- Twenty-one [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index): expected on a newly created, empty database; retain the planned query indexes.

The two welfare [Auth initplan warnings](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan) cleared after the final migration.

## Remaining setup before operational use

1. Configure and verify Auth: disable public signup and anonymous sign-ins; enable TOTP; approve the exact site origin and login redirects; configure invitation/recovery email delivery, password policy and session limits.
2. Configure Vercel server variables securely. No private key was read or placed in this chat, source or manifest. Keep production and staging separated.
3. Bootstrap the approved President's individual account, accept its email invitation, set a password and verify MFA. The President then invites other executives from the dashboard.
4. Test real public submissions, leadership review, executive invitations/acceptance, office permissions and revocation through deployed UI and API calls.
5. Run financial/event/document pilot checks and a coordinated database/object backup and staging restore drill.
6. Complete actual phone keyboard, Safari and accessibility acceptance.

See [DEPLOYMENT.md](DEPLOYMENT.md) for configuration and [VERIFICATION.md](VERIFICATION.md) for earlier interface checks and the outstanding pilot.
