begin;
create function public.provision_invited_account_v2(p_actor uuid,p_id uuid,p_name text,p_email text,p_roles jsonb,p_permissions jsonb,p_expires timestamptz,p_member uuid,p_reason text,p_denied jsonb,p_schedule jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;v jsonb;begin
 if auth.role()<>'service_role' or not public.has_permission_for(p_actor,'accounts.write') then raise exception 'Invitation provisioning denied' using errcode='42501';end if;
 if p_roles ? 'owner' and (p_denied ? 'accounts.write' or p_denied ? 'directory.read') then raise exception 'An owner must retain account administration and directory access';end if;
 result=public.provision_invited_account(p_actor,p_id,p_name,p_email,p_roles,p_permissions,p_expires,p_member,p_reason);
 for v in select value from jsonb_array_elements(coalesce(p_denied,'[]')) loop insert into public.permission_denials(executive_id,permission,expires_at) values(p_id,v#>>'{}',p_expires);end loop;
 for v in select value from jsonb_array_elements(coalesce(p_schedule,'[]')) loop update public.role_assignments set starts_at=coalesce(nullif(v->>'starts_at','')::timestamptz,starts_at),expires_at=nullif(v->>'expires_at','')::timestamptz where executive_id=p_id and role_code=v->>'role_code' and revoked_at is null;end loop;
 insert into public.audit_events(actor_id,action,target_type,target_id,changes) values(p_actor,'invitation.permissions','account',p_id,jsonb_build_object('reason',p_reason,'denied_permissions',p_denied,'role_schedule',p_schedule));return result;
end;$$;
revoke execute on function public.provision_invited_account_v2(uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.provision_invited_account_v2(uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text,jsonb,jsonb) to service_role;
commit;
