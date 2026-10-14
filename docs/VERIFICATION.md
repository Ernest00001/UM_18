# Executed verification and remaining checks

## Current scope and local verification

The current stage is UI/UX review first. No live Supabase migration, Vercel deployment, executive invitation or backup/restore was performed in this pass. Scripts 014 (event lifecycle/publicity/posters/photos), 015 (eligible active-member executive invitations), 016 (shared executive accountability, reports and monthly schedules), 017 (production contract and receipt/document integrity), and 018 (President bootstrap and leadership member-request review) are prepared for the later backend stage. PostgreSQL tests apply all eighteen ordered scripts only to an embedded test database with fixture Auth/Storage schemas; this is separate from applying a migration to a live project.

The local interface preview was built with `npm run build:preview` into `.local/ui-preview` and started with `npm run preview` at `http://127.0.0.1:3180`. It begins with empty operational records and the generic **Workspace preview** identity. Temporary records/uploads live in the preview server's memory and persist across page reloads while it runs; restarting the server clears them. No sample member, receipt, collection or event records are preloaded. The preview has no Supabase connection and sends no email.

The default `npm run build` targets production `dist`, excluding fixture records and preview/review services. Public navigation contains no executive entry link; executive screens are available directly under `/admin/`. Office titles and shared team shortcuts do not grant authority. Production access remains governed by the active account's role assignments, grants/denials and effective dates.

The latest local run on 14 October 2026 passed **302 tests, with 0 failures and 0 skipped**. `npm run check` validated **51 JavaScript modules**. Production and interface-preview builds succeeded. The suites cover all eleven office titles, shared officeholder/assistant workspaces, PRO contact access, member-to-executive invitation eligibility, event publicity/media, empty-preview isolation, registration scrolling, shared accountability, report permissions/revisions, monthly schedules and loading retry behavior. Five responsive tests additionally cover drawer focus/cleanup, obscured-field scrolling, keyboard viewport updates, and mobile local/paged sorting with retained export scope. The runner counts parent and nested tests. Actual device keyboard, assistive-technology and live integration checks remain outstanding.

The browser checks completed so far opened registration at 360×740 and confirmed page scrolling without an inner form scroll box. At a reduced 360×400 viewport, the focused phone input stayed within the visible area (top 333px, bottom 380px). These are browser viewport checks, not a physical phone or real keyboard test.

A desktop walkthrough created a temporary event, uploaded a poster and a separate photo, verified the homepage announcement contained only public location/description, then closed the event and verified distinct Posters and Photos gallery sections. The executive invitation form displayed all eleven offices and stated that the local preview sends no email. Restarting the preview cleared the temporary event and images; the gallery returned to its empty states. The source screenshot of the improved form is `.local/registration-ui.jpg`.

The accountability walkthrough saved a temporary Secretary minutes draft, published it and verified its title, summary, author/date and revision on Overview. A desktop and settled 360×740 viewport check verified the January–December schedule; the phone page had no horizontal overflow and displayed unset months without obligations. The maroon/white 18 loader was visually inspected in an isolated copy of the real page shell; automated checks exercise its timeout/retry and reduced-motion styling. Temporary reports were cleared before handover. Screenshots are `.local/accountability-overview.jpg`, `.local/monthly-mobile.jpg` and `.local/page-loading.jpg`.

The later UI control audit covered 494 rendered anchors across 56 distinct targets, all 16 executive pages, all seven public pages, login, detail links, form/dialog controls, and recoverable service failures. Native browser navigation opened all 16 executive pages and verified the global Search result, monthly year/member-search feedback, registration wording and the relocated Overview heading. An isolated local server returned 200 for 24 page routes and 11 assets and 404 for three missing paths. The active review server was preserved with its saved change; its latest frontend is rebuilt, while the new missing-path HTTP status takes effect on a later restart. See [UI_AUDIT.md](UI_AUDIT.md) for fixes, coverage and limitations.

The production audit corrections and fifteen added regression tests are recorded in [PRODUCTION_AUDIT_FIXES.md](PRODUCTION_AUDIT_FIXES.md). Migration 017 is supplied for later setup, including preflight rejection of existing branched histories. Native navigation was rechecked after the corrections; the active review server and saved changes were retained.

