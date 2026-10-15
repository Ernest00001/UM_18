# Personal profiles and presidential handover

Implemented 15 October 2026. Sign-in remains email and password only. This update adds no mandatory authenticator or email-code login step.

## Personal membership and office access

Each executive uses **My profile** to maintain their own name, personal email, phone, WhatsApp and location. The permanent membership record is independent of office assignments. Personal updates preserve the Member ID, skills, private details, receipts and other recorded history. They never grant permissions or change sign-in credentials automatically.

The association mailbox is `unmatched018@gmail.com`. It belongs to the organisation. The temporary President member entry can be resolved by the signed-in President explicitly selecting and confirming their real, approved membership. The selected Member ID survives; existing merge safeguards transfer linked history and exclude the archived duplicate from the full register. No person's identity is inferred from a name or registration. Alternatively the President can complete the current entry as their own record.

After saving a personal email, **Use my saved personal email to sign in** requests a Supabase email change. Supabase confirmation is required. After confirmation and a matching signed Auth email claim, the executive account synchronises to that personal email. A profile contact edit alone never changes login access. Working email delivery is required for confirmations, invitations and recovery; password login does not require an email each time.

## Executive management and handover

New invitations select an approved active member and use that member's personal email. Inviting an executive does not create a duplicate membership entry. Replacement retains the previous executive's access until the successor accepts and sets a password. Remove/restore preserve membership and recorded work, retain audit reasons and invalidate stale access. A former President whose roles were retired needs a new appointment through **Manage permissions** before restoration.

The President title cannot be added/removed through ordinary invitations or the office editor. **Presidential handover** is a separate protected workflow:

1. The outgoing President completes their personal member details.
2. Select another approved member. Invite them with basic workspace access if they have no executive account.
3. The successor accepts, sets a password and signs in with their confirmed personal email. Their member contact details must be complete.
4. The President reviews readiness, confirms the successor and acknowledges separate organisation Gmail handover, with an election/approval reason.
5. A single database transaction installs the incoming permanent system administrator, assigns the President office, retires the outgoing executive's roles, invalidates their access and records the transfer. Both personal memberships and their histories remain.

Google mailbox passwords and recovery details must be transferred through Google separately. This website does not transfer Google account credentials. The live President placeholder is left untouched until the President confirms their own membership in My profile.

## Registration and contributions

Public applications now require personal email and WhatsApp in **Your essentials**. The phone-as-WhatsApp checkbox remains. Optional journey/private information can still be skipped without skipping required contacts. Client, API and the service-only submission RPC enforce the requirement. Existing legacy memberships are retained and flagged for missing contacts; bulk historical imports are not retroactively rejected.

The finance navigation now says **Contribution** and **Special contribution**, retaining existing URLs, records and monthly schedules. Overview explanatory copy is shortened.

Mobile member cards contain identity, office/status indicators and View profile. Full details remain in the profile. Every directory-authorised executive can view the member's confirmed net contribution total, monthly and special allocation coverage, available credit, outstanding approved assessments and safe payment history. Future approved months are included. Pending/reversed receipts are excluded; documented adjustments reduce net receipts. Each receipt is counted once. The summary excludes bank references, notes, documents and payee details. Financial editing, statement exports and detailed receipt links retain existing finance permissions.

## Verification boundaries

Regression tests exercise PostgreSQL permissions, personal-only updates, explicit placeholder resolution and ledger preservation, signed email confirmation checks, safe contribution totals, protected handover, former access revocation, mobile card contents, profile controls and public required-contact submission. Browser checks use an isolated local preview with fictional data and no production submissions or emails. A real incoming executive invitation and email confirmation remain human acceptance checks after email delivery is configured.
