# Audit repairs — 15 October 2026

The read-only audit found three reproducible application defects, two Auth configuration issues, and performance/security follow-ups. The fixes below preserve member, receipt, expense and audit records.

## Application fixes

- Authenticator setup installs a submission handler before any network request. Codes stay disabled until a factor is ready. Failed factor lookup/enrollment shows a visible error and Retry setup; Sign out remains available. Delayed setup responses cannot reveal a QR code after sign-out. Accepted invitation/recovery callbacks show password setup before starting MFA enrollment.
- Event lists use saved per-event attendance counts from the guarded workspace RPC. Individual attendance rows remain scoped to the selected event. Table search/sort accepts numeric rendered cells, fixing a related event-search error.
- Overview loads shared expense pages through `accountability_expenses`. Every matching expense is reachable through pagination, with server-side search, approval filters, dates and sorting. It exposes only the approved summary, date, amount, status, collection title, officer display name and record ID. Private descriptions, payees, notes, supporting files and officer IDs remain excluded. Totals continue to cover the full date range.
- The database migration adds a shared-expense date index and covering indexes for previously uncovered public-schema foreign keys. No existing indexes are removed.

## Live configuration and migration

The Supabase plugin applied `20261015051235_audit_workspace_repairs.sql` to project `hpbzhaleqphfucnautpl`. There are now twenty migrations. Live catalog checks confirm the shared-expense RPC is unavailable to anonymous users, available to authenticated executives subject to live permission/MFA checks, and its internal workspace wrapper cannot be called directly by browser roles. The Performance Advisor no longer reports unindexed foreign keys. Newly added indexes can appear as unused while the project has no operational data; that does not justify removing them.

Auth Site URL is now `https://theunmatched.vercel.app`. The existing allowed callback remains `https://theunmatched.vercel.app/admin/login/`. Public account signup is disabled, anonymous sign-in remains disabled, email sign-in remains enabled, and email confirmation remains enabled. This does not disable the public membership request form: it submits a pending request without creating an Auth account.

Compromised-password screening is available only on Supabase Pro and above, as shown by this Free project's Email provider settings. No paid upgrade was purchased. President MFA enrollment, invitation/recovery email delivery, the complete live pilot and a paired backup/restore drill still need completion. Broader directory/report delivery remains a later performance improvement; selectors and authorised full-report exports still load their existing record sets.

## Verification

The full suite passed **328 tests**, zero failures/skips, and syntax checks passed for **51 modules**. Production and isolated preview builds passed in the suite. Thirteen additional regression checks cover failed/retried MFA setup, preserved factors, delayed enrollment after sign-out, invitation callback ordering, saved event counts and search, expense pagination beyond fifty rows, bounded filters/sorting, all FK indexes, unauthorised/AAL1/denied/revoked readers and the production RPC adapter.

All member/expense fixtures were created in embedded PostgreSQL only. No fabricated production registration, member, payment, expense, invitation or authenticator was created by these fixes. Live catalog checks confirmed the production member and submission counts remained zero.
