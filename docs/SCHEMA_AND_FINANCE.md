# Schema and accounting contract

## Identities and permissions

`auth.users` represents individual executive identities. `executive_accounts` stores operational status, an optional FK to `members`, and `office_codes[]` for association office titles. Members do not need an Auth identity. Office titles and access roles are independent: selecting President, PRO, or another office does not grant authority. Many role assignments may be active for one executive; assignments have effective dates, optional expiry, and revocation timestamps. `role_permissions` and `explicit_permissions` grant actions; `permission_denials` overrides both while effective. An active current role is still required. A label or hidden button is not an authority.

Migration 013 adds the eleven supported offices and separate `contacts.read` permission. `executive-offices.js` supplies labels and suggested responsibility presets for account administrators. A preset only fills a form for review; the saved role assignments, explicit grants, denials and schedules determine actual access. No office preset grants owner/system administration. All offices use the same workspace and receive the permitted pages and projections.

`OFFICE_WORKSPACES` groups leadership, secretariat, treasury and financial secretariat officeholder/assistant pairs, plus the PRO, combined Community / Event Manager and Auditor General offices. `officeWorkspaces(office_codes)` selects an executive's teams. Overview renders each team's active colleagues from the safe officer projection and its links from the signed-in executive's current permissions. These groups provide shared entry points to the existing canonical records, not separate data stores or new grants. Every write retains the individual authenticated actor. An assistant's permissions, denials and role dates remain independent of the officeholder's.

President and Vice President presets use `read_only` with `finance.read` and `audit.read`. Secretary and Assistant Secretary use `secretary`; Treasurer, Assistant Treasurer, Financial Secretary and Assistant Financial Secretary use `treasurer`. The PRO uses `read_only` with `contacts.read`, `contacts.write`, `events.write` and `documents.write`, without requiring `members.write`; a directory projection supplies permitted member identity/contact fields without private profile details. Community / Event Manager uses `read_only` with `events.write` and `documents.write`. Auditor General uses `read_only` with `finance.read`, `finance.export` and `audit.read`, without finance writes. Confidential welfare records still require separately approved welfare permission and current case assignment.

`has_permission()` requires an AAL2 token, an active executive with a current role, no applicable denial, a non-recovery-pending account and a live Auth session whose token issue time is newer than `auth_valid_after`. Definer RPCs pin an empty search path and refer to qualified tables. Anonymous clients have no grants or policies on private tables. Authenticated clients have scoped read policies; no direct client writes are granted. Full membership table reads require membership-write permission; directory users receive a safe projection from `workspace_data` and bounded `search_members`, excluding addresses, emergency contacts, and internal remarks. Welfare reads additionally require the current case assignment. Even an owner does not gain unassigned case contents merely through the owner role.

The last active owner without an expiry cannot be disabled, revoked, deleted, or made temporary. Deferred constraint triggers plus an advisory transaction lock verify this across multi-step and simultaneous role changes. Auth invitation, owner bootstrap, and permission changes have separate audit entries. MFA recovery is an explicit `accounts.mfa_reset` action by another AAL2 owner, with persistent operation/lease, target restriction, supported service-only Auth factor deletion, token cutoff and audited completion. Named infrastructure custodians handle loss of all owners; no general setting disables MFA.

## Records and history

Migration 016 adds private `office_reports` and report-version history, the explicit `office_reports.write` permission, safe `executive_accountability` / `office_report_list` projections, and `monthly_schedule` / `collection_summaries` finance queries. Published report summaries and limited expense fields are available to authenticated AAL2 directory users, without granting them full finance reads or writes. Draft editing also requires the shared office-team scope (or account administration) and live write permission. Actions use actor-bound operation keys, revision checks and preserved snapshots; anonymous users receive no access.

Expense `overview_summary` is explicit shared text. Accountability never falls back to the existing private finance description, payee, reason or attachment paths. Range totals include all matching receipts/expenses, independently of the bounded recent-record lists. The collection totals RPC fixes list-card balances without downloading the entire ledger; monthly schedules use actual non-superseded assessments and confirmed allocations, including selected-member credit. Future-period and overdue presentation is calculated separately from the underlying published obligation amount.

