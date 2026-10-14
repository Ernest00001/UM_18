# UM18 executive operating guide

## Live website and local interface preview

The live database migrations are installed and the public website is deployed at https://theunmatched.vercel.app. Executives use https://theunmatched.vercel.app/admin/login/ with their individual invited accounts. President MFA and Auth/email configuration remain pending. The separate local interface preview stays available at `http://127.0.0.1:3180`, with executive screens directly at `/admin/overview/`. Public navigation has no executive entry link. The preview uses a generic **Workspace preview** identity and begins without sample operational records. Records and uploaded files entered for interface checks stay in local server memory until the preview server restarts. Use nonpersonal test input; this preview sends no email and does not connect to Supabase.

The operational procedures below describe the configured Supabase system after the remaining Auth and email setup. All nineteen migrations, including event media, eligible executive invitations, accountability, integrity, leadership review and financial-history access, are installed. The first President administrator is created. MFA and subsequent executive invitations remain pending. See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for live verification and remaining acceptance checks.

## Member registration

Members click **Join UM18** on the welcome page. The right-hand hero panel becomes four short phases: Essentials → Your journey → Stay connected → Review. The form grows with its fields and uses page scrolling; a focused field scrolls only if the visible viewport obscures it. Back and review-edit controls retain values. Education/work and personal contact phases are optional and can be skipped. Only name, phone, structured location and data-use acknowledgement are required. There is no account, password, CAPTCHA, payment-status field or public profile editing. Requests remain pending until the President or Vice President reviews them. Confirmation remains in the panel with an opaque reference; it is a submission for review, not approval.

Entered information is kept in page memory while the form is open, not saved as real records in local storage. A full reload clears an unsubmitted form. Submitted preview records remain in the temporary local server until it restarts. Network retries of an unchanged submitted payload reuse its key; changing an already-sent request requires resolving that submission rather than creating an ambiguous retry.

## Sign in and duties

Accept your individual invitation, set a strong password, enroll an authenticator and verify. Existing users sign in and verify MFA. Password recovery uses your own email; a query flag alone never enables reset. Ask an authorised owner if an account is inactive, a role has expired, or the authenticator is lost. Logout ends the session; database requests recheck current authority.

To invite an approved association member as an executive, an account administrator opens the active member's profile and chooses **Invite to executive workspace**. The invitation form opens with their name, email and linked alumni record. Review the address, choose the approved offices and access, record the reason, and submit. Inactive, archived and merged source records are ineligible. **Executive accounts** also provides the general invitation action. This process creates an individual executive account through Supabase; ordinary alumni registration does not create a login.

The executive accepts their Supabase email invitation, sets a password, enrolls TOTP with their own authenticator and verifies it. Their office cards and permitted pages then appear in the executive workspace. Assistants use separate invitations and accounts, sharing their office team's records under their own approved access. An invitation is not evidence that email delivery, acceptance or MFA setup has completed; confirm those steps with the invited executive.

All executives use the same workspace. Navigation and actions reflect their approved access. The association office titles are President, Vice President, Secretary, Assistant Secretary, Treasurer, Assistant Treasurer, PRO, Financial Secretary, Assistant Financial Secretary, Community / Event Manager, and Auditor General. Community / Event Manager is one combined office. An executive may hold more than one office where approved.

Office titles describe association responsibilities and are separate from access roles. Selecting a title alone does not give access. In **Executive accounts**, choose the office, optionally use **Apply suggested access**, review the proposed roles and permissions, and save the approved duties. The first approved President account is explicitly bootstrapped as system administrator. Selecting President or Vice President later does not automatically grant owner access. Member-request review also requires the President or Vice President office and current review permission; other offices cannot review requests. Existing account access remains as assigned until it is deliberately changed.

| Office | Suggested workspace responsibilities |
|---|---|
| President; Vice President | Review member requests and read permitted association, finance and audit information; the first President is explicitly bootstrapped as system administrator |
| Secretary; Assistant Secretary | Maintain approved member profiles, contact follow-up and events; member-request review belongs to leadership |
| Treasurer; Assistant Treasurer | Manage collections, verified receipts, allocations, expenses and financial statements |
| Financial Secretary; Assistant Financial Secretary | Maintain contribution and receipt records through approved finance access |
| PRO | Read the permitted member directory/contact history, record outreach/follow-up, and manage events/documents without editing member profiles |
| Community / Event Manager | Manage community events, attendance and supporting documents |
| Auditor General | Review/export permitted finance records and read audit history without changing the financial ledger |