The responsive review completed **144 browser page checks** over 16 executive areas, seven public pages and sign-in at 320×568, 390×844, 768×1024, 1440×900 and 740×360. This represents 120 distinct page/size combinations with tablet repeats after touch-size improvements. No page-level horizontal overflow or page error panels were observed. An isolated local server supplied long test names, reports, collection titles and event posters/photos; no fixture records were added to the user's running preview. Registration phases, member/payment entry, receipt allocation, report drafts and executive invitation dialogs received additional narrow-screen checks. At 320×400, the invitation dialog kept its actions visible and scrolled its content. These results are browser checks; real iOS/Android keyboards, Safari and assistive technology still need acceptance testing. See [RESPONSIVE_REVIEW.md](RESPONSIVE_REVIEW.md); the inventory and screenshots are under `.local/`.

A subsequent loading-duration change keeps the initial public and executive loader visible for at least two seconds. Its existing 20-second stalled-load retry remains independent. Nine focused loading/navigation tests passed, including actual public/executive module rendering held behind the minimum-display promise. The full suite was rerun before the initial GitHub push and passed all 291 tests.

The later leadership review change passed the full 302-test suite. Eleven added checks cover the first President administrator, leadership-only request reads/approvals/linking/rejections, missing grants, MFA, stale-command retries after office handover, denials, expiry, revocation, existing-account migration, local preview checks and blocked UI access. Migration 018 is prepared only; no live Supabase change or invitation was made. The homepage step cards use maroon for cards 1 and 3 and the supplied pale blush `#f6eeeb` for cards 2 and 4; desktop and phone layouts were visually checked. The current frontend preview is rebuilt while the existing server and saved records remain intact.

| Local verification area | Evidence and scope |
|---|---|
| SQL migrations | All ordered migrations applied to embedded PostgreSQL (PGlite), with fixture Supabase Auth/Storage schemas |
| Anonymous and unauthorised users | Private table reads/writes and administrative RPC denied; safe branding readable |
| Public registration | Four-phase progression/back/edit/skip controls, retained values after validation/lost response, strict payload/retry rules; focus/viewport tests scroll only obscured fields, respect reduced motion/zoom and preserve highlighted-field focus after rejection |
| Members | Deliberate approval/linking, duplicate flags, stable sequence including Member 1000, protected direct mutations |
| Access | AAL1 denial, AAL2 requirement, inactive/revoked accounts, deleted Auth sessions, token cutoff, explicit export denials and permanent-owner protection |
| Directory privacy | Read-only RPC projection excludes internal notes, addresses, and emergency details |
| Assessments | Independent monthly rates, unchanged published snapshots, no unknown-period arrears, voluntary fund without debt, recorded waiver |
| Receipts and allocations | One transfer across multiple collections, credit, pending exclusion, duplicate reference/retry handling, excessive/mismatched allocation rollback |
| Adjustments | Stable-key refund retries, fund-specific movements, stale revision rejection, metadata corrections, verifier-preserving reversal and adjustment-carrying replacement counted once |
| Ledger reports | Payment date versus period versus adjustment-effective-date cashbook; collection reconciliation; searched/sorted CSV rows match audited scope |
| Restricted records and files | Assigned cases, revoked-officer handover via metadata, scope-bound upload retry, private list/RPC denial, permission-projected audit payloads |
| Duplicate merge | Source Member ID preserved, original receipt member FK retained, target assessment policy explicit, active obligations reconciled |
| Attendance/imports | Not-recorded remains unknown; contextual event workspace; broad CSV mapping, same-file duplicate detection and no fabricated consent |
| Safe data handling | HTML escaping, CSV formula protection, money precision, body bounds, origin checks, persistent DB rate bucket |
| PDF and files | Multi-page PDF parsed; an 85-row, five-page sample rendered in Poppler and all pages visually inspected; Nigerian/CJK/Arabic/rare-Han glyphs, repeated headers, wrapping and footers checked; structured PDF script/action and type/size rejection |
| Config/build | Browser response excludes server secrets; production assets exclude fixtures and review/preview services; review/preview modes rejected in Vercel production; empty preview output stays separate from `dist` |
| Executive UI | All 16 areas mount; connected member/payment/expense/event/case views, table controls, correction/adjustment flows and explicit export permissions |
| Auth operations | Callback acceptance/password gating; persistent invitation identity/completion retry; service-only MFA recovery with target restriction and old-claim denial |
| Executive offices and invitations | Eleven office choices, deliberate suggestions without automatic owner access, independent assistant permissions, safe shared-team cards; active/unarchived/unmerged member context prefills the executive form without assigning access |
| Executive accountability | AAL2 directory users read limited expense/publication summaries without private ledger access; explicit expense overview text, separate pending/reversed totals, paired-office drafts, revision checks, actor-bound retries and permission revocation |
| Monthly schedule | Twelve canonical months, approved snapshot coverage, fully waived versus unset periods, future versus overdue balances, selected-member credit and advance-payment prefill; collection cards use aggregate queries |
| Page loading | White 18 and circular indicator on maroon, initial public/executive shells, reduced-motion styling and independent timeout/retry when application modules stall |
| Event publicity and media | Public upcoming/gallery projections, closed-event lifecycle, validated posters/photos, banner/gallery eligibility and restricted media access; private notes/attendance/documents remain outside public feeds |
| Empty interface preview | No preloaded operational records, generic workspace identity, localhost server-memory changes/uploads, unavailable live APIs and production exclusion |
| Routing/responsive source | Static page-family generation, API-excluding rewrites, responsive CSS, horizontal tables, focus and reduced-motion rules |