| Canonical tables | Relationships and purpose |
|---|---|
| `executive_accounts` / `role_assignments` | Individual operational account, separate office codes, and dated access roles; office labels do not grant permissions |
| `membership_submissions` | Narrow validated payload, opaque reference, retry key/hash, review state, private possible matches, linked member |
| `members` / `member_history` | Immutable internal ID, sequence-generated permanent Member ID, optional details, archive/merge state, restricted update snapshots |
| `contact_history` | Member FK, channel/date, notes/outcome, follow-up date/state and audited corrections; separate read/write authority; latest contact recalculated |
| `contribution_collections` | Independent monthly or special fund, purpose, period, participation, configurable amount/target, lifecycle |
| `member_assessments` / `assessment_history` | Unique member/collection obligation, approved snapshot and waiver, change reasons and history |
| `payments` / `payment_metadata_history` / `payment_status_history` | One external receipt, original member/amount, revision, deliberate corrections, verifier and separate reversal actor/time/reason |
| `payment_allocations` / `allocation_history` | Current distribution of one confirmed payment; full prior distributions and change reasons |
| `financial_adjustments` | Append-only signed differences/refunds with effective dates; linked replacements carry original adjustment identity/dates forward |
| `expenses` | Collection FK; only approved spending affects balances; reversals preserve original rows |
| `events` / `event_attendance` | Event details; unique event/member attendance with explicit not-recorded state |
| `welfare_cases` / `welfare_history` | Member, assignment, dates, restricted contents and versions; optional expense FK |
| `documents` | Private scoped object path, validated MIME/size, category/description, version link and archive state |
| `branding` / `private_settings` | Separate public identity and restricted operational settings |
| `audit_events` / `command_receipts` | Permission-projected audit metadata; per-actor idempotent command results |
| `invitation_operations` / `account_recovery_operations` | Persistent external Auth operation identity/leases, restricted recovery and audited completion |

Optional education, career, business, social, birthday, and emergency fields use a bounded `members.details` JSON object; profession and searchable custom skills also have dedicated columns (`occupation`, `skills[]`). This is deliberate for a flexible, small cohort and avoids manufacturing optional records. Those details are not an authority for roles, approval, contribution status, or Member IDs. Common contact/location/career indexes and a GIN skill index support queries. Contact details are indexed, not treated as unique proof of identity.

`SET2018-001` is generated by a PostgreSQL sequence during approval or an explicitly approved executive migration. Sequences can contain gaps after rollbacks and must never be reused. Formatting expands beyond 999 without truncation. Registration state, membership activity, archive state, and derived contribution state are separate facts. Missing payments do not change activity.

## Exact arithmetic

All amounts are bounded integer **kobo**, at most 100,000,000,000 per amount (NGN 1,000,000,000). Browser parsing permits at most two decimal places and converts decimal strings to integer kobo. PostgreSQL `bigint` fields, constraints, row locks, and guarded operations enforce the ledger. Currency is initially NGN only.

For payment `p`, as of report generation:

```
net(p) = status == confirmed ? original amount + SUM(adjustment deltas) : 0
active allocation(p,c) = status == confirmed ? current allocation to c : 0
member credit(p) = net(p) - SUM(active allocations for p)
```

A negative refund delta reduces the net receipt. A correction is the documented signed **difference**, not a replacement amount. All allocations after an adjustment must fit the new net receipt. Full reversal changes confirmed status to reversed, so both receipt and allocation contributions become zero while original rows and distributions remain. Pending/rejected payments cannot have allocations. Reversal does not also insert a negative adjustment, preventing double subtraction.

```
approved due(member,collection) = expected snapshot - approved waiver
paid(member,collection) = SUM(confirmed current allocations)
outstanding = MAX(0, approved due - paid)
```

Due zero is waived; positive due with zero paid is outstanding; some paid below due is partial; paid >= due is paid. Overpayment remains identifiable; it is not used to invent new obligations. Only selected eligible members receive assessments when a configured compulsory draft is published. Unknown rates remain null and create no arrears. Changing a collection's configured rate later leaves existing snapshots intact. A justified assessment amendment records before/after history.

Voluntary collections never create member assessments, overdue status, or nonparticipant debt. Their receipts and optional target are progress measures.

```
collection receipts = SUM(confirmed active allocations to that collection)
collection spending = SUM(expenses where status == approved)
remaining allocated fund = collection receipts - collection spending
```

Remaining funds can be negative after approved spending and a later external refund/reversal; this is a real deficit needing executive review, not something to hide. Pending expenses, unrelated member credit, and other collections never enter that calculation. Welfare assistance linked to an expense is not added as a second expense.

### Receipt scope versus coverage scope

