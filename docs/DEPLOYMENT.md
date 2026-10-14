# Configure Supabase and deploy to Vercel

## Current stage: database installed; Auth and hosting pending

All nineteen migrations are installed in the association's Supabase project `hpbzhaleqphfucnautpl`, verified on 14 October 2026 through the Supabase plugin. See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for the ledger and live checks. The first President administrator is bootstrapped. Auth/email configuration, President MFA, Vercel deployment, live acceptance and backup/restore remain pending. The local interface preview remains separate from this database.

For local interface review, use `npm run build:preview` and `npm run preview`. This builds `.local/ui-preview` and serves `http://127.0.0.1:3180`, with executive screens at `/admin/overview/`. It starts with empty operational records and the generic **Workspace preview** identity. Local server-memory records and uploads last until the preview server restarts; they are not Supabase data. Public navigation contains association content rather than an executive entry link. `npm run build` remains the production default for `dist`, excluding preview/review services and fixture records.

## Association-owned projects

Use association-controlled email, billing, domain/DNS and recovery contacts for Supabase, Vercel, source hosting, SMTP, Turnstile and backup storage. Maintain named primary/secondary infrastructure custodians with MFA. Vercel is the production target for the Node server endpoints after interface review and backend setup.

Use a dedicated Supabase project: the initial migration deliberately replaces public-schema grants. Do not apply it to a shared application database. Keep staging and production projects separate.

## Database installation and future migrations

