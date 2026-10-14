# Backup, restore, pilot, and executive handover

## Backup both records and file bytes

A Supabase database backup covers database records and storage metadata, not the uploaded object contents. Maintain a paired database snapshot and object-content snapshot, encrypted and accessible only to designated association infrastructure custodians. Do not place a combined backup in the application's general documents area: it would contain private receipts and case files.

Choose an association-approved schedule and retention period based on the service plan and operational needs. Pause registration and executive writes during a coordinated manual snapshot, or use a managed point-in-time database backup and a documented storage change window. Record start/end times and the last included operation. Protect recovery credentials in an association-controlled password manager; never include them in the backup manifest.

For PostgreSQL, prefer the provider's supported full backup/export procedure. A manual public-schema-only dump is insufficient for a restore that must preserve Auth identities and storage metadata. If using `pg_dump`, use securely loaded PostgreSQL environment settings (including `PGPASSWORD`) and a custom-format dump for the approved schemas/roles, following Supabase's current restore guidance. Do not paste passwords into command arguments or versioned scripts. Confirm the dump includes the Auth UUID relationships, sequences, grants, RLS policies, functions, and document metadata, or document the separate identity export required for that plan.

With server variables loaded on a trusted machine, copy the file contents:

```bash
node --env-file=.env scripts/backup-storage.mjs /secure-encrypted-backups/um18-snapshot
```

The script paginates all three buckets (branding, private-documents, and event-media), recurses folders, downloads all object bytes, and records SHA-256, size, MIME, path, and generation time. It never prints secrets. Store the manifest with the matching database snapshot and a manifest of the schema/source version. Verify that the number of document metadata rows can be reconciled with stored object paths and that the current branding logo is present. Restrict permissions on the backup destination and encrypt it at rest; the script sets file mode 0600 but does not supply an encryption key.

## Staged restore walkthrough

1. Obtain documented association approval and select a separate **staging** target. Never test by overwriting the only live project. Keep the production service available or define the maintenance window and rollback owner before any real cutover.
2. Verify the backup manifest and PostgreSQL dump with their checksums. Record snapshot time, source commit, included operation range, and which identities/objects the plan preserves.
3. Create an association-controlled Supabase staging project. Use the provider-supported database restore/import procedure for the chosen backup type. Preserve Auth UUIDs needed by executive FKs; rotate recovered credentials and require MFA re-enrollment where the provider requires it. Terminate restored old Auth sessions using provider-supported procedures and advance executive `auth_valid_after` cutoffs through the privileged restore connection, with an audit entry. Newly issued tokens must be later than that cutoff. Preserve pending recovery restrictions until an authorised identity review resolves them. Restore sequences to values at least beyond the maximum used member/case number. Do not reset them to a client-side row count.
4. Verify schema versions, all RLS-enabled tables, grants, functions, permanent owner constraints, and the three bucket configurations. If using a freshly applied schema plus data-only import, apply all migrations first and import dependency-ordered rows using the privileged restore connection. Do not create duplicate owners through the normal bootstrap path after an existing owner was restored.
5. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` to the staging target only, then approve and run the object restore:

```bash
RESTORE_CONFIRM=STAGING_RESTORE_APPROVED node --env-file=.env.staging scripts/restore-storage.mjs /secure-encrypted-backups/um18-snapshot
```

6. The script checks bucket publicity, verifies every source checksum, uploads to the preserved path, downloads the restored bytes, and verifies every resulting checksum. Inspect every failure; the operation does not claim completion after an error. A database restore may include “ghost” storage metadata; upserting the actual bytes is necessary. Follow provider guidance if an existing metadata object cannot be uploaded normally.
7. Check member counts and IDs, registration states, executive assignments, assessment snapshots, net receipts, current allocations, credit, approved expenses, and collection remaining balances against the original snapshot statements. Check adjustment and allocation histories. Compare database document paths with the storage manifest.
8. Exercise the restored website with staging config: anonymous private data denial, AAL1 denial, two individual executives, a revoked account, a receipt file, an assigned welfare file, and an unauthorised direct file/list request. Verify the official branding URL and fallback. Generate statements and reconcile totals. Test a new member approval to prove sequences did not reuse IDs.
9. Record restoration time, checksum results, unresolved differences, and executive acceptance. Only after the staged restore is accepted may the association decide a production cutover. Keep the pre-cutover backup and original project for rollback until acceptance is final. Re-enable writes and monitor errors after the approved cutover.

No real restore was run during this build: project credentials and storage access were unavailable. The utility and walkthrough are delivered for the configured pilot.

## A small pilot before full use

Use a nonproduction Supabase project and a clearly designated test membership cohort. Invite a membership executive, finance officer, welfare officer, read-only reviewer, and at least two named owners. Keep real personal information out of the Sites review and prefer fictional records for integration testing.

Walk through public registration, errors/retries, review/linking, established-member migration, one variable monthly amount, an unset next month, a compulsory partial payment and waiver, a voluntary special fund, one multi-collection transfer with credit, a refund, a reversal, one approved expense, documents, event attendance with not-recorded entries, an assigned welfare case, scoped exports, logo replacement, and account revocation. Reconcile every statement before increasing access. Collect interface feedback on a 360px phone, tablet, desktop, keyboard, and assistive technology. Correct observed failures; do not interpret local DOM tests as visual acceptance.

Finish the staged backup/restore drill, configure retention and privacy policies, verify the official contact channel, and obtain membership/finance pilot sign-off. Then deploy the real Vercel project and start with a bounded registration window. No default contribution amount or historical arrears is supplied.

## Handover and recovery

Maintain an association-controlled ownership register for domain/DNS, hosting, Supabase, source repository, billing, SMTP, bot-check account, backups, and password-manager vaults. Record named primary and secondary custodians and the association's decision authority. Use individual accounts and provider MFA. Rotate secrets if a departing developer or executive had access.

Before changing the application's owner role, invite and verify the successor, ensure their active permanent owner role and AAL2 session work, test account and branding administration, and take a paired backup. Revoke outgoing operational permissions with a reason. At least one permanent active owner must remain; the database rejects a handover that removes all permanent owners. Infrastructure ownership transfers are separate and must be verified with the providers.

For a lost authenticator, an independently authenticated AAL2 owner with `accounts.mfa_reset` verifies identity and association approval, then uses the audited Executive accounts recovery action. The target is restricted during the persistent operation; original AAL2 tokens are invalidated by the database cutoff. Supported Auth factor deletion is server-only. Completion is audited, and the target must sign in freshly and enroll MFA. A failed reset remains restricted; inspect the recorded operation rather than bypassing it. Self-reset is forbidden. If no working owner remains, named infrastructure custodians use provider ownership/MFA recovery tools and record their intervention through a privileged, association-approved audit procedure. Avoid OTP secrets/passwords or case contents in audit notes; never create a public bypass or shared emergency password.

## Retention and correction requests

Publish the association's adopted retention/correction contact policy after review. The supplied privacy notice makes no claim of legal certification. The configurable interval triggers an executive review, not automatic deletion. Verify correction/deletion requests through existing contact channels; record the request, decision, scope, retained financial obligations, and who approved any archival/anonymisation work. Take a protected backup before authorised destructive retention operations and record them in audit history. An engineer must handle an approved purge with dependency-aware migrations; ordinary executives should archive records instead.
