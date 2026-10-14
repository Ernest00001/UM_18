-- Elected offices describe executives; access still comes only from permissions.
begin;

create table public.executive_offices(code text primary key,label text not null);
insert into public.executive_offices(code,label) values
 ('president','President'),
 ('vice_president','Vice President'),
 ('secretary','Secretary'),
 ('assistant_secretary','Assistant Secretary'),
 ('treasurer','Treasurer'),
 ('assistant_treasurer','Assistant Treasurer'),
 ('pro','PRO'),
 ('financial_secretary','Financial Secretary'),
 ('assistant_financial_secretary','Assistant Financial Secretary'),
 ('community_event_manager','Community / Event Manager'),
 ('auditor_general','Auditor General');
alter table public.executive_offices enable row level security;
revoke all on public.executive_offices from anon,authenticated;
create policy executive_office_catalog_read on public.executive_offices for select to authenticated using(public.has_permission('directory.read'));
grant select on public.executive_offices to authenticated;

create function public.parse_office_codes(p_codes jsonb) returns text[] language plpgsql stable security definer set search_path='' as $$
declare codes text[];begin
 if jsonb_typeof(p_codes) is distinct from 'array' then raise exception 'Choose office titles from the executive office list';end if;
 if jsonb_array_length(p_codes)>11 or exists(select 1 from jsonb_array_elements(p_codes) x where jsonb_typeof(x) is distinct from 'string') then raise exception 'Invalid executive office list';end if;
 select coalesce(array_agg(value),'{}'::text[]) into codes from jsonb_array_elements_text(p_codes);
 if cardinality(codes)<>(select count(distinct x) from unnest(codes) x) or exists(select 1 from unnest(codes) x where not exists(select 1 from public.executive_offices o where o.code=x)) then raise exception 'Unknown or duplicate executive office';end if;
 return codes;
end;$$;
revoke execute on function public.parse_office_codes(jsonb) from public,anon,authenticated;

alter table public.executive_accounts add column office_codes text[] not null default '{}';
create function public.guard_executive_offices() returns trigger language plpgsql security definer set search_path='' as $$
begin perform public.parse_office_codes(to_jsonb(new.office_codes));return new;end;$$;
create trigger executive_offices_valid before insert or update of office_codes on public.executive_accounts for each row execute function public.guard_executive_offices();
revoke execute on function public.guard_executive_offices() from public,anon,authenticated;

insert into public.permissions(code) values('contacts.read') on conflict do nothing;
insert into public.role_permissions(role_code,permission) values('owner','contacts.read'),('secretary','contacts.read') on conflict do nothing;
alter policy contact_read on public.contact_history using(public.has_permission('contacts.read') or public.has_permission('contacts.write'));

-- Keep the existing command chain, permission checks and request receipts intact.
alter function public.execute_action(text,jsonb,uuid) rename to execute_action_v3;
revoke execute on function public.execute_action_v3(text,jsonb,uuid) from public,anon,authenticated;
create function public.execute_action(p_action text,p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid=auth.uid();pid uuid;codes text[];before_codes text[];receipt public.command_receipts;hash text;result jsonb;
begin
 if p_action<>'save_account' then return public.execute_action_v3(p_action,p_payload,p_key);end if;
 perform public.require_permission('accounts.write');
 if actor is null or p_key is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>65536 then raise exception 'Invalid authenticated operation' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_key::text,0));hash=md5(p_action||p_payload::text);
 select * into receipt from public.command_receipts where actor_id=actor and idempotency_key=p_key;
 if found then if receipt.request_hash<>hash then raise exception 'Retry key reused with different contents';end if;return receipt.result;end if;
 pid=nullif(p_payload->>'id','')::uuid;
 select office_codes into before_codes from public.executive_accounts where id=pid for update;
 if not found then raise exception 'Executive not found; invite first';end if;
 codes=case when p_payload ? 'office_codes' then public.parse_office_codes(p_payload->'office_codes') else before_codes end;
 result=public.execute_action_v3(p_action,p_payload,p_key);
 update public.executive_accounts set office_codes=codes where id=pid returning to_jsonb(executive_accounts) into result;
 if codes is distinct from before_codes then perform public.log_action('executive.offices_changed','account',pid,jsonb_build_object('reason',p_payload->>'reason','before',to_jsonb(before_codes),'after',to_jsonb(codes)));end if;
 update public.command_receipts set result=result where actor_id=actor and idempotency_key=p_key;
 return result;
