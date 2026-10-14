-- Linking an executive invitation to a member requires current active eligibility.
begin;
create function public.require_active_invitation_member(p_member uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_member is null then return;end if;
 perform id from public.members where id=p_member and membership_status='active' and archived_at is null and merged_into_member_id is null for update;
 if not found then raise exception 'Choose an active, unarchived association member for this invitation' using errcode='23514';end if;
end;$$;
revoke execute on function public.require_active_invitation_member(uuid) from public,anon,authenticated,service_role;

create function public.executive_invitation_member(p_member uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d jsonb;begin
 perform public.require_permission('accounts.write');
 select jsonb_build_object('id',id,'full_name',full_name,'email',email,'membership_status',membership_status) into d from public.members where id=p_member and membership_status='active' and archived_at is null and merged_into_member_id is null;
 if not found then raise exception 'Choose an active, unarchived association member for this invitation' using errcode='23514';end if;return d;
end;$$;
revoke execute on function public.executive_invitation_member(uuid) from public,anon;
grant execute on function public.executive_invitation_member(uuid) to authenticated;

alter function public.begin_invitation(uuid,jsonb) rename to begin_invitation_v1;
revoke execute on function public.begin_invitation_v1(uuid,jsonb) from public,anon,authenticated;
create function public.begin_invitation(p_key uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.invitation_operations;begin
 perform public.require_permission('accounts.write');
 if p_key is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>24000 then raise exception 'Invalid invitation';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
 select * into op from public.invitation_operations where actor_id=auth.uid() and idempotency_key=p_key for update;
 -- The original function still checks the request hash before returning completion.
 if found and op.state='completed' then return public.begin_invitation_v1(p_key,p_payload);end if;
 perform public.require_active_invitation_member(nullif(p_payload->>'member_id','')::uuid);
 return public.begin_invitation_v1(p_key,p_payload);
end;$$;
revoke execute on function public.begin_invitation(uuid,jsonb) from public,anon;
grant execute on function public.begin_invitation(uuid,jsonb) to authenticated;

alter function public.provision_invitation_v2(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text,jsonb,jsonb,jsonb) rename to provision_invitation_v2_pre_active;
revoke execute on function public.provision_invitation_v2_pre_active(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.provision_invitation_v2(p_op uuid,p_lease uuid,p_actor uuid,p_id uuid,p_name text,p_email text,p_roles jsonb,p_permissions jsonb,p_expires timestamptz,p_member uuid,p_reason text,p_denied jsonb,p_schedule jsonb,p_offices jsonb default '[]') returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.invitation_operations;begin
 if auth.role()<>'service_role' or not public.has_permission_for(p_actor,'accounts.write') then raise exception 'Provisioning denied' using errcode='42501';end if;
 select * into op from public.invitation_operations where id=p_op and lease_id=p_lease and actor_id=p_actor and auth_user_id=p_id for update;
 if not found then raise exception 'Invitation operation does not match';end if;
 -- A completed operation must never change access or relink an executive on retry.
 if op.state<>'completed' then perform public.require_active_invitation_member(p_member);end if;
 return public.provision_invitation_v2_pre_active(p_op,p_lease,p_actor,p_id,p_name,p_email,p_roles,p_permissions,p_expires,p_member,p_reason,p_denied,p_schedule,p_offices);
end;$$;
revoke execute on function public.provision_invitation_v2(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.provision_invitation_v2(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text,jsonb,jsonb,jsonb) to service_role;
commit;