For a fresh dedicated project, apply **all nineteen SQL files**, in filename order, under `supabase/migrations/`. The first three preserve the initial schema; later migrations add the upgrades without resetting member sequences or deleting records. Migration 013 adds executive office titles separately from access roles, plus explicit contact-history read permission. `202610140014_public_events.sql` prepares event lifecycle, publicity fields and private event posters/photos. `202610140015_active_executive_invitations.sql` prepares active, unarchived, unmerged member eligibility checks for linked executive invitations. Migration 016 adds executive reports, safe accountability summaries and monthly schedules. Migration 017 corrects the production workspace contracts and contact permissions, and enforces receipt-lineage and document-version integrity. It stops for manual review if existing history branches; it never silently removes preserved records. Migration 018 bootstraps the first administrator as President and restricts member-request review to the President and Vice President with current review permission. It removes review from the secretary role while preserving existing office assignments and explicit grants. Existing leadership accounts must have a deliberate review grant; other offices cannot review even if a stale grant exists. `20261014171907_financial_history_access.sql` removes inherited browser write/TRUNCATE privileges from financial history, requires explicit browser grants on future application tables created by the migration role, and caches Auth identity in welfare policies. All nineteen files are already applied to the current association project; do not manually run them again. For a fresh project or future unapplied files, inspect the installed CLI's help and use its migration ledger:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REFERENCE
supabase db push
```

Check the migration ledger and every returned error. The migrations create public branding/private document buckets, policies, live permissions, transactional RPCs, scoped queries, document/version links, session checks, invitation/recovery operations and financial history. No default anonymous directory policies or authenticated write policies are needed. Preserve `auth.sessions`; the current database permission check verifies the token’s `session_id` against its actual Auth user, so deleted sessions fail immediately.

Migration 014 also creates the private `event-media` bucket for validated event posters and photos. The public upcoming/gallery feeds project only event publicity fields, and the server signs only currently eligible public media. A coordinated backup must preserve object bytes from all three buckets: `branding`, `private-documents` and `event-media`, alongside matching database metadata. Verify each bucket's publicity setting and restored file links during the staging restore drill.

Uploads are kept when a metadata commit fails or returns an uncertain response: that object may already be linked by a successful or concurrent commit. Retry the unchanged operation instead of deleting its bytes. Before removing a suspected orphan, an infrastructure custodian must verify current and preserved database references/history, including document versions and event-media records. Ambiguous failures never authorise automatic object deletion. Record any later cleanup and retain the matching protected backup.

## Auth and email settings

1. Disable public signup and anonymous sign-ins in Supabase Auth. There is no member account or executive signup page.
2. Enable TOTP enrollment/verification. PostgreSQL requires AAL2 for private records and administrative actions. A live AAL1 executive receives only setup context.
3. Set Auth Site URL to the exact production origin. Allow only approved `/admin/login/` redirect URLs for production, staging and local development.
4. Configure approved SMTP and default supported invitation/recovery confirmation links. This static application uses the SDK’s **implicit browser flow**: Supabase verifies the emailed link and returns its authenticated fragment to `/admin/login/`. It does not depend on a PKCE verifier being present in the invitation recipient’s browser. Do not replace templates with a custom token-hash route without implementing and testing that route.
5. Enforce a strong password policy (the UI requires at least 12 characters) and association-approved session limits. Test invitation acceptance in a fresh browser and recovery for an existing MFA user.

Only a successfully accepted `invite`/`recovery` callback bound to the current session enables password setup. Adding `?recover=1` cannot enable it. An invalid link cannot reuse some other existing session to change its password. Verified MFA factors are preserved; abandoned unverified enrollment factors are removed when restarting setup.

## Server and browser configuration

Configure Vercel Production variables separately from Preview. Preview must use a fictional staging backend.

| Variable | Use |
|---|---|
| `APP_MODE=production` | Required server mode |
| `SUPABASE_URL` | Public project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Public browser key; private data remains protected by RLS |
| `SUPABASE_SECRET_KEY` | Server-only privileged key |
| `APP_ORIGIN` | Exact canonical origin, without trailing slash |
| `RATE_LIMIT_SALT` | Server-only random value, at least 32 characters |
| `TURNSTILE_SITE_KEY` | Public bot widget identifier |
| `TURNSTILE_SECRET_KEY` | Server-only bot verification secret |
| `ALLOW_LOCAL_NO_BOT=false` | Keep false on Vercel; exception is only for deliberate localhost testing |

Public registration fails closed without required production bot/rate-limit configuration. The server validates hostname, a honeypot, strict fields and bounded bodies. Distributed rate buckets store HMAC-hashed request IPs in PostgreSQL, not process memory.

Static JS does not automatically inherit Vercel variables. `runtime-mode.js` is only a build-selected mode. In production, **GET `/api/config`** delivers Supabase URL, publishable key, permitted bot site key and timezone with no-store caching. **GET `/api/branding`** returns only approved public identity/contact values and logo URL. Neither endpoint exposes all environment variables, private settings, account IDs or financial/member/case records. Config failure blocks operations; it never enables fictional login or simulated writes.

## First owner and later invitations

The current association project already has its first **UM18 President** administrator. Do not repeat its bootstrap. The steps below apply to a fresh project; this project's next steps are production sign-in configuration and President MFA enrollment.

On a trusted machine, securely load server variables and run:

```bash
node --env-file=.env scripts/bootstrap-owner.mjs
```

Enter the approved President’s individual email and display name. The first account receives the President office and system administrator role. The President then invites the Vice President and other executives through Executive accounts; they do not require manual Supabase account creation. The script checks server-only `bootstrap_status` before sending a first invitation, then calls locked `bootstrap_owner`. Accept the email, choose a password, enroll TOTP and verify. No shared password or hardcoded credential exists. The database protects the final active permanent owner.

If delivery or bootstrap was interrupted, inspect Supabase Auth before repeating it. A named infrastructure custodian may call `bootstrap_owner(existing_auth_uuid, approved_name, approved_email)` through the secret-key service role only after verifying no owner has already been provisioned. Preserve the audit result and keep secrets out of SQL files/chat.

Invite later executives in **Executive accounts**. The signed-in owner needs current AAL2 `accounts.write`; the server verifies the token with `getUser` and rechecks authority before each privileged action. Invitations use a persistent operation key/lease. Completed retries return the original identity; a known identity is not re-invited. If access provisioning fails, the same unchanged operation can resume after its lease ends (two minutes). If delivery was uncertain before identity recording, the request fails for manual Auth review rather than sending blindly again.

An account administrator can start from an approved active member profile with **Invite to executive workspace**. `/admin/accounts/?invite_member=…` prefills their name, email and linked member record; offices and access still require a deliberate choice. The invitation path validates that the linked record is active, unarchived and not a merged source before provisioning. The recipient accepts the Supabase invitation, sets a password, enrolls TOTP and then uses their permitted office workspace. Invite each officeholder and assistant individually. Alumni registration remains independent of executive Auth accounts.

An infrastructure custodian can review `invitation_operations`, verify the emailed Auth UUID and actor-approved payload, bind an uncertain pending operation to that identity through the trusted restore/admin connection, and retry provisioning with the original lease/actor and exact approved fields. Do not give a new identity access merely because it exists in Auth. `provision_invited_account_v2` is a service-only manual repair operation; it still checks the inviting actor’s current authority and audits roles, denials and schedules. Record any repair separately. Never use a shared password to resolve delivery failures.

Role start/expiry dates, additional grants and explicit denials are separate. Denials override role grants. Use an immediately effective role for initial setup; scheduled future roles provide no operational access before their start. Confirm the successor can enroll MFA and administer accounts before handover.

Set the executive's association office or offices in **Executive accounts** separately from their access roles. The supported offices are President, Vice President, Secretary, Assistant Secretary, Treasurer, Assistant Treasurer, PRO, Financial Secretary, Assistant Financial Secretary, Community / Event Manager, and Auditor General. Office selection records responsibility and does not grant permissions. **Apply suggested access** fills the proposed duties for review; saving the approved roles, grants, denials and schedules provisions actual access. President and Vice President titles do not automatically create owners. Keep owner/system administration assigned explicitly to verified custodians, and retain at least one active permanent owner.

All offices share the executive workspace. Leadership suggestions use read-only access with finance/audit review. Secretary and Assistant Secretary suggestions use the membership access role; Treasurer, Assistant Treasurer, Financial Secretary and Assistant Financial Secretary suggestions use the finance access role. The PRO uses read-only access with contact read/write, events and documents; the combined Community / Event Manager uses read-only access with events and documents. Auditor General uses read-only access with finance read/export and audit read, without finance-write access. Review any export grants separately. Confidential welfare access remains assignment-scoped and is granted separately from these office titles.

Assign officeholder and assistant titles to separate invited accounts. Overview groups President/Vice President, Secretary/Assistant Secretary, Treasurer/Assistant Treasurer and Financial Secretary/Assistant Financial Secretary into their shared office workspaces, alongside the other offices. Each team uses the same underlying association records and sees active colleagues; workspace links still follow each individual's current permissions. Verify both accounts in the pilot, including a deliberate denial or expiry on one assistant. Confirm the denied page stays unavailable to that assistant and that writes from each account retain the correct actor in audit history. Never share an office password or copy access implicitly from its team grouping.

## Audited MFA recovery

An independently authenticated AAL2 owner with **accounts.mfa_reset** may reset another executive’s factors after identity verification and a recorded reason. Self-reset is forbidden. The server persists a recovery operation, restricts the target account, advances its token-validity cutoff, uses supported Auth admin factor APIs, and completes through a service-only audited RPC. Old AAL2 claims remain rejected after completion. The target signs in again and enrolls a new factor. Failed/uncertain recovery leaves the target restricted for investigation. Owners must coordinate recovery of another owner so a working owner remains.

If all authorised owners lose MFA, use the association’s named Supabase infrastructure custodians and provider recovery procedures. There is no public bypass. See the handover guide.

## Vercel settings

Use **Other** preset, **Node 24.x**, install from lockfile, build command **npm run build**, output **dist**. The package pins Node 24.x, a supported Vercel runtime checked against current documentation. Import/deploy the whole source project, not `dist` alone: `api/config.js`, `branding.js`, `register.js`, `documents.js` and `accounts.js` must become Functions alongside static assets.

`vercel.json` has security headers and narrow detail rewrites; there is no catch-all HTML rule intercepting `/api`. Private document preview frames allow the configured Supabase HTTPS origin pattern; keep the rest of the CSP restricted. `sharp` is used by Node functions to decode static PNG/JPEG/WebP uploads. Test its deployment and your function payload limits.

Use **npm run build:preview** only for the separate localhost interface preview. Preview and review modes are rejected when `VERCEL_ENV=production`. Never publish the localhost preview or real records through test fixtures.

For the actual Vercel deployment, use **npm run build** and the complete source project. This build removes fixture records and the review service; the executive sign-in and application use the configured Supabase Auth/database. Set the approved production origin before sending invitations and verify real invitation delivery, password setup and MFA enrollment with individual test executives. No project deployment or invitation delivery is established merely by a successful local build.

## Verify the configured project before the pilot

- Inspect `/api/config` and `/api/branding` for the exact safe fields, correct origins and absence of secrets/private data.
- Reload `/`, `/register/`, confirmation/privacy/help and every executive area. Detail pages use query IDs; APIs must return JSON/errors, not an HTML fallback.
- Submit without login, fail a field, retry a lost response with the same payload/key, and confirm one pending row and only a generic opaque public response.
- Test anonymous/forged private requests and privileged registration fields directly. Test AAL1, expired roles, denials, inactive users, deleted sessions and revoked old tokens.
- Accept two individual invitations in fresh browsers; test recovery, abandoned enrollment restart and separately authorised MFA reset.
- Record a verified transfer across two months and a special collection, leave credit, refund on a later date, correct metadata and replace a reversed receipt. Reconcile payment-date reports, dated cashbook, collection coverage and history.
- Upload/version a logo and refresh another public tab. Test private document lists, direct URLs and wrong-assignment exports. Signed URLs expire after 60 seconds; an already issued URL remains usable until then.
- Create a public upcoming event with a poster, then close it and select gallery photos. Confirm the homepage announcement/gallery changes, private notes/attendance remain absent from public feeds, and an unpublished or archived image no longer receives a new public URL.
- Run the staging concurrency script and paired database/file restore drill. Test 360px, tablet/desktop, real keyboard focus, mobile drawer and screen-reader announcements. Local DOM assertions are not that acceptance evidence.

## Official references checked during implementation

- [Supabase JS](https://supabase.com/docs/reference/javascript/installing), [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Sessions](https://supabase.com/docs/guides/auth/sessions), [invitations](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail), [MFA](https://supabase.com/docs/guides/auth/auth-mfa)
- [Storage](https://supabase.com/docs/guides/storage/buckets/fundamentals), [backup scope](https://supabase.com/docs/guides/platform/backups)
- [Vercel builds](https://vercel.com/docs/builds), [Node Functions](https://vercel.com/docs/functions/runtimes/node-js), [Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Turnstile verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

These provider details were checked on 13–14 October 2026. Actual project integration, email delivery and deployment behavior still require the checks above.
