# Production audit repairs — 15 October 2026

The audit-repairs migration was applied to the association Supabase project on 15 October 2026. The live ledger now contains 25 migrations. Member/account counts and financial fingerprints were unchanged after application; the revision column and helper access restrictions were verified. Frontend deployment is checked separately from database installation. This is not evidence of an email/restore acceptance test.

## Changes

- Expenses now carry a database revision. Editing, approving, rejecting or reversing an existing expense requires the reviewed revision. The database locks and compares the record before changing it. A stale operation fails with a refresh/review instruction. Exact successful retries return the prior result; a reused key with different contents fails. Current permissions are checked before cached results are returned.
- Profile selection clears the previous member's fields, disables saving while loading, ignores responses from earlier selections and keeps saving disabled after a failed load. The President must still explicitly confirm the selected identity before linking.
- Rejected startup sessions return to sign-in. Other startup failures retain Retry and provide Sign out / switch account. Sign-out uses the current session scope. Network failures do not automatically sign out the user.
- The staging storage restore checks the canonical source and target URLs, `RESTORE_ENVIRONMENT=staging`, an exact `RESTORE_TARGET_PROJECT_REF` and `RESTORE_CONFIRM=STAGING_RESTORE_APPROVED` before creating a Storage client. It rejects the production project and the backup source. A production cutover needs a separately reviewed procedure.
- Workspace member records are selected before JSON aggregation. Overview receives recent members plus aggregate totals; member lists use paged search; detail pages receive related records. Single-member selectors provide searchable pages of 20 results. The selected member is preserved across searches. Global search queries the server. Reports and event attendance intentionally require a complete roster; bulk assessment/import workflows fetch it only when opened. Country filters and Overview counts use database metadata rather than the shortened roster.
- The deployment and handover guides describe the current password login and separate infrastructure recovery. The shared loader minimum is one second.

## Verification

The full suite passed 378 tests, including production and interface-preview builds. The subsequent 45-test targeted run passed after the final route fixes and includes eight audit regression checks, migration preservation/access grants, profile shortcuts, finance workflows and navigation races. Source syntax checks cover 56 JavaScript modules. These are isolated tests, not evidence of a completed live pilot.

## Deployment order

1. Run the local test suites, including the database fixture and production build checks.
2. Apply `supabase/migrations/20261015122243_audit_production_repairs.sql` to a separate staging database and deploy the matching frontend there. Existing expenses retain their identities, amounts and status; the new revision starts at 1. No member or financial records are deleted.
3. Test two officers viewing the same expense: revise it in one session, then verify the other's old approval is refused. Refresh and approve the reviewed amount. Verify profile selection under delayed responses and account switching with a rejected session.
4. Verify member searches beyond the first 20, country filters, full exports, advance-payment member selection, executive invitations, member linking and bulk assessments. Compare Overview totals with the complete report.
5. During the coordinated production release, apply the migration before publishing the matching frontend. Old open pages lack expense revision fields and must refresh before editing or approving expenses. Refresh all executive sessions after release.
6. Update the installed-migration manifest only after confirming the remote migration ledger and normalized SQL checksum. Keep the prior frontend and a paired backup available for incident recovery; do not remove the version check to accommodate old pages.

The database migration is installed and verified; deploy this matching frontend through GitHub/Vercel and refresh old executive pages. Real invitation inbox delivery, a staging restore drill and live financial acceptance remain separate operational checks.
