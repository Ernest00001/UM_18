begin;

-- Trusted executive invitations can establish a name/email record before contact
-- details are supplied. Public registration and ordinary member writes stay strict.
alter table public.members alter column phone_original drop not null,
 alter column phone_normalized drop not null,alter column city drop not null,alter column country drop not null;
alter table public.members add column profile_incomplete boolean generated always as
 (phone_normalized is null or nullif(trim(city),'') is null or nullif(trim(country),'') is null) stored;
create index members_email_identity on public.members(lower(trim(email))) where email is not null;
alter table public.invitation_operations add column include_membership boolean not null default false,
 add column replacement_executive_id uuid references public.executive_accounts,
 add column replacement_offices text[];
create index invitation_replacement_lookup on public.invitation_operations(replacement_executive_id);
alter table public.executive_accounts add column access_pending boolean not null default false,
 add column invitation_operation_id uuid references public.invitation_operations,
 add column accepted_at timestamptz;
create index executive_invitation_lookup on public.executive_accounts(invitation_operation_id);

create schema um18_internal;
revoke all on schema um18_internal from public,anon,authenticated,service_role;

alter function public.has_permission_for(uuid,text) rename to has_permission_for_pre_membership;
revoke execute on function public.has_permission_for_pre_membership(uuid,text) from public,anon,authenticated,service_role;
create function public.has_permission_for(p_actor uuid,p_permission text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.executive_accounts where id=p_actor and not access_pending)
 and public.has_permission_for_pre_membership(p_actor,p_permission);
$$;
revoke execute on function public.has_permission_for(uuid,text) from public,anon,authenticated,service_role;

-- Never merge by name. An ambiguous email requires an explicit, reviewed link.
create function um18_internal.ensure_executive_member(p_id uuid,p_actor uuid) returns uuid language plpgsql set search_path='' as $$
declare a public.executive_accounts;m public.members;matches integer;mail text;
begin
 select * into a from public.executive_accounts where id=p_id for update;
 if a.member_id is not null then return a.member_id;end if;
 select lower(trim(email)) into mail from auth.users where id=p_id and email_confirmed_at is not null;
 if mail is null or mail<>lower(trim(a.email)) then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('executive-member:'||mail,0));
 select count(*) into matches from public.members where lower(trim(email))=mail and merged_into_member_id is null;
 if matches>1 then return null;end if;
 if matches=1 then
  select * into m from public.members where lower(trim(email))=mail and merged_into_member_id is null for update;
  if m.archived_at is not null or m.membership_status<>'active' then return null;end if;
 else
  insert into public.members(member_no,full_name,name_normalized,email,verified_by)
   values(public.next_member_number(),a.display_name,lower(trim(a.display_name)),mail,p_actor) returning * into m;
  insert into public.member_history(member_id,actor_id,reason,new_record)
   values(m.id,p_actor,'Confirmed executive invitation: contact details to be completed',to_jsonb(m));
 end if;
 update public.executive_accounts set member_id=m.id,updated_at=now() where id=p_id;
 insert into public.audit_events(actor_id,action,target_type,target_id,changes)
  values(p_actor,'executive.membership_linked','account',p_id,jsonb_build_object('member_id',m.id,'created',matches=0));
 return m.id;
end;$$;
revoke execute on function um18_internal.ensure_executive_member(uuid,uuid) from public,anon,authenticated,service_role;

