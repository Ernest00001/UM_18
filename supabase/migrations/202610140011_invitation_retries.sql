begin;
create table public.invitation_operations(id uuid primary key default gen_random_uuid(),actor_id uuid not null references public.executive_accounts,idempotency_key uuid not null,request_hash text not null,state text not null default 'pending' check(state in ('pending','completed')),auth_user_id uuid references auth.users,lease_id uuid not null,lease_until timestamptz not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(actor_id,idempotency_key));
alter table public.invitation_operations enable row level security;
revoke all on public.invitation_operations from anon,authenticated;
create policy invitation_operation_read on public.invitation_operations for select to authenticated using(public.has_permission('accounts.write'));
grant select on public.invitation_operations to authenticated;
create function public.begin_invitation(p_key uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.invitation_operations;lease uuid=gen_random_uuid();hash text=md5(p_payload::text);begin perform public.require_permission('accounts.write');if p_key is null or octet_length(p_payload::text)>24000 then raise exception 'Invalid invitation';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));select * into op from public.invitation_operations where actor_id=auth.uid() and idempotency_key=p_key for update;
 if found then if op.request_hash<>hash then raise exception 'Invitation retry changed';end if;if op.state='completed' then return jsonb_build_object('completed',true,'user_id',op.auth_user_id);end if;if op.lease_until>now() then raise exception 'Invitation is still being processed';end if;
 if op.auth_user_id is null then raise exception 'Invitation delivery is uncertain. Review the Auth identity before retrying.';end if;
 update public.invitation_operations set lease_id=lease,lease_until=now()+interval '2 minutes',updated_at=now() where id=op.id returning * into op;
 else insert into public.invitation_operations(actor_id,idempotency_key,request_hash,lease_id,lease_until) values(auth.uid(),p_key,hash,lease,now()+interval '2 minutes') returning * into op;end if;
 return jsonb_build_object('id',op.id,'lease_id',op.lease_id,'user_id',op.auth_user_id,'completed',false);
end;$$;
create function public.mark_invitation_identity(p_id uuid,p_lease uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$begin perform public.require_permission('accounts.write');update public.invitation_operations set auth_user_id=p_user,updated_at=now() where id=p_id and actor_id=auth.uid() and lease_id=p_lease and state='pending' and auth_user_id is null;if not found then raise exception 'Invitation identity could not be recorded';end if;end;$$;
create function public.provision_invitation(p_op uuid,p_lease uuid,p_actor uuid,p_id uuid,p_name text,p_email text,p_roles jsonb,p_permissions jsonb,p_expires timestamptz,p_member uuid,p_reason text,p_denied jsonb,p_schedule jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.invitation_operations;result jsonb;begin
 if auth.role()<>'service_role' or not public.has_permission_for(p_actor,'accounts.write') then raise exception 'Provisioning denied' using errcode='42501';end if;
 select * into op from public.invitation_operations where id=p_op and lease_id=p_lease and actor_id=p_actor and auth_user_id=p_id for update;if not found then raise exception 'Invitation operation does not match';end if;
 if op.state='completed' then return jsonb_build_object('id',op.auth_user_id);end if;
 result=public.provision_invited_account_v2(p_actor,p_id,p_name,p_email,p_roles,p_permissions,p_expires,p_member,p_reason,p_denied,p_schedule);
 update public.invitation_operations set state='completed',updated_at=now() where id=op.id;return result;
end;$$;
create function public.bootstrap_status() returns boolean language plpgsql stable security definer set search_path='' as $$begin if auth.role()<>'service_role' then raise exception 'Server only' using errcode='42501';end if;return exists(select 1 from public.role_assignments where role_code='owner' and revoked_at is null);end;$$;
revoke execute on function public.begin_invitation(uuid,jsonb),public.mark_invitation_identity(uuid,uuid,uuid),public.provision_invitation(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text,jsonb,jsonb),public.bootstrap_status() from public,anon,authenticated;
grant execute on function public.begin_invitation(uuid,jsonb),public.mark_invitation_identity(uuid,uuid,uuid) to authenticated;
grant execute on function public.provision_invitation(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text,jsonb,jsonb),public.bootstrap_status() to service_role;
commit;
