# Responsive interface review — 14 October 2026

The public site and all sixteen executive areas now use a shared responsive stylesheet. This pass changes interface layout and controls; no live migration, invitation, deployment or GitHub commit was performed.

## Interface changes

- Executive navigation uses a phone/tablet drawer with an explicit close button, focus handling, Escape support and background scroll locking. Closed mobile navigation is removed from keyboard access. Resizing, changing pages and returning to sign-in release the drawer state.
- The phone header has a separate full-width search row. Cards, headings, actions, filters, reports, document rows and detail layouts wrap or stack as space becomes limited. Longer names and values wrap without stretching the page.
- Inputs use 16px text and primary controls have at least 44px touch height on phone/tablet layouts. Public navigation and registration progress controls also retain usable touch targets.
- Mobile record cards have explicit sorting and direction controls. They update the same local or paged data used by existing searches and exports. Wider tables, tabs and charts scroll within their own region.
- Dialog headings and action buttons stay outside the scrolling content area. Dialog height follows the available viewport. Focused executive fields scroll into view only when obscured, preserving their value and respecting user zoom. Allocation selectors occupy a full row above the amount and remove button on phones.
- The public four-step registration form retains normal page scrolling; fields stack on narrow phones. Event announcements and separate poster/photo gallery sections fit the available screen width.

The relevant source files are `public/assets/css/responsive.css`, `public/assets/js/responsive.js`, `admin.js`, `ui.js` and `remote-table.js`. Both public and executive shells load the shared stylesheet last. Permission checks and production finance/report services retain their existing contracts.

## Executed verification

| Check | Result |
|---|---|
| Automated suites | 287 passed; zero failed or skipped |
| JavaScript syntax | 51 modules verified |
| Production and interface-preview builds | Both succeeded |
| Initial executive browser matrix | 16 areas × four sizes = 64 checks |
| Public and sign-in browser matrix | Seven public pages plus sign-in × four sizes = 32 checks |
| Tablet and landscape follow-up | All 24 page families × two sizes = 48 checks |
| Combined page checks | 144 checks; 120 distinct page/size combinations; no page-level horizontal overflow or page error panels observed |

The screen sizes were 320×568, 390×844, 768×1024, 1440×900 and 740×360. Tablet checks were repeated after increasing field and touch sizes. All page checks used the browser's actual reported viewport width. The user's empty operational preview was also inspected at 360×740.

The sixteen executive areas were Overview, Office reports, Registrations, Members, Monthly collections, Special collections, Payments, Expenses, Events, Welfare, Contact history, Documents, Reports, Branding, Executive accounts and Audit history. Public coverage included the homepage, registration, confirmation, privacy, help, events, gallery and executive sign-in.

An isolated server on port 3181 supplied fictional populated records, long member/collection/report text, and temporary event images. Gallery checks confirmed separate Posters and Photos headings and loaded images. Mobile payment sorting changed the visible record order. Additional browser checks covered all four registration steps and expanded optional sections, member creation, payment entry/detail/allocation, office report drafts and executive invitations. At 320×400 the long invitation dialog scrolled its body while its action buttons remained inside the viewport. No forms were submitted during these additional layout checks.

Five added automated tests exercise drawer focus/resize/cleanup, focused-field geometry, keyboard viewport updates with preserved text/focus, local mobile sorting and paged sorting/export scope. The existing navigation, permission, production-isolation and accounting suites also passed.

## Local evidence and handover

- `.local/responsive-checks.json`: browser page/viewport inventory.
- `.local/responsive-monthly-mobile.png`: actual running preview at 360×740, with mobile header, readable fields and stacked search controls.
- `.local/responsive-navigation-mobile.png`: the same preview with its executive drawer open.

These evidence files and the temporary populated server are local-only and excluded from deployment. The isolated server is stopped after verification. The user's server on port 3180 and saved changes remain intact; its frontend assets are rebuilt.

Browser viewport checks and geometry tests do not establish actual iOS/Android keyboard behavior, Safari rendering, screen-reader announcements or real device acceptance. Those checks remain part of UI/UX acceptance before live backend setup. No live Supabase or Vercel result is claimed.