These are editable suggestions. Export permission is separate and should be reviewed deliberately. Additional grants and explicit denials refine duties, and denials override role defaults. Welfare permission and assignment are granted separately; owning the system does not reveal unassigned case contents.

## Shared office workspaces

Every signed-in executive with directory access can read **Shared executive accountability** on Overview. Select the date range to see net confirmed receipts, approved spending, pending/reversed expense totals, recent expense summaries and published office reports. These are read-only summaries; full payments, member balances, payees and evidence remain in their authorised pages. An expense's **Shared overview summary** is the text shown to all executives. Earlier private descriptions are never copied into this summary automatically. Pending or reversed expenses do not count as approved spending. The net receipts figure follows the original payment dates and includes documented adjustments; it is not a fund balance or a bank statement.

Use **Office reports & minutes** to prepare an office report, meeting-minutes summary or board decision. Drafts belong to the assigned office team and assistant; published summaries can be read by all executives. Writing requires the explicit `office_reports.write` permission as well as office-team scope. The office access suggestion now includes this grant, but selecting a title alone does not enable it. Account administrators can assign it deliberately to existing officeholders. Save a draft, review it and publish with a reason. To correct a published report, withdraw it to draft, revise with a reason and publish again. Revision checks prevent one colleague from overwriting another's newer version, and history preserves each individual actor. Publication here is internal and does not publish to the public website.

**Overview** provides a workspace card for each office team you belong to. President and Vice President share leadership; Secretary and Assistant Secretary share the secretariat; Treasurer and Assistant Treasurer share treasury; Financial Secretary and Assistant Financial Secretary share the financial secretariat. PRO, Community / Event Manager and Auditor General have their respective office workspaces. A person holding more than one office may see more than one team card.

The officeholder and assistant use the same member, contact, contribution, payment, expense, event or report records where their access permits. The cards show active office colleagues and shortcuts to the relevant pages. A shortcut appears only when your current permissions allow it. You can continue each other's work on these shared records without creating a duplicate ledger or separate set of member records.

Use your own invited account and MFA. Changes record the individual actor in audit/history, so shared responsibilities do not require a shared login. An assistant's roles, extra grants, denials, schedules and expiry are configured individually. Sharing an office team does not copy the other person's permissions or expose records that you cannot otherwise access.

## Registrations, corrections and migration

Open **Pending registrations**, search/filter, inspect the submitted details and possible matches. Shared phone numbers/names are clues, not proof of identity. Verify through an existing association channel before approving or linking. Approval assigns a unique permanent `SET2018-…` number in the database. Link to an established member deliberately without overwriting that profile. Reject with a reason where appropriate.

Open **Members** for paged search by name, Member ID, phone, location, work, skills or entry year. Detail tabs connect profile, career, attendance, contacts, documents, authorised history and finance. Long create/correction forms use a dedicated workspace; record a reason. Internal remarks stay separate from member messages. Archive departures instead of routinely deleting; missed contributions do not automatically make someone inactive.

Controlled duplicate merge preserves the archived source Member ID and original receipt identity. Review overlap decisions for assessments/attendance and obtain any additional finance/assigned-case permissions required. The target profile wins; review a correction separately if it needs different values.

For CSV migration, choose a file (maximum 500 preview rows), map the supported identity/contact/education/career/skills columns and preview every row. Validation errors must be fixed or skipped. Possible existing or earlier-in-file duplicates default to **Skip**. After verifying identity, deliberately **Link existing**, **Correct existing**, or **Create separate member**. Linking records migration review without replacing a profile. Corrections show compared fields and require an existing member. A later row may link to an earlier row created during the import. Supply the migration reason; public consent is not fabricated for historical records. Download the per-row success/failure summary and retain it privately. Rechecking/changing the file or mappings rebuilds the preview.

## Contact follow-up

With `contacts.read`, use **Contact history** or the permitted member tab to inspect outreach and scheduled follow-ups. With `contacts.write`, record date, channel, notes, outcome and optional next follow-up date. Correct a record with a reason and mark a follow-up completed/cancelled when appropriate; member last-contact date is recalculated. The PRO can do this work without member-profile editing permission. An external WhatsApp/social link opens only when deliberately clicked. The website sends no automatic WhatsApp messages.

## Monthly and special collections

**Monthly dues** starts with a January–December schedule and year selector. Find a member to see their coverage and unallocated credit, or use the association totals. Each month retains all of its independent collections. Draft or unassessed months are unset and add no debt. Future assessed months remain marked **Future**, with paid/partial-in-advance notes where applicable. Overdue amounts are calculated only for current/past assessed periods after the explicit deadline, or after month end when no deadline is recorded. Approved waivers remain distinguishable from an unset month.