Visual PDF review caught a CFF/unaligned-glyph subsetting problem that serialization tests missed. The final licensed static CJK TrueType asset preserves its full cmap and aligns glyph records for correct fontkit subsets. Application exports use this validated asset; an extended-script export fetches the 21.8 MB font lazily and saves a small subset. This is not a first-page load. Mixed-direction paragraph layout beyond the tested Arabic names remains a pilot check.

The PGlite allocation race queues operations through one embedded database connection. It verifies transactional arithmetic and rollback but is **not** a real multi-connection PostgreSQL MVCC stress result. Linkedom is a DOM test harness with narrow shims for browser form/dialog APIs. It verifies rendering and control wiring, not actual visual layout, keyboard focus, screen-reader announcements, contrast in a rendered browser, or real downloads.

Private uploads are retained if their metadata commit fails or its response is lost, because a successful or concurrent commit may already reference that object. Cleanup of possible orphan files must verify database references and preserved history first; ambiguous failures do not trigger automatic object deletion.

## Not executed without infrastructure

- Real Supabase Auth token verification, invitation/recovery email delivery, MFA enrollment, live RLS through PostgREST, and Auth configuration.
- Storage upload/signing/direct HTTP access checks against the real buckets.
- Vercel Function routing, deployed runtime configuration, hostname bot validation, and error/retry behaviour over a real network.
- Multi-connection concurrent approvals and contested allocations.
- Actual phone/tablet keyboards, mobile browser behavior, real keyboard and assistive-technology walkthrough. The 360px browser viewport checks above do not establish this acceptance.
- A paired database/object-content backup and staging restore drill.

The localhost UI preview and embedded tests do not establish real Auth/email delivery, deployed RLS, storage URLs, Vercel behavior or a successful recovery drill. No live database or Vercel deployment is claimed.

## Configured staging stress run

Use a designated fictional Supabase staging project and prepare at least two pending test submissions. An active AAL2 test owner must hold membership review and finance permissions. Load `UM18_TEST_ACCESS_TOKEN` into the environment securely rather than passing it as a shell argument or committing it to a file.

```bash
UM18_LIVE_TEST_CONFIRM=FICTIONAL_STAGING_PROJECT node --env-file=.env.staging tests/live-integration.mjs
```

This script sends genuinely simultaneous HTTP RPCs through Supabase, verifies anonymous denial, concurrent unique member numbers, concurrent identical receipt retries, and contested allocations bounded by one payment. It reverses and archives its test records instead of erasing audit history. Run it only after project ownership and staging isolation are confirmed. It was supplied but not executed during this build.

## End-to-end pilot walkthrough

Follow the deployment checklist, then walk the public form → pending queue → approval → member profile. Enter deliberately invalid fields and ensure previously valid input stays. Retry a dropped submission response and verify one pending row. Compare secretary, treasurer, welfare officer, read-only and revoked identities using direct API calls as well as UI navigation.

Create two different monthly amounts, a future unset month, a voluntary reunion fund, and a waiver. Record one external-transfer test receipt with multi-collection allocations and credit. Keep another receipt pending; reject it; ensure it never changes totals. Refund or correct a receipt and redistribute its allocations. Reverse it once and reconcile receipts, coverage, expenses, and the special collection report.

Attach a receipt and assigned case file, inspect direct URLs with unauthorised users, replace the logo, reload public/executive pages, import a CSV with duplicates and a malicious spreadsheet string, and verify scoped exports. Record an event with at least one member not recorded. Test every sidebar page and critical dialog at 360px, on desktop, with a keyboard and a screen reader. Finish the staged restore walkthrough and record the actual results before full operational use.