Money received in October for September is an **October cash receipt** and **September contribution coverage**. Receipt reports group by the original payment date and include later adjustments to those selected receipts, as of generation time. They are explicitly labelled net/as-of statements rather than an immutable historical daily bank balance. The separate dated cashbook uses refund/correction `effective_date`, so a November refund of an October receipt appears as a November movement. Both reports use current confirmed records and exclude reversed/rejected entries; neither claims historical as-of reconstruction. Coverage reports use the collection's `YYYY-MM` string and approved assessment records. Receipt totals and allocation totals are never added together as separate income.

The report filters are limited to fields applicable to each report type. Report scope and generation timestamp appear on screen and in exports. Unicode names are retained by the database, HTML, and CSV; the PDF exporter embeds licensed local fonts, measures widths and wraps complete tables across pages. Missing glyphs fail explicitly with a CSV/print alternative; names are not silently transliterated. Generated association acknowledgements and statements are not bank-issued receipts. Supporting originals stay separately attached.

## Transactions and retries

`execute_action` first checks live permission, then locks a per-actor retry key and hashes the action payload. Repeating unchanged content returns its first result; changing the content with that key fails. Permission revocation still denies a repeated key. Payment distribution changes lock the parent payment, validate all member/collection relationships and the aggregate available balance, replace the active distribution, and append history within one transaction. Constraint triggers verify final balances before commit. Every distribution/adjustment/transition/detail correction requires `expected_revision`; a stale editor is rejected rather than overwriting a newer distribution. Permission and existing retry results are checked before stale-revision validation so a legitimate lost-response retry can return its first result. Row locks and deferred constraints still protect final balances.

Bank transfer references have a case-insensitive unique index over active pending/confirmed records. An inactive reference may be reused only through its explicit linked replacement. A unique active replacement per parent prevents concurrent duplicates. A replacement represents the same external receipt and carries prior adjustments (with original actor/date/reason/root adjustment identity) to the new record. The old reversed/rejected record contributes zero, so those differences are applied exactly once to the current confirmed lineage. Reversal preserves the original verifier and creates separate reversal/status history; it is not a second refund. Conflicts require officer review; they are not silently discarded or rewritten. Missing bank references use an internal PAY record identifier. Cash uses a generated CASH identifier. Neither invents an external bank reference. Server requests are bounded; public submission rate buckets persist in PostgreSQL; the honeypot and verified bot token provide additional abuse controls.

## Controlled duplicates

Same names or contacts only flag a possible match. Linking a pending submission to a verified member records the review without overwriting the existing profile. Two already-approved duplicates can be merged deliberately by a membership executive, with finance permission if financial records are affected and assigned welfare permission if cases are affected. The source remains archived with its Member ID and a target link. The target profile wins. Overlapping assessments and attendance keep target records only after an explicit confirmation; source snapshots remain in their restricted history. Nonoverlapping obligations and attendance move to the target. Payments retain `original_member_id`, so a merge does not erase their original identity trail. Account links, contacts, allocations, and member documents are relinked transactionally. A failed permission or balance check rolls back the entire merge.

## Storage and data lifecycle

`branding` is the only public bucket. Logos use validated content-addressed public paths and an incremented branding version/query URL; private uploads use actor/scope/target/content-hash paths. Unchanged upload retries reuse that scoped object and document row. The private bucket contains all receipts, expense documents, membership documents, and assigned case files. Both document metadata and `storage.objects` lists enforce scope. The server verifies the caller and live record access before making a 60-second download URL. Uploads are checked by MIME, magic bytes, size, actual static raster decoding/dimensions via sharp, and structured PDF object inspection; scripts/actions/attachments are rejected. There are no unauthenticated upload or profile-edit routes.

History is not routine deletion. Retention settings select a review interval, not an automatic purge. The association must adopt a retention policy and a documented review process for personal data and financial obligations. Back up both PostgreSQL and storage object contents. See the restore/handover guide.

`workspace_data(area,target)` returns the selected workspace instead of copying every private profile/ledger into each page. Overview totals/chart come from `overview_metrics`; member/payment searches are bounded paged RPCs with allowed sort keys. Selected member/collection/payment histories and documents are fetched separately. Reports deliberately request their permitted canonical dataset to reconcile/export all filtered rows. Safe cohort member selectors and some nonfinancial lists still load the cohort; measure these and move large deployments to bounded selectors/report jobs without silently truncating totals. Legacy snapshot compatibility still enforces permissions but is not used by the frontend.

Migration 017 adds immutable receipt roots, one active receipt per root and one preserved successor per receipt. Only the latest reversed/rejected leaf may be replaced; repeated identical operations still return their saved receipt. Document replacement also requires the current unarchived version and permits one successor per version. Existing branched histories stop migration for explicit officer review. No automatic cleanup or deletion is performed.
