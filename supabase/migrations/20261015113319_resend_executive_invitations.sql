begin;
alter table public.executive_accounts add column invitation_last_resent_at timestamptz;
create table um18_internal.invitation_resends (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references public.executive_accounts,
 target_id uuid not null references public.executive_accounts, idempotency_key uuid not null,
 request_hash text not null, reason text not null, lease_id uuid not null default gen_random_uuid(),
 state text not null default 'sending' check(state in ('sending','sent','failed','uncertain')),
 kind text check(kind in ('invite','recovery')), created_at timestamptz not null default now(), finished_at timestamptz,
 unique(actor_id,idempotency_key)
);
create index invitation_resends_target_created on um18_internal.invitation_resends(target_id,created_at desc);
alter table um18_internal.invitation_resends enable row level security;
revoke all on um18_internal.invitation_resends from public,anon,authenticated,service_role;

create function um18_internal.pending_invitation(p_target uuid) returns public.executive_accounts language plpgsql stable set search_path='' as $$
declare a public.executive_accounts;op public.invitation_operations;old public.executive_accounts;
begin
 select * into a from public.executive_accounts where id=p_target;
 if not found or not a.active or not a.access_pending or a.mfa_recovery_pending then raise exception 'Only active pending invitations can be resent';end if;
 select * into op from public.invitation_operations where id=a.invitation_operation_id and state='completed' and auth_user_id=a.id and include_membership;
 if not found or not public.has_permission_for(op.actor_id,'accounts.write') then raise exception 'The original invitation approval needs review before resending';end if;
 if not public.has_permission_for_pre_membership(a.id,'directory.read') then raise exception 'Review the assigned access and effective dates before resending';end if;
 perform public.require_active_invitation_member(a.member_id);
 if not exists(select 1 from public.members m join auth.users u on u.id=a.id where m.id=a.member_id and lower(trim(m.email))=lower(trim(a.email)) and lower(trim(u.email))=lower(trim(a.email))) then raise exception 'Review the member and invited email before resending';end if;
 if op.replacement_executive_id is not null then
  select * into old from public.executive_accounts where id=op.replacement_executive_id;
  if not found or not old.active or old.access_pending or old.office_codes is distinct from op.replacement_offices
   or not(a.office_codes @> op.replacement_offices and a.office_codes <@ op.replacement_offices)
   or 'president'=any(old.office_codes)
   or not exists(select 1 from public.executive_accounts where id=op.actor_id and 'president'=any(office_codes))
   or exists(select 1 from public.role_assignments where executive_id in (a.id,old.id) and role_code='owner' and revoked_at is null) then raise exception 'The replacement appointment changed; review it before resending';end if;
 end if;
 if exists(select 1 from public.executive_accounts where active and not access_pending and id<>a.id and id is distinct from op.replacement_executive_id and office_codes && a.office_codes) then raise exception 'An assigned office is occupied; review the pending appointment';end if;
 return a;
end;$$;
revoke execute on function um18_internal.pending_invitation(uuid) from public,anon,authenticated,service_role;

