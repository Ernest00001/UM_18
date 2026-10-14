-- The President is the first administrator. Member requests belong to elected leadership.
begin;

delete from public.role_permissions where role_code='secretary' and permission='registrations.review';

-- Keep live assignments, explicit grants, denials, expiry and recovery restrictions.
-- Neither an office title alone nor a grant to another office allows registration review.
create or replace function public.has_permission_for(p_actor uuid,p_permission text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.executive_accounts a where a.id=p_actor and a.active and not a.mfa_recovery_pending
 and (p_permission<>'registrations.review' or a.office_codes && array['president','vice_president']::text[])
 and exists(select 1 from public.role_assignments live where live.executive_id=a.id and live.revoked_at is null and live.starts_at<=now() and (live.expires_at is null or live.expires_at>now()))
 and not exists(select 1 from public.permission_denials d where d.executive_id=a.id and d.permission=p_permission and (d.expires_at is null or d.expires_at>now())) and (
 exists(select 1 from public.role_assignments r join public.role_permissions p on p.role_code=r.role_code where r.executive_id=a.id and p.permission=p_permission and r.revoked_at is null and r.starts_at<=now() and (r.expires_at is null or r.expires_at>now())) or
 exists(select 1 from public.explicit_permissions e where e.executive_id=a.id and e.permission=p_permission and (e.expires_at is null or e.expires_at>now()))));
$$;

create or replace function public.bootstrap_owner(p_id uuid,p_name text,p_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.executive_accounts;begin
 if auth.role()<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 perform pg_advisory_xact_lock(18018);
 if exists(select 1 from public.role_assignments where role_code='owner' and revoked_at is null) then raise exception 'Owner bootstrap is already complete';end if;
 insert into public.executive_accounts(id,display_name,email,office_codes) values(p_id,p_name,p_email,array['president']::text[]) returning * into a;
 insert into public.role_assignments(executive_id,role_code) values(a.id,'owner');
 insert into public.audit_events(actor_id,action,target_type,target_id,changes) values(a.id,'owner.bootstrap','account',a.id,jsonb_build_object('association_controlled',true,'office_codes',to_jsonb(a.office_codes)));
 return to_jsonb(a);
end;$$;
revoke execute on function public.bootstrap_owner(uuid,text,text) from public,anon,authenticated;
grant execute on function public.bootstrap_owner(uuid,text,text) to service_role;

-- Existing office assignments and explicit grants are preserved. Existing Presidents
-- and Vice Presidents need a deliberate current review grant; use suggested access.
commit;
