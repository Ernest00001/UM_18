# Production audit corrections

The production audit identified runtime gaps that preview navigation and isolated report tests did not exercise. The corrections below are implemented in source and prepared database migration 017. No live database migration, invitation, deployment or GitHub commit was performed.

## Corrections

| Audit finding | Corrected behavior |
|---|---|
| Upload deleted after an uncertain commit response | Document and logo uploads retain their bytes. Retrying the same payload can return the saved reference; later orphan cleanup must inspect current and preserved references before deletion. |
| One physical receipt counted twice through branching replacements | Payments have an immutable receipt root, one pending/confirmed receipt per root and one preserved successor per receipt. Only the latest reversed/rejected leaf can be replaced. Existing IDs, refunds, actors, dates, operation receipts and history remain intact. |
| Office reports rejected by the workspace loader | The authenticated workspace contract supports the office-reports area and still uses the existing safe report-list projection and office permissions. |
| PRO could record but not correct contact follow-ups | Contact correction requires contacts.write, rather than unrelated members.write. Current authority is checked before retry replay; history and the derived last-contact date are preserved. |
| Inactive-member filters ignored in production and exports | The production adapter translates the table's membership_status into the SQL status parameter, retaining country, query, sort and pagination. Explicit empty status clears a filter. |
| Record IDs lost on rewritten URLs | Both query IDs and record path segments reach the database loader. Office-report detail rewrites are included in Vercel and local development routing. |
| Older responses overwrote newer pages | Navigation and refresh use a revision and captured area/target. Page rendering has a stable container/data context and guarded service calls; obsolete responses, failures and callbacks cannot replace the current view. |
| Finance failures displayed false zero totals | Production balances, pending-payment counts and the receipt chart show unavailable states with Retry. Complete local preview/review records may supply figures only when no metrics service exists; a failed metrics service is not replaced by empty scoped rows. |
| Document replacement branched from a stale base | Replacement locks and checks the current unarchived version. A unique successor constraint prevents branching; identical stored-path retries still return their existing version. |
| Assessment audit entries lacked a parent-record link | The authenticated audit projection supplies a parent collection ID only to finance readers. The UI opens that collection without fetching a full assessment list. |
| Deployment instructions omitted the latest migrations | The guide now requires all seventeen ordered scripts and describes migrations 016 and 017. |
| Image-processing dependency advisories | sharp is pinned to patched version 0.35.5 and the lockfile is updated. File type, dimension, size and static-image checks remain active. |

## Migration preflight

Apply `202610140017_production_integrity.sql` after the first sixteen scripts during the later backend stage. The migration backfills receipt roots and checks preserved history before enforcing constraints. Deferred financial checks are completed before subsequent table alterations.

If an existing database contains incomplete or branched receipt lineage, multiple active receipts in one lineage, or branched document versions, migration stops and rolls back. An authorised officer must review and reconcile the preserved history; the script does not guess the correct receipt or delete conflicting records. Take a coordinated database/object backup and test migration in staging before applying it to production.

## Verification

The complete local suite passed **282 tests, with no failures or skipped tests**. Syntax checks passed for **50 JavaScript modules**. Both production and empty-preview builds completed through the existing build regression suite.

The official npm advisory lookup checked **87 public dependency packages** from the updated lockfile and returned no advisories. The installed native image stack reports sharp 0.35.5 and libvips 8.18.7. The running localhost preview retains its already-loaded server modules until restart; the dependency correction is verified in fresh processes and the deployable source/lockfile.

New regression suites:

- `production-integrity-database.test.mjs`: receipt lineage/retry, stale document bases, all sixteen executive workspace areas, restricted assessment audit projections, PRO correction/revocation, migration of preserved receipts and refusal of conflicting history.
- `production-upload-retry.test.mjs`: lost responses after document/logo commit, intact object bytes, unchanged retry and permission rejection before upload.
- `production-adapter-fixes.test.mjs`: all rewritten record paths, query/replacement IDs, captured navigation scope, member-status export scope, financial unavailable/retry states, assessment links and stale receipt replacement controls.
- `production-navigation-race.test.mjs`: late workspace results, late failures, delayed summary rendering and delayed refresh cannot replace a newer page.

The native browser pass opened all sixteen executive pages in the empty localhost preview without an error panel. The Overview inactive-member shortcut opened Members with the inactive filter selected. Screenshot: `.local/production-fixes-members.jpg`. The active preview server and its saved review change were retained; no test operational records were added.

Embedded PostgreSQL uses an in-memory database and fixture Auth/Storage schemas. It does not establish live Supabase authorization, real multi-connection concurrency, invitation/email delivery or object storage access. DOM tests use service stubs and narrow form/browser shims. The localhost browser walkthrough does not verify the production database connection.

Before operational release, apply the prepared migrations in staging and verify Supabase Auth/MFA, email invitations, RLS and real storage URLs, Vercel routing/headers/native image binaries, concurrent corrections, mobile keyboards/accessibility and a coordinated backup/restore drill. These infrastructure checks remain deferred by the agreed UI-first scope.