alter function public.begin_invitation(uuid,jsonb) rename to begin_invitation_pre_membership;
revoke execute on function public.begin_invitation_pre_membership(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.begin_invitation(p_key uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;target public.executive_accounts;codes text[];replacement uuid;
begin
 perform public.require_permission('accounts.write');
 perform pg_advisory_xact_lock(18018);
 -- Completed retries retain their original identity, regardless of later handovers.
 if exists(select 1 from public.invitation_operations where actor_id=auth.uid() and idempotency_key=p_key and state='completed') then
  return public.begin_invitation_pre_membership(p_key,p_payload);
 end if;
 if coalesce((p_payload->>'include_membership')::boolean,false) then
  codes=public.parse_office_codes(coalesce(p_payload->'office_codes','[]'));
  replacement=nullif(p_payload->>'replaces_executive_id','')::uuid;
  if replacement is not null then
   if not exists(select 1 from public.executive_accounts where id=auth.uid() and 'president'=any(office_codes)) then raise exception 'Only the President can replace an executive' using errcode='42501';end if;
   select * into target from public.executive_accounts where id=replacement and active and not access_pending for update;
   if not found or replacement=auth.uid() or 'president'=any(target.office_codes)
    or exists(select 1 from public.role_assignments where executive_id=replacement and role_code='owner' and revoked_at is null)
    then raise exception 'The President and system administrator require a separate controlled handover';end if;
   if cardinality(codes)=0 or not(codes @> target.office_codes and codes <@ target.office_codes)
    or coalesce(p_payload->'roles','[]') ? 'owner' then raise exception 'A replacement must retain the outgoing offices without system administrator access';end if;
   if lower(trim(p_payload->>'email'))=lower(trim(target.email)) then raise exception 'Choose a different person for replacement; use Restore for the same executive';end if;
  end if;
  if exists(select 1 from public.executive_accounts where active and not access_pending and office_codes && codes and id is distinct from replacement) then
   raise exception 'This office is occupied. Choose Replace on the current executive, or remove their access first';
  end if;
 end if;
 result=public.begin_invitation_pre_membership(p_key,p_payload);
 update public.invitation_operations set include_membership=coalesce((p_payload->>'include_membership')::boolean,false),
  replacement_executive_id=replacement,replacement_offices=target.office_codes where id=(result->>'id')::uuid;
 return result;
end;$$;
revoke execute on function public.begin_invitation(uuid,jsonb) from public,anon,service_role;
grant execute on function public.begin_invitation(uuid,jsonb) to authenticated;

alter function public.provision_invitation_v2(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text,jsonb,jsonb,jsonb) rename to provision_invitation_pre_membership;
revoke execute on function public.provision_invitation_pre_membership(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.provision_invitation_v2(p_op uuid,p_lease uuid,p_actor uuid,p_id uuid,p_name text,p_email text,p_roles jsonb,p_permissions jsonb,p_expires timestamptz,p_member uuid,p_reason text,p_denied jsonb,p_schedule jsonb,p_offices jsonb default '[]') returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.invitation_operations;result jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 perform pg_advisory_xact_lock(18018);
 select * into op from public.invitation_operations where id=p_op for update;
 result=public.provision_invitation_pre_membership(p_op,p_lease,p_actor,p_id,p_name,p_email,p_roles,p_permissions,p_expires,p_member,p_reason,p_denied,p_schedule,p_offices);
 if op.state<>'completed' and op.include_membership then
  update public.executive_accounts set access_pending=true,invitation_operation_id=op.id where id=p_id returning to_jsonb(executive_accounts) into result;
 end if;
 return result;
end;$$;
revoke execute on function public.provision_invitation_v2(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.provision_invitation_v2(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text,jsonb,jsonb,jsonb) to service_role;

alter function public.current_context() rename to current_context_pre_membership;
revoke execute on function public.current_context_pre_membership() from public,anon,authenticated,service_role;
create function public.current_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.session_is_live() then raise exception 'Session expired, revoked, or recovery pending' using errcode='42501';end if;
 if exists(select 1 from public.executive_accounts where id=auth.uid() and access_pending) then
  return jsonb_build_object('id',auth.uid(),'needs_mfa',coalesce(auth.jwt()->>'aal','aal1')<>'aal2','invitation_pending',true,'permissions','[]'::jsonb,'office_codes','[]'::jsonb);
 end if;
 return public.current_context_pre_membership();
end;$$;
revoke execute on function public.current_context() from public,anon,service_role;
grant execute on function public.current_context() to authenticated;

-- Called only for the signed-in identity. A handover is atomic after accepted
-- email and MFA; the incumbent keeps access until this succeeds.
create function public.complete_executive_membership() returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.executive_accounts;op public.invitation_operations;old public.executive_accounts;mid uuid;actor uuid;
begin
 if not public.session_is_live() then raise exception 'Session expired, revoked, or recovery pending' using errcode='42501';end if;
 perform pg_advisory_xact_lock(18018);
 select * into a from public.executive_accounts where id=auth.uid() for update;
 if not exists(select 1 from auth.users where id=a.id and email_confirmed_at is not null and lower(trim(email))=lower(trim(a.email))) then raise exception 'Accept the invitation using the invited email first';end if;
 actor=a.id;
 if a.access_pending then
  select * into op from public.invitation_operations where id=a.invitation_operation_id and auth_user_id=a.id and state='completed';
  if not found or not public.has_permission_for(op.actor_id,'accounts.write') then raise exception 'The invitation requires a new approval from the President';end if;
  actor=op.actor_id;
  if not public.has_permission_for_pre_membership(a.id,'directory.read') then raise exception 'The assigned access is expired, withheld, or not yet effective';end if;
  perform public.require_active_invitation_member(a.member_id);
 end if;
 mid=um18_internal.ensure_executive_member(a.id,actor);
 if mid is null then return public.current_context()||jsonb_build_object('invitation_pending',true,'needs_mfa',false,'invitation_message','Membership needs review. Ask the President to link the correct active member record.');end if;
 if a.access_pending and coalesce(auth.jwt()->>'aal','aal1')='aal2' then
  if op.replacement_executive_id is not null then
   if not exists(select 1 from public.executive_accounts where id=op.actor_id and 'president'=any(office_codes)) then raise exception 'The replacement requires approval from the current President';end if;
   select * into old from public.executive_accounts where id=op.replacement_executive_id for update;
   if not old.active or old.access_pending or old.office_codes is distinct from op.replacement_offices
    or not(a.office_codes @> op.replacement_offices and a.office_codes <@ op.replacement_offices)
    or exists(select 1 from public.role_assignments where executive_id=a.id and role_code='owner' and revoked_at is null)
    or 'president'=any(old.office_codes)
    or exists(select 1 from public.role_assignments where executive_id=old.id and role_code='owner' and revoked_at is null) then
    return public.current_context()||jsonb_build_object('invitation_message','The outgoing appointment changed. Ask the President to review this handover.');
   end if;
  end if;
  if exists(select 1 from public.executive_accounts where active and not access_pending and id<>a.id and id is distinct from op.replacement_executive_id and office_codes && a.office_codes) then
   return public.current_context()||jsonb_build_object('invitation_message','An assigned office is occupied. Ask the President to review this invitation.');
  end if;
  if old.id is not null then
   update public.executive_accounts set active=false,auth_valid_after=now(),updated_at=now() where id=old.id;
   perform public.log_action('executive.replaced','account',old.id,jsonb_build_object('successor_id',a.id,'member_retained',true));
  end if;
  update public.executive_accounts set access_pending=false,accepted_at=now(),updated_at=now() where id=a.id;
  perform public.log_action('executive.invitation_accepted','account',a.id,jsonb_build_object('member_id',mid,'replaces',old.id));
 end if;
 return public.current_context();
end;$$;
revoke execute on function public.complete_executive_membership() from public,anon,service_role;
grant execute on function public.complete_executive_membership() to authenticated;

alter function public.execute_action(text,jsonb,uuid) rename to execute_action_pre_membership;
revoke execute on function public.execute_action_pre_membership(text,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.execute_action(p_action text,p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.executive_accounts;receipt public.command_receipts;result jsonb;hash text;pid uuid;reason text;
begin
 if p_action not in ('remove_executive','restore_executive') then
  if p_action='save_account' then
   perform public.require_permission('accounts.write');perform pg_advisory_xact_lock(18018);
   select * into target from public.executive_accounts where id=nullif(p_payload->>'id','')::uuid for update;
   if target.member_id is not null and nullif(p_payload->>'member_id','') is null then raise exception 'Keep the membership link; removing executive access must retain the member record';end if;
   if not target.active and not target.access_pending and coalesce(p_payload->>'active','true')='true' and exists(
    select 1 from public.executive_accounts where active and not access_pending and id<>target.id
    and office_codes && case when p_payload ? 'office_codes' then public.parse_office_codes(p_payload->'office_codes') else target.office_codes end
   ) then raise exception 'The office is occupied. Remove or replace the current executive first';end if;
  end if;
  return public.execute_action_pre_membership(p_action,p_payload,p_key);
 end if;
 perform public.require_permission('accounts.write');
 if not exists(select 1 from public.executive_accounts where id=auth.uid() and 'president'=any(office_codes)) then raise exception 'Only the President can remove or restore executives' using errcode='42501';end if;
 if p_key is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>24000 then raise exception 'Invalid operation';end if;
 perform pg_advisory_xact_lock(18018);hash=md5(p_action||p_payload::text);
 select * into receipt from public.command_receipts where actor_id=auth.uid() and idempotency_key=p_key;
 if found then if receipt.request_hash<>hash then raise exception 'Retry key reused with different contents';end if;return receipt.result;end if;
 pid=nullif(p_payload->>'id','')::uuid;reason=trim(p_payload->>'reason');
 if reason is null or length(reason) not between 2 and 1500 then raise exception 'Provide an access change reason';end if;
 select * into target from public.executive_accounts where id=pid for update;
 if not found then raise exception 'Executive not found';end if;
 if pid=auth.uid() or 'president'=any(target.office_codes) or exists(select 1 from public.role_assignments where executive_id=pid and role_code='owner' and revoked_at is null) then raise exception 'The President and system administrator require a separate controlled handover';end if;
 if p_action='restore_executive' then
  if target.access_pending then raise exception 'This invitation was not accepted. Invite the executive again or review their pending invitation';end if;
  if target.active then raise exception 'Executive access is already active';end if;
  if exists(select 1 from public.executive_accounts where active and not access_pending and id<>pid and office_codes && target.office_codes) then raise exception 'The office is occupied. Remove or replace the current executive first';end if;
  if target.member_id is not null then perform public.require_active_invitation_member(target.member_id);end if;
 else
  if not target.active then raise exception 'Executive access is already removed';end if;
 end if;
 update public.executive_accounts set active=(p_action='restore_executive'),auth_valid_after=now(),updated_at=now() where id=pid returning to_jsonb(executive_accounts) into result;
 perform public.log_action(p_action,'account',pid,jsonb_build_object('reason',reason,'member_retained',true));
 insert into public.command_receipts(actor_id,idempotency_key,request_hash,result) values(auth.uid(),p_key,hash,result);
 return result;
end;$$;
revoke execute on function public.execute_action(text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.execute_action(text,jsonb,uuid) to authenticated;

create function um18_internal.member_offices(p_member uuid) returns text[] language sql stable set search_path='' as $$
 select coalesce(array_agg(distinct office order by office),'{}'::text[]) from public.executive_accounts a cross join unnest(a.office_codes) office
 where a.member_id=p_member and a.active and not a.access_pending;
$$;
revoke execute on function um18_internal.member_offices(uuid) from public,anon,authenticated,service_role;
alter function public.search_members(text,text,text,integer,integer,text,boolean) rename to search_members_pre_membership;
revoke execute on function public.search_members_pre_membership(text,text,text,integer,integer,text,boolean) from public,anon,authenticated,service_role;
create function public.search_members(p_query text default '',p_status text default '',p_country text default '',p_offset integer default 0,p_limit integer default 20,p_sort text default 'full_name',p_desc boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d jsonb;begin
 d=public.search_members_pre_membership(p_query,p_status,p_country,p_offset,p_limit,p_sort,p_desc);
 return jsonb_set(d,'{rows}',(select coalesce(jsonb_agg(x||jsonb_build_object('executive_offices',um18_internal.member_offices((x->>'id')::uuid))),'[]') from jsonb_array_elements(d->'rows') x));
end;$$;
revoke execute on function public.search_members(text,text,text,integer,integer,text,boolean) from public,anon,service_role;
grant execute on function public.search_members(text,text,text,integer,integer,text,boolean) to authenticated;
alter function public.workspace_data(text,uuid) rename to workspace_data_pre_membership;
revoke execute on function public.workspace_data_pre_membership(text,uuid) from public,anon,authenticated,service_role;
create function public.workspace_data(p_area text,p_target uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d jsonb;begin
 d=public.workspace_data_pre_membership(p_area,p_target);
 return jsonb_set(d,'{members}',(select coalesce(jsonb_agg(x||jsonb_build_object('executive_offices',um18_internal.member_offices((x->>'id')::uuid))),'[]') from jsonb_array_elements(d->'members') x));
end;$$;
revoke execute on function public.workspace_data(text,uuid) from public,anon,service_role;
grant execute on function public.workspace_data(text,uuid) to authenticated;

-- Backfill existing confirmed executives, including the first President, without
-- guessed phone/location details or duplicate name-based matching.
do $$declare a record;begin
 for a in select e.id from public.executive_accounts e join auth.users u on u.id=e.id where u.email_confirmed_at is not null and e.member_id is null
 loop perform um18_internal.ensure_executive_member(a.id,a.id);end loop;
end;$$;
commit;
