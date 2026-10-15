# Unmatched 18 — UM18 alumni system

A vanilla HTML/CSS/JavaScript association application for Set 2018. Maroon and white, “semper ultra”, no invented school, bank details, official logo, or production statistics. Members submit details without an account; individual executives administer records through Supabase Auth and database-enforced permissions.

The homepage’s **Join UM18** button opens a four-phase form inside the right-hand hero panel. The open form grows with the page for natural scrolling, including when optional sections expand. Optional phases can be skipped. Back, inline validation, editable review, submission retries, and confirmation retain the entered values in memory. Public navigation links to association content; executives use the separate `/admin/` pages.

The current stage is **public website deployed; executive setup pending**. On 14 October 2026, the Supabase plugin applied all eighteen prepared migrations and one financial-history permission correction to project `hpbzhaleqphfucnautpl`. Migration history matches the repository. The public website is deployed at https://theunmatched.vercel.app and the first President administrator is created; MFA, invitation/email configuration and live workflow acceptance remain pending. No executive invitation has been sent. See [SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) for live checks and remaining setup.

On 15 October, the twentieth migration and the audit repairs completed: recoverable authenticator setup, saved event counts, complete shared-expense pagination, missing foreign-key indexes, production Auth URL and invitation-only account creation. See [AUDIT_REPAIRS.md](docs/AUDIT_REPAIRS.md).

Every executive's Overview includes shared accountability: published office reports/minutes/decisions, net confirmed receipts and safely summarised expenses with separate approval states. Individual workspaces retain their editing permissions. Monthly dues have a January–December schedule, selected-member coverage and advance-payment entry. Both public and executive pages begin with a maroon loading screen, a white 18 and circular indicator, visible for at least two seconds and with a retry if loading stalls.

Public and executive layouts adapt to phones, tablets and desktop screens. Executive navigation becomes a drawer, record lists retain sorting on mobile, and longer dialogs keep their actions visible while the content scrolls. Fields use readable text and larger touch targets on smaller screens. See `docs/RESPONSIVE_REVIEW.md` for the changes and browser checks.

## Run locally

Use Node **24.x** and the dependency lockfile. The local interface preview needs no Supabase credentials:

```bash
npm ci
npm run build:preview
npm run preview
```

Open `http://127.0.0.1:3180` for the public pages and `http://127.0.0.1:3180/admin/overview/` for the executive screens. The preview starts with no sample member, collection, payment or event records and uses a generic **Workspace preview** identity. Changes and uploaded files are held temporarily in the local server's memory: they survive page reloads while that server runs and clear when it restarts. Use only nonpersonal test input. The separate output is `.local/ui-preview`; this preview does not connect to Supabase, send invitations or publish a site.

The default `npm run build` still produces production assets in `dist`, excluding review/preview services and fixture records. Production configuration failure blocks operations. After interface review, use the Supabase/Vercel setup in `docs/DEPLOYMENT.md`; local backend development then uses an ignored `.env` and `node --env-file=.env scripts/dev.mjs` at port 3000.

## Project map

| Path | Purpose |
|---|---|
| `public/` | Public/executive shells, shared CSS, native JS modules |
| `public/assets/js/registration.js` | Embedded four-phase member submission |
| `public/assets/js/modules/` | Authentication, membership, finance, collections, events/welfare, reports, settings/accounts |
| `production-service.js`, `preview-service.js` | Persistent Supabase adapter / localhost interface-preview adapter |
| `executive-offices.js` | The eleven association offices, shared office workspaces, display labels and suggested access responsibilities |
| `domain.js`, `ledger.js`, `report-data.js` | Validation, exact kobo arithmetic, allocation movements, canonical reports |
| `ui.js`, `remote-table.js`, `documents.js` | Reusable forms/dialogs, paged searches, scoped file workspaces |
| `responsive.js`, `public/assets/css/responsive.css` | Executive drawer/focused-field behavior and shared device layouts |
| `import-model.js`, `pdf-export.js` | Reviewed migration previews and measured, branded PDF reports |
| `api/`, `server/` | Vercel handlers, verified-token checks, abuse controls, file validation |
| `supabase/migrations/` | Nineteen ordered migrations installed in the association project, including executive offices, event media, invitations and financial history access |
| `fixtures/`, `tests/` | Empty preview state, isolated test fixtures and executable PostgreSQL/domain/DOM/build verification |
| `scripts/`, `docs/` | Builds, local server, owner bootstrap, backup/restore and operating guides |
| `dist/` | Generated static output; server handlers stay outside it |
| `.local/ui-preview/` | Separate generated localhost preview; never used as the Vercel production output |

