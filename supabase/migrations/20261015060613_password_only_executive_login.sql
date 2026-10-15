begin;

-- Password sign-in is sufficient. An invitation/recovery token alone must not
-- activate an appointment or grant access before a password has been established.
create function um18_internal.password_session() returns boolean language sql stable set search_path='' as $$
 select public.session_is_live() and exists(
  select 1 from jsonb_array_elements(case when jsonb_typeof(auth.jwt()->'amr')='array' then auth.jwt()->'amr' else '[]'::jsonb end) proof
  where proof->>'method'='password'
 );
$$;
revoke execute on function um18_internal.password_session() from public,anon,authenticated,service_role;

create or replace function public.has_permission(p_permission text) returns boolean language sql stable security definer set search_path='' as $$
 select um18_internal.password_session() and public.has_permission_for(auth.uid(),p_permission);
$$;
create or replace function public.require_permission(p_permission text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_permission(p_permission) then raise exception 'Access denied: sign in with your password and current executive permissions' using errcode='42501';end if;
end;$$;

create or replace function public.current_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.executive_accounts;rs jsonb;ps jsonb;
begin
 if not public.session_is_live() then raise exception 'Session expired, revoked, or recovery pending' using errcode='42501';end if;
 select * into a from public.executive_accounts where id=auth.uid();
 if not exists(select 1 from public.role_assignments where executive_id=a.id and revoked_at is null and starts_at<=now() and (expires_at is null or expires_at>now())) then
  raise exception 'Account unavailable' using errcode='42501';end if;
 if not um18_internal.password_session() or a.access_pending then
  return jsonb_build_object('id',a.id,'display_name',a.display_name,'needs_password',not um18_internal.password_session(),
   'needs_mfa',false,'invitation_pending',a.access_pending,'permissions','[]'::jsonb,'office_codes','[]'::jsonb,'login_method','password');
 end if;
 select coalesce(jsonb_agg(role_code),'[]') into rs from public.role_assignments where executive_id=a.id and revoked_at is null and starts_at<=now() and (expires_at is null or expires_at>now());
 select coalesce(jsonb_agg(code),'[]') into ps from public.permissions where public.has_permission(code);
 return jsonb_build_object('id',a.id,'display_name',a.display_name,'email',a.email,'roles',rs,'permissions',ps,'office_codes',a.office_codes,
  'needs_mfa',false,'needs_password',false,'login_method','password');
end;$$;

alter table public.private_settings drop constraint private_settings_mfa_required_check;
alter table public.private_settings alter column mfa_required set default false;
update public.private_settings set mfa_required=false,updated_at=now();

-- The finalization definition below preserves membership matching, current
-- inviter authority and atomic replacement. Only the verification condition changes.
create or replace function public.complete_executive_membership() returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.executive_accounts;op public.invitation_operations;old public.executive_accounts;mid uuid;actor uuid;
begin
 if not public.session_is_live() then raise exception 'Session expired, revoked, or recovery pending' using errcode='42501';end if;
 if not um18_internal.password_session() then return public.current_context();end if;
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
 if a.access_pending then
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

commit;
