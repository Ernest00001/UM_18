# UI interaction and navigation audit

Audit date: 14 October 2026, Africa/Lagos. This audit addresses the reported monthly **View year** and search controls, then checks the public website and executive workspace for broken navigation and disconnected actions.

## Result

The issues found in the exercised flows have been corrected and regression coverage added. The final complete application suite passed **267 tests, with no failures or skipped tests**. Syntax checks passed for **50 JavaScript modules**. The final overview-title change also passed 94 existing UI, navigation, office and accountability checks without further source changes.

The route inventory checked **494 rendered anchors and 56 distinct targets**. No unresolved internal route, missing static asset/fragment, empty `href`, dead `#` anchor, or unknown linked record remained in that inventory. Those counts include repeated desktop/mobile links and links rendered after changing profile and collection tabs; they are not counts of unique pages or every possible data state.

## Coverage

| Area | Exercised scope |
|---|---|
| Executive routes | All 16 areas in empty and populated states: Overview, office reports, registrations, members, monthly dues, special collections, payments, expenses, events, welfare, contacts, documents, reports, branding, accounts and audit |
| Public routes | Home, registration, confirmation, privacy, help, events and gallery, plus executive sign-in; public navigation, actual homepage fragments and initial HTML assets |
| Detail navigation | Member, monthly/special collection, payment, expense, event, welfare, document, registration, account and office-report references; all member/profile and collection tabs |
| Office permissions | All 11 requested offices: reachable overview shortcuts, paired office/assistant workspaces, permitted report drafts and public/internal separation |
| Monthly dues | Changing year, loading/completion/error feedback, retry, member search, empty-list explanation and member-specific coverage selection |
| Tables and exports | Search, filters, sorting, paging, empty states, interrupted requests, stale responses, export filter/sort snapshots, permission checks and explicit native form button types |
| Finance | Multiple advance allocations, receipt/evidence retry, confirm/reject/reverse, allocation removal and validation, refunds, receipt correction, expenses, read-only links and report filters/print/export controls |
| Membership and operations | Registration linking, member edit restrictions/profile tabs, CSV mapping/revalidation/create/link/correction, contact follow-ups, attendance, welfare handover, documents and event media loading |
| Accounts and settings | Invitation context and deliberate access suggestions, account editing, reviewed MFA reset/self-reset restriction, public identity, restricted settings and logo selection/save/fallback |
| Office reports and overview | Create/read/revise/publish/withdraw controls, all report filters, date application, shared expense summaries, retry and unavailable record states |

## Corrections made

- **Monthly controls:** View year now visibly names the loaded year and reports loading/completion. Searches show progress, match counts or a clear empty-member-list explanation. Failed requests restore the action button for retry.
- **Workspace search and routing:** Search has a visible submit button. Command-result buttons explicitly avoid submitting the surrounding dialog form, preventing unintended full-page navigation. Interrupted sidebar requests show a working Retry page action; preview-entry failures retain a usable retry button. Unknown local routes return HTTP 404 rather than a misleading successful response.
- **Remote tables:** Early/repeated paging is blocked while loading; page bounds are checked, disappearing final pages return to page one, and stale failures cannot replace newer results. Multi-page exports preserve the search/filter/sort scope selected when export begins.
- **Finance:** Record payment stays usable while its list search loads. Missing replacement references cannot create unrelated receipts. Rapid member changes cannot restore another member's obligations; failed obligation requests show feedback and block verified allocation submission. Reports recheck export permission and explain unavailable report categories.
- **Membership and operations:** Event detail navigation runs once. Direct member create/edit links respect editing permissions. Replaceable table holders keep registration/contact/document row actions working after redraws. Event editing and attendance bind before slow media requests; private document failures keep the event page usable with Retry.
- **Documents:** Permitted direct references open their records; unavailable references offer a return path. Scope/search races cannot restore stale upload targets. Target failures clear stale selection, block upload and offer Retry. Downloads reserve a tab during the click, close it on denied access and provide an explicit fallback link when a popup is blocked.
- **Settings and audit:** Invalid or cleared logo selection disables Save and restores the current mark. The local preview's text fallback clears its actual logo. Audit shortcuts target office reports, the correct monthly/special fund, assessment parent and welfare case. Missing account/report references explain their unavailable state.
- **Native form behavior:** Non-save actions use explicit `type="button"`, including allocation/document/CSV/dialog/table controls. Enter in a table search does not accidentally submit its enclosing form.

## Latest presentation changes

The duplicate top **Overview** heading has been removed. The shared summary is now the page's sole **Overview** heading, including its error/retry state. The date range, permission-controlled personal actions and shared expense/report information remain connected.

Public registration no longer displays **UI preview · no live submissions**. Its form footer reads **Private details · reviewed by executives**. The phone placeholder reads **Your phone number**, with the requested country-code wording removed.

At the user's request, public registration confirmation uses **Submission received** and ordinary executive-review wording. Its displayed submission reference remains available for follow-up. The local UI preview still stores changes only in server memory; this copy change does not establish a live database connection or send a real registration.

## Evidence and limitations

The new audit suites are `navigation-audit.test.mjs`, `settings-controls-audit.test.mjs`, `monthly-controls-audit.test.mjs`, `navigation-errors-audit.test.mjs`, `finance-report-audit.test.mjs`, `membership-operations-audit.test.mjs` and `table-form-audit.test.mjs`. They supplement the existing application, API, build and embedded-database checks.

DOM tests use Linkedom and test-only fixtures or mocked service responses. They check rendered links, control wiring, selected payloads, error recovery and form semantics structurally. They do not establish actual keyboard focus, native popup policy, downloaded file contents, responsive browser layout or assistive-technology behavior. External association/contact destinations are checked syntactically, not contacted to establish their availability.

The final native browser pass used the isolated, latest localhost preview on port 3181. All 16 sidebar destinations were clicked and displayed the expected path and main heading without an error/retry panel. Global Search returned the Reports command, and clicking it opened `/admin/reports/` without unintended form navigation. Local HTTP checks returned **200 for 24 page routes and 11 assets**, and **404 for three missing paths**. The main preview on port 3180 displayed the updated single Overview title; the registration form's phone placeholder and privacy wording were also checked in the native browser.

Screenshots from those checks are saved at `.local/registration-copy-audit.jpg`, `.local/ui-audit-year-search.jpg` and `.local/overview-title-audit.jpg`. The main port 3180 process retains one previously saved review change and was preserved instead of restarted. Its loaded server code will adopt the corrected missing-route HTTP status on its next restart; the current source and isolated latest process already passed that check.

Live Supabase Auth, invitation/recovery emails, deployed RLS/storage, Vercel routing, physical mobile keyboards and a complete cross-browser/accessibility walkthrough remain staging/pilot checks. No live invitations, migrations or deployment were performed. Operational sample data belongs only to test fixtures; a fresh UI preview starts with empty operational records.
