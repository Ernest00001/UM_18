-- Hosted Supabase grants every privilege on new public tables by default.
-- History stays read-only to approved executives and writable through audited RPCs.
begin;

revoke all on public.payment_metadata_history, public.payment_status_history from public, anon, authenticated;
grant select on public.payment_metadata_history, public.payment_status_history to authenticated;

-- Future application tables must deliberately opt in to browser access.
-- Existing grants and service_role access are preserved.
alter default privileges in schema public revoke all on tables from public, anon, authenticated;

-- Cache the session identity once per statement without changing assignment checks.
alter policy welfare_assigned_read on public.welfare_cases
 using(public.has_permission('welfare.read') and assigned_to=(select auth.uid()));
alter policy assigned_welfare_history on public.welfare_history
 using(public.has_permission('welfare.read') and exists(
  select 1 from public.welfare_cases c where c.id=case_id and c.assigned_to=(select auth.uid())
 ));

commit;