create function public.begin_invitation_resend(p_target uuid,p_key uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.executive_accounts;r um18_internal.invitation_resends;hash text;last_attempt timestamptz;
begin
 perform public.require_permission('accounts.write');
 if p_target is null or p_key is null or p_reason is null or length(trim(p_reason)) not between 2 and 1500 then raise exception 'Choose a pending executive and provide a resend reason';end if;
 perform pg_advisory_xact_lock(18018);hash=md5(p_target::text||':'||trim(p_reason));
 select * into r from um18_internal.invitation_resends where actor_id=auth.uid() and idempotency_key=p_key;
 if found then
  if r.request_hash<>hash then raise exception 'Retry key reused with different contents';end if;
  return jsonb_build_object('id',r.id,'state',r.state,'kind',r.kind,'replayed',true);
 end if;
 a=um18_internal.pending_invitation(p_target);
 if exists(select 1 from um18_internal.invitation_resends where target_id=p_target and state='sending' and created_at>now()-interval '2 minutes') then raise exception 'An invitation email is already being processed; wait before trying again' using errcode='PT429';end if;
 select greatest((select updated_at from public.invitation_operations where id=a.invitation_operation_id),(select max(created_at) from um18_internal.invitation_resends where target_id=p_target)) into last_attempt;
 if last_attempt>now()-interval '60 seconds' then raise exception 'Wait at least 60 seconds before resending this invitation' using errcode='PT429';end if;
 if (select count(*) from um18_internal.invitation_resends where target_id=p_target and created_at>now()-interval '1 hour')>=5 then raise exception 'Five resend attempts were made in the last hour; try again later' using errcode='PT429';end if;
 insert into um18_internal.invitation_resends(actor_id,target_id,idempotency_key,request_hash,reason) values(auth.uid(),p_target,p_key,hash,trim(p_reason)) returning * into r;
 perform public.log_action('executive.invitation_resend_requested','account',p_target,jsonb_build_object('reason',trim(p_reason),'resend_id',r.id));
 return jsonb_build_object('id',r.id,'lease_id',r.lease_id,'state',r.state,'replayed',false);
end;$$;
revoke execute on function public.begin_invitation_resend(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.begin_invitation_resend(uuid,uuid,text) to authenticated;

create function public.prepare_invitation_resend(p_actor uuid,p_id uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r um18_internal.invitation_resends;a public.executive_accounts;mode text;
begin
 if auth.role()<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 if not public.has_permission_for(p_actor,'accounts.write') then raise exception 'Resend authority was revoked' using errcode='42501';end if;
 perform pg_advisory_xact_lock(18018);
 select * into r from um18_internal.invitation_resends where id=p_id and actor_id=p_actor and lease_id=p_lease and state='sending' and created_at>now()-interval '2 minutes' for update;
 if not found then raise exception 'This resend attempt is unavailable';end if;
 a=um18_internal.pending_invitation(r.target_id);
 select case when email_confirmed_at is null then 'invite' else 'recovery' end into mode from auth.users where id=a.id;
 update um18_internal.invitation_resends set kind=mode where id=r.id;
 return jsonb_build_object('target_id',a.id,'email',a.email,'kind',mode);
end;$$;
revoke execute on function public.prepare_invitation_resend(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_invitation_resend(uuid,uuid,uuid) to service_role;

create function public.finish_invitation_resend(p_actor uuid,p_id uuid,p_lease uuid,p_state text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r um18_internal.invitation_resends;
begin
 if auth.role()<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 if p_state is null or p_state not in ('sent','failed','uncertain') then raise exception 'Invalid delivery outcome';end if;
 perform pg_advisory_xact_lock(18018);
 select * into r from um18_internal.invitation_resends where id=p_id and actor_id=p_actor and lease_id=p_lease for update;
 if not found then raise exception 'Resend attempt does not match';end if;
 if r.state<>'sending' then return jsonb_build_object('state',r.state,'kind',r.kind);end if;
 update um18_internal.invitation_resends set state=p_state,finished_at=now() where id=r.id;
 if p_state='sent' then update public.executive_accounts set invitation_last_resent_at=now() where id=r.target_id;end if;
 insert into public.audit_events(actor_id,action,target_type,target_id,changes) values(p_actor,'executive.invitation_resend_'||p_state,'account',r.target_id,jsonb_build_object('reason',r.reason,'resend_id',r.id,'kind',r.kind));
 return jsonb_build_object('state',p_state,'kind',r.kind);
end;$$;
revoke execute on function public.finish_invitation_resend(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_invitation_resend(uuid,uuid,uuid,text) to service_role;

-- A second new invitation must not bypass the resend limits or replace the
-- pending executive's approved settings. Existing operation retries still work.
alter function public.begin_invitation(uuid,jsonb) rename to begin_invitation_pre_resend;
revoke execute on function public.begin_invitation_pre_resend(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.begin_invitation(p_key uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.require_permission('accounts.write');perform pg_advisory_xact_lock(18018);
 if not exists(select 1 from public.invitation_operations where actor_id=auth.uid() and idempotency_key=p_key)
  and exists(select 1 from public.executive_accounts where active and access_pending and
   (lower(trim(email))=lower(trim(p_payload->>'email')) or member_id=nullif(p_payload->>'member_id','')::uuid)) then
  raise exception 'This executive already has a pending invitation. Use Resend invitation to send another email';end if;
 return public.begin_invitation_pre_resend(p_key,p_payload);
end;$$;
revoke execute on function public.begin_invitation(uuid,jsonb) from public,anon,service_role;
grant execute on function public.begin_invitation(uuid,jsonb) to authenticated;
commit;