To record a payment ahead, approve and publish the future months and member assessments first. Select the member in the schedule, choose **Record advance payment**, record the actual transfer once, explicitly confirm it after checking receipt and add an allocation for each covered month. If a future rate is unknown, retain the money as member credit and allocate the existing receipt after approval. Credit is not automatically distributed and monthly obligations are not automatically created. Special funds remain independent and are created when needed.

Create each collection with its own title, purpose, category, period/event details, participation rules, approved amount where relevant, target/deadline and supporting documentation. Start as draft; review before opening. Multiple collections in one month stay independent.

For compulsory monthly dues, enter that month’s approved amount and deliberately select eligible members using the member picker/filter. Publication snapshots each obligation. A later configured amount does not rewrite existing assessments. Add newly eligible members through **Add assessments**, with amount, effective date and reason. Amend an existing obligation or waiver explicitly, with history. Unset dues create no fabricated arrears; no graduation-to-present debt is automatically generated.

For voluntary appeals/donations, contributions and optional target progress are tracked, without debt for nonparticipants. Keep compulsory and voluntary rules clear in the collection purpose. Detail pages connect contributors, assessments, financial movements, documents, reports and linked events. Close with a reason after reviewing remaining credit, pending verification, expenses and reconciliation. Closing does not erase history.

## Payments, allocation and credit

Payments happen outside this website. Identify the member, verify actual receipt through approved association procedures, and record amount, NGN currency, payment date, method, true external reference if supplied, note and optional evidence. A screenshot alone is not confirmation. If already checked, explicitly select **I have checked actual receipt…**; otherwise save pending. Only confirmed amounts affect receipts and coverage.

Record each real transfer once. Allocate it to multiple monthly/special funds on the same member as needed. Unallocated confirmed money remains visible credit. Assignment of credit later is an allocation, not new income. Cash receives an association `CASH-…` identifier; missing bank references use an internal `PAY-…` reference rather than invented bank evidence. A repeated transfer reference needs review; do not alter it simply to bypass the conflict. For transfers without conclusive references, verify the ledger manually before confirming a second entry.

Open the payment detail for recording/verification officers, evidence, distribution, status/amount/allocation/correction history and member/collection links. Confirm or reject pending payments with a reason. **Allocate/reallocate** replaces the active distribution in one transaction and preserves its predecessor. Stale edits fail and require refresh. Saving the unchanged form again after a lost response uses the original operation key; failed writes never show as successful records.

**Correct receipt details** changes member/date/method/reference with a reason and preserved before/after snapshots. Changing member releases the old allocations so they can be assigned deliberately. The original member FK and amount remain preserved.

**Refund / amount correction** records the signed difference and effective date. A refund subtracts money; a correction may add/subtract a documented difference. Adjust the distribution to fit the new balance. A refund of unallocated credit is not shown as a refund from an unrelated collection. **Reverse** invalidates the receipt and its coverage once while preserving original verification and a separate reversal actor/reason. It does not also insert a negative refund.

The latest reversed/rejected entry without an existing replacement may be replaced through **Record linked replacement** when correcting the same real receipt. It is not a new external transfer. Enter the recorded base receipt amount; earlier refunds/corrections carry forward with original dates, actors and reasons. Only the current confirmed replacement contributes to receipts. Reconfirm externally and choose allocations again. Record any further amount difference as a documented correction. Avoid repeated replacement chains where a simple audited metadata correction suffices.

An acknowledgement summarises association records; it is not a bank-issued receipt. Evidence originals remain separately linked.

## Expenses and special-fund statements

Record expense date, description, payee, amount, responsible officer and collection. Attach budgets, invoices/receipts or approval notes where available; do not invent documents. Approve only after the association’s checks. Only approved expenses count as spending. Reverse an approved expense with a reason when correction is needed; keep the original.

Collection statements show purpose/period/rules, contributors and verified allocations, expected amounts where meaningful, expenses, allocation changes/refunds, remaining fund, scope and generation time. Remaining fund = net confirmed allocations to this collection minus its approved spending. It excludes unrelated member credit and pending evidence. A later refund can expose a real deficit; investigate rather than hiding it.

## Events and attendance

Create an event with title/date/location/description and optionally link its special collection. The dedicated event page provides searchable attendance and event documents. Save present, absent, excused or **not recorded** explicitly. Unrecorded attendance remains unknown, not absent. Paying a collection does not prove attendance.