end;$$;
revoke execute on function public.execute_action(text,jsonb,uuid) from public,anon;
grant execute on function public.execute_action(text,jsonb,uuid) to authenticated;

-- External Auth invitation delivery remains coordinated by the original operation.
create function public.provision_invitation_v2(p_op uuid,p_lease uuid,p_actor uuid,p_id uuid,p_name text,p_email text,p_roles jsonb,p_permissions jsonb,p_expires timestamptz,p_member uuid,p_reason text,p_denied jsonb,p_schedule jsonb,p_offices jsonb default '[]') returns jsonb language plpgsql security definer set search_path='' as $$
declare codes text[];op_state text;result jsonb;begin
 if auth.role()<>'service_role' or not public.has_permission_for(p_actor,'accounts.write') then raise exception 'Provisioning denied' using errcode='42501';end if;
 codes=public.parse_office_codes(p_offices);
 select state into op_state from public.invitation_operations where id=p_op and lease_id=p_lease and actor_id=p_actor and auth_user_id=p_id for update;
 if not found then raise exception 'Invitation operation does not match';end if;
 result=public.provision_invitation(p_op,p_lease,p_actor,p_id,p_name,p_email,p_roles,p_permissions,p_expires,p_member,p_reason,p_denied,p_schedule);
 if op_state='completed' then return result;end if;
 update public.executive_accounts set office_codes=codes where id=p_id returning to_jsonb(executive_accounts) into result;
 insert into public.audit_events(actor_id,action,target_type,target_id,changes) values(p_actor,'executive.offices_assigned','account',p_id,jsonb_build_object('reason',p_reason,'before','[]'::jsonb,'after',to_jsonb(codes)));
 return result;
end;$$;
revoke execute on function public.provision_invitation_v2(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.provision_invitation_v2(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text,jsonb,jsonb,jsonb) to service_role;

alter function public.current_context() rename to current_context_v2;
revoke execute on function public.current_context_v2() from public,anon,authenticated;
create function public.current_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d jsonb;begin d=public.current_context_v2();return d||jsonb_build_object('office_codes',(select to_jsonb(office_codes) from public.executive_accounts where id=auth.uid()));end;$$;
revoke execute on function public.current_context() from public,anon;
grant execute on function public.current_context() to authenticated;

alter function public.workspace_data(text,uuid) rename to workspace_data_v2;
revoke execute on function public.workspace_data_v2(text,uuid) from public,anon,authenticated;
create function public.workspace_data(p_area text,p_target uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d jsonb;begin
 d=public.workspace_data_v2(p_area,p_target);
 d=jsonb_set(d,'{contacts}',case when (public.has_permission('contacts.read') or public.has_permission('contacts.write')) and p_area in ('overview','contacts','members','reports') then (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.contact_history t where p_area<>'members' or member_id=p_target) else '[]'::jsonb end);
 d=jsonb_set(d,'{accounts}',(select coalesce(jsonb_agg(x||jsonb_build_object('office_codes',a.office_codes)),'[]') from jsonb_array_elements(d->'accounts') x join public.executive_accounts a on a.id=(x->>'id')::uuid));
 d=jsonb_set(d,'{officers}',(select coalesce(jsonb_agg(x||jsonb_build_object('office_codes',a.office_codes)),'[]') from jsonb_array_elements(d->'officers') x join public.executive_accounts a on a.id=(x->>'id')::uuid));
 return d;
end;$$;
revoke execute on function public.workspace_data(text,uuid) from public,anon;
grant execute on function public.workspace_data(text,uuid) to authenticated;

-- The compatibility snapshot must apply the same contact privacy rule.
alter function public.workspace_snapshot() rename to workspace_snapshot_v3;
revoke execute on function public.workspace_snapshot_v3() from public,anon,authenticated;
create function public.workspace_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d jsonb;begin d=public.workspace_snapshot_v3();return jsonb_set(d,'{contacts}',case when public.has_permission('contacts.read') or public.has_permission('contacts.write') then (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.contact_history t) else '[]'::jsonb end);end;$$;
revoke execute on function public.workspace_snapshot() from public,anon;
grant execute on function public.workspace_snapshot() to authenticated;

commit;