No UI framework is used. Exact pinned dependencies are Supabase JS 2.117.3, pdf-lib 1.17.1, fontkit 1.1.1, sharp 0.35.5; development tools are esbuild 0.25.10, PGlite 0.3.14 and linkedom 0.18.13. Supabase is bundled as ESM. PDF code and licensed local font assets load on export; sharp decodes server-side raster uploads. Font sources/licenses live in `public/assets/fonts/`. The lockfile pins transitive dependencies.

The executive offices are President, Vice President, Secretary, Assistant Secretary, Treasurer, Assistant Treasurer, PRO, Financial Secretary, Assistant Financial Secretary, Community / Event Manager, and Auditor General. Office titles identify association responsibilities; they are stored separately from access roles and do not grant authority by themselves. Account administrators can apply an office's suggested access, review it, and save roles, grants, denials and effective dates. The first approved President account is explicitly bootstrapped as system administrator. Later office selections do not assign owner access automatically. Member-request review requires both a President or Vice President office and current review permission; secretaries maintain approved member records.

Overview groups the President/Vice President, Secretary/Assistant Secretary, Treasurer/Assistant Treasurer, and Financial Secretary/Assistant Financial Secretary into shared office workspaces. The PRO, Community / Event Manager and Auditor General also receive their own office workspace cards. The officeholder and assistant work with the same association records through their permitted pages; they keep individual accounts, MFA and an action history identifying who made each change. Office cards identify active colleagues and provide links filtered by the signed-in executive's permissions. An assistant's grants, denials and expiry remain independent of the officeholder's.

An account administrator can open an active, unarchived member profile and choose **Invite to executive workspace**. This prepares the member's name, email and alumni link in Executive accounts; the administrator chooses the approved offices and access. In configured production, Supabase sends an individual executive invitation. After accepting it, the executive sets a password, enrolls an authenticator and enters the office workspace permitted by their account. The local preview prepares screens only and sends no email. Alumni registration alone does not create a login or executive access.

Event announcements and the gallery use deliberate public event fields and validated posters/photos. Upcoming public events appear on the homepage; closing an event moves its approved public material to the gallery. Attendance, private notes and association documents stay within their existing permission scopes. Event images use a separate private `event-media` bucket with controlled temporary access.

## Verification

```bash
npm run check
npm test
npm run build
```

Tests cover permission denial, registration retries and scrolling, IDs, obligations, allocations, refunds/replacements, expired sessions, welfare handover, document scoping, imports, report search/export scope, executive offices, shared officeholder/assistant workspaces, event publication/media, eligible executive invitations, empty preview behavior and production isolation. PostgreSQL checks use an embedded database with fixture Auth/Storage schemas; they do not apply scripts to a live Supabase project. DOM and viewport-geometry checks exercise controls but do not prove actual device keyboards or assistive-technology behavior. See `docs/VERIFICATION.md` for executed evidence and remaining checks.

The latest local run on 15 October 2026 passed all 328 tests and checked 51 JavaScript modules. Eight registration checks cover production submission without CAPTCHA, pending status, approval, safe retries, validation, spam-trap behavior, database rate limiting and direct UI submission. Five hosted-grant checks reproduce Supabase's hosted table grants, verify the financial-history correction, retain audited writes and scoped reads, and prevent automatic browser grants on future application tables. Production and interface-preview builds succeeded in the build tests. Browser walkthroughs verified registration scrolling, event poster/gallery publication, shared report publication, the monthly schedule and the maroon 18 loader, then cleared temporary records. The later control audit checked all 16 executive navigation pages and 494 rendered links, improved year/search feedback, corrected control wiring and recoverable errors, and confirmed the latest registration and Overview wording. The responsive review completed 144 browser page checks across five screen sizes, including populated records on an isolated test server. See `docs/UI_AUDIT.md`, `docs/PRODUCTION_AUDIT_FIXES.md` and `docs/RESPONSIVE_REVIEW.md` for the executed evidence and limitations.

## Production and handover

Continue with `docs/DEPLOYMENT.md`: database setup is recorded in `docs/SUPABASE_SETUP.md`; configure Auth signup restrictions, invitation/recovery delivery, TOTP and the approved site origin, securely configure Vercel, bootstrap the approved individual President, then deploy with Vercel’s **Other** preset, **npm run build**, and **dist** output. `/api/config` delivers only browser-safe values at request time; server secrets never enter static JavaScript. Deploy the whole project so its API handlers accompany the static frontend. Complete live invitation, MFA, submission, accounting and backup/restore acceptance before operational use.

Read `docs/SCHEMA_AND_FINANCE.md` before changing accounting or permissions. `docs/EXECUTIVE_GUIDE.md` describes everyday operations. `docs/BACKUP_RESTORE_HANDOVER.md` covers paired database/file backups, restore, pilot acceptance and ownership transfer. Real project credentials, official logo, approved contacts, collection rules, and an adopted retention/privacy policy remain association setup items. No live backend or restore is claimed.