Keep public location and public description separate from internal event notes. A public upcoming event appears in the homepage announcements while its event date has not passed. Upload a validated PNG, JPEG or WebP poster or photo within 3 MB, provide accessible image text, and deliberately select the announcement banner or gallery visibility. A poster serves as the banner; private meeting documents do not become public images.

Close the event with a reason after recording attendance and reviewing its materials. It leaves upcoming announcements; a public closed event appears in the gallery with its banner and photos selected for gallery display. Unpublish an event or archive an image with a reason if it should no longer appear publicly. The image bucket remains private; public access uses temporary URLs for media that is currently eligible for publication. Do not upload confidential member, receipt or case information as event publicity.

## Welfare and handover

Assigned welfare officers use dedicated case forms for category, description, status, dates, actions and optional assistance linked through an expense. Supporting case files stay restricted. Owner/system case-assignment metadata shows only case reference/status/officer; an owner needs assignment plus welfare permission to inspect contents.

A permitted **welfare.assign** operator can hand over cases to a currently eligible welfare officer, including after the outgoing officer is revoked. Record a reason. The outgoing officer immediately loses assigned-case access. Welfare assistance linked to an expense is counted in the finance ledger once. General directory/contact exports and general audit projections exclude confidential case contents.

## Documents

Upload from a member, collection, payment, expense, event or case workspace, or choose a permitted record in **Documents**. Set title, category and description. Accept only validated PDF/PNG/JPEG/WebP within the 3 MB private limit; logos use 2 MB. Executable/active PDFs and invalid raster content are rejected. Preview/download requires current record permissions; issued URLs expire after 60 seconds.

Edit descriptive metadata with a reason. **Upload new version** preserves the previous version and its link; do not use it to manufacture missing evidence. Archive with a reason to hide from the ordinary active list while retaining history; restore where permitted. Storage and metadata access both enforce scope.

If an upload reports an error after sending the file, keep the operation unchanged and retry or ask the infrastructure custodian to review it. The file is retained because a lost response may hide a completed metadata link. Do not manually delete it as an assumed orphan; cleanup requires checking database references and preserved versions/history first.

## Reports and deliberate exports

Choose report type and relevant filters: membership/location/skills/review, monthly coverage, received receipts, dated cashbook, compulsory outstanding, voluntary progress, special statements, expenses, attendance or restricted welfare. Read the displayed scope and generation time.

Receipt reports select original payment dates and show current net values including later adjustments. The **dated cashbook** instead places refunds/corrections on their effective dates; it is current-record reporting, not an immutable historical bank reconciliation. Contribution coverage uses collection periods. Do not add receipts and allocations together as income.

Table search/sort applies to CSV/PDF/print and the audit scope. Exports include all matching scoped rows, not only the visible page. PDF tables wrap and continue across pages; print includes the complete filtered document. Preserve spelling in CSV; spreadsheet formulas are neutralised. If a PDF reports an unsupported character, use CSV or browser print rather than changing the member’s name. Keep exports private and delete temporary copies according to adopted retention rules. Generate a member statement for a verified request without creating a member login.

## Branding, accounts and audit

**Branding and settings** stores organisation name, short name, slogan, optional school/contact information and logo. Unknown school/contact fields remain unset. Preview a valid PNG/JPEG/WebP logo, save, and refresh public/executive pages; versioned URLs change without redeployment. Transparent PNG works. Revert to the readable text fallback if needed. Private settings never appear through the public branding endpoint.

**Executive accounts** invites individual emails, optionally links membership, records association offices separately from access roles, combines access roles and assigns per-role effective dates. Office checkboxes identify responsibilities; **Apply suggested access** prepares a proposal for review and saving. Set extra grants/denials and expiry deliberately. Use permanent owners, keep at least one active, and verify a successor before revoking the predecessor. Export/welfare privileges are explicit. Revoking privileges takes effect at the database even if an old tab still shows a control.

For another executive’s lost authenticator, an independently verified owner with **accounts.mfa_reset** verifies identity through association channels, records approval/reason and performs the audited reset. This blocks old tokens and requires a fresh enrollment. Self-reset and a public MFA bypass are unavailable. If recovery fails, preserve the restricted state and involve an infrastructure custodian. Do not record OTP secrets/passwords in audit notes.

Use **Audit history** and the selected record history to review actors, changes and reasons. Restricted payloads are projected/redacted according to the viewer’s permissions. See the backup/restore guide for paired file/database snapshots, retention review, a pilot, and infrastructure ownership handover. Database backup alone does not preserve uploaded file bytes.
