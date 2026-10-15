begin;
alter table public.executive_accounts add column last_password_login_at timestamptz;
alter table public.members add column contact_details_incomplete boolean generated always as
 (nullif(trim(email),'') is null or nullif(trim(details->>'whatsapp'),'') is null) stored;
-- This address was explicitly identified as the association mailbox, not a person.
update public.branding set contact_email='unmatched018@gmail.com',version=version+1,updated_at=now() where contact_email is null;

create function public.submit_member_application(p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.role()<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 if not exists(select 1 from public.membership_submissions where idempotency_key=p_key) then
  if coalesce(p_payload->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p_payload->>'email')>180 then raise exception 'A valid personal email is required';end if;
  if nullif(trim(p_payload->>'whatsapp'),'') is null then raise exception 'WhatsApp number is required';end if;
  if (p_payload->>'whatsapp_normalized') is distinct from public.normalise_phone(p_payload->>'whatsapp') then raise exception 'Valid WhatsApp number required';end if;
 end if;
 return public.submit_registration(p_payload,p_key);
end;$$;
revoke execute on function public.submit_member_application(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.submit_member_application(jsonb,uuid) to service_role;

create function public.my_profile() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.executive_accounts;m public.members;
begin
 perform public.require_permission('directory.read');select * into a from public.executive_accounts where id=auth.uid();
 select * into m from public.members where id=a.member_id;
 return jsonb_build_object('account',jsonb_build_object('id',a.id,'display_name',a.display_name,'email',a.email,'member_id',a.member_id,'office_codes',a.office_codes),
  'member',case when m.id is null then null else jsonb_build_object('id',m.id,'member_no',m.member_no,'full_name',m.full_name,'email',m.email,
   'phone_original',m.phone_original,'whatsapp',m.details->>'whatsapp','city',m.city,'country',m.country,'region',m.region) end,
  'official_email',(select contact_email from public.branding),
  'can_resolve_placeholder','president'=any(a.office_codes) and m.profile_incomplete and lower(coalesce(m.email,''))=lower(coalesce((select contact_email from public.branding),'')));
end;$$;
revoke execute on function public.my_profile() from public,anon,service_role;
grant execute on function public.my_profile() to authenticated;

alter function public.begin_invitation(uuid,jsonb) rename to begin_invitation_pre_profile;
revoke execute on function public.begin_invitation_pre_profile(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.begin_invitation(p_key uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.members;
begin
 perform public.require_permission('accounts.write');
 if not exists(select 1 from public.invitation_operations where actor_id=auth.uid() and idempotency_key=p_key and state='completed')
  and coalesce(p_payload->'office_codes','[]') ? 'president' then raise exception 'The President requires a separate controlled handover';end if;
 if coalesce((p_payload->>'approved_member_invitation')::boolean,false) and not exists(select 1 from public.invitation_operations where actor_id=auth.uid() and idempotency_key=p_key and state='completed') then
  perform public.require_active_invitation_member(nullif(p_payload->>'member_id','')::uuid);
  select * into m from public.members where id=nullif(p_payload->>'member_id','')::uuid;
  if not found or nullif(trim(m.email),'') is null or lower(trim(m.email))<>lower(trim(p_payload->>'email'))
   or lower(trim(m.email))=lower(coalesce((select contact_email from public.branding),'')) then raise exception 'Invite an approved member using their personal email';end if;
 end if;
 return public.begin_invitation_pre_profile(p_key,p_payload);
end;$$;
revoke execute on function public.begin_invitation(uuid,jsonb) from public,anon,service_role;
grant execute on function public.begin_invitation(uuid,jsonb) to authenticated;

create function public.save_my_profile(p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.executive_accounts;m public.members;old public.members;pid uuid;receipt public.command_receipts;hash text;result jsonb;mail text;reason text;
begin
 perform public.require_permission('directory.read');
 if p_key is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>12000
  or (p_payload-array['full_name','email','phone_original','whatsapp','city','country','region','member_id','link_confirmed','reason'])<>'{}'::jsonb then raise exception 'Invalid profile fields';end if;
 perform pg_advisory_xact_lock(18018);hash=md5('save_my_profile'||p_payload::text);
 select * into receipt from public.command_receipts where actor_id=auth.uid() and idempotency_key=p_key;
 if found then if receipt.request_hash<>hash then raise exception 'Retry key reused with different contents';end if;return receipt.result;end if;
 select * into a from public.executive_accounts where id=auth.uid() for update;
 mail=lower(trim(p_payload->>'email'));reason=trim(p_payload->>'reason');pid=coalesce(nullif(p_payload->>'member_id','')::uuid,a.member_id);
 if mail is null or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(mail)>180 then raise exception 'Valid personal email is required';end if;
 if mail=lower(coalesce((select contact_email from public.branding),'')) then raise exception 'Use your personal email; the organisation mailbox belongs to the office';end if;
 if reason is null or length(reason) not between 2 and 1500 then raise exception 'Provide a profile update reason';end if;
 if nullif(trim(p_payload->>'whatsapp'),'') is null then raise exception 'WhatsApp number is required';end if;
 perform public.normalise_phone(p_payload->>'whatsapp');
 if pid is null then raise exception 'Ask the President to link your approved member record';end if;
 select * into old from public.members where id=a.member_id for update;
 select * into m from public.members where id=pid for update;
 if not found or m.membership_status<>'active' or m.archived_at is not null or m.merged_into_member_id is not null then raise exception 'Choose your active approved member record';end if;
 if pid is distinct from a.member_id then
  if not ('president'=any(a.office_codes)) or not old.profile_incomplete or lower(coalesce(old.email,''))<>lower(coalesce((select contact_email from public.branding),''))
   or coalesce((p_payload->>'link_confirmed')::boolean,false) is not true then raise exception 'Confirm your identity before resolving the organisation placeholder';end if;
  if exists(select 1 from public.executive_accounts where member_id=pid and id<>a.id and active) then raise exception 'This member is already linked to another active executive';end if;
  perform public.execute_action('merge_members',jsonb_build_object('id',old.id,'target_id',pid,'assessment_policy','keep_target','attendance_policy','keep_target','reason','President confirmed personal member identity: '||reason),md5(p_key::text||':member-link')::uuid);
 end if;
 m=public.member_write(to_jsonb(m)||jsonb_build_object('id',pid,'full_name',trim(p_payload->>'full_name'),'email',mail,'phone_original',p_payload->>'phone_original',
  'city',p_payload->>'city','country',p_payload->>'country','region',p_payload->>'region','details',m.details||jsonb_build_object('whatsapp',p_payload->>'whatsapp'),'reason',reason),a.id);
 update public.executive_accounts set member_id=pid,display_name=m.full_name,updated_at=now() where id=a.id;
 perform public.log_action('executive.personal_profile_updated','account',a.id,jsonb_build_object('member_id',pid,'reason',reason,'signin_email_changed',false));
 result=public.my_profile();insert into public.command_receipts(actor_id,idempotency_key,request_hash,result) values(a.id,p_key,hash,result);return result;
end;$$;
revoke execute on function public.save_my_profile(jsonb,uuid) from public,anon,service_role;
grant execute on function public.save_my_profile(jsonb,uuid) to authenticated;

-- Supabase confirms sign-in email changes. Personal contact edits alone never
-- change credentials or grant a new person the old person's account.
create function um18_internal.sync_personal_signin() returns void language plpgsql set search_path='' as $$
declare a public.executive_accounts;mail text;
begin
 if not um18_internal.password_session() then return;end if;
 select * into a from public.executive_accounts where id=auth.uid() for update;
 select lower(trim(email)) into mail from auth.users where id=a.id and email_confirmed_at is not null;
 if mail is distinct from lower(trim(a.email)) and mail is not null then
  if lower(coalesce(auth.jwt()->>'email',''))<>mail or not exists(select 1 from public.members where id=a.member_id and lower(trim(email))=mail and merged_into_member_id is null) then
   raise exception 'Save your personal email in My profile, confirm the email change, then sign in again';end if;
  update public.executive_accounts set email=mail,updated_at=now() where id=a.id;
  perform public.log_action('executive.signin_email_confirmed','account',a.id,jsonb_build_object('member_id',a.member_id));
 end if;
 update public.executive_accounts set last_password_login_at=now() where id=a.id;
end;$$;
revoke execute on function um18_internal.sync_personal_signin() from public,anon,authenticated,service_role;
alter function public.complete_executive_membership() rename to complete_executive_membership_pre_profile;
revoke execute on function public.complete_executive_membership_pre_profile() from public,anon,authenticated,service_role;
create function public.complete_executive_membership() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(18018);perform um18_internal.sync_personal_signin();return public.complete_executive_membership_pre_profile();
end;$$;
revoke execute on function public.complete_executive_membership() from public,anon,service_role;
grant execute on function public.complete_executive_membership() to authenticated;

create function public.presidential_candidates() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_permission('accounts.write');
 if not exists(select 1 from public.executive_accounts where id=auth.uid() and 'president'=any(office_codes)) then raise exception 'Only the President can manage presidential handover' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('member_id',m.id,'member_no',m.member_no,'full_name',m.full_name,'email',m.email,'executive_id',a.id,
  'ready',a.active and not a.access_pending and not m.profile_incomplete and not m.contact_details_incomplete and a.last_password_login_at is not null and lower(a.email)=lower(m.email) and u.email_confirmed_at is not null and lower(u.email)=lower(a.email)
    and public.has_permission_for(a.id,'directory.read'),
  'status',case when a.id is null then 'Invite this member first' when not a.active then 'Restore and assign access first' when a.access_pending then 'Awaiting invitation acceptance'
    when m.profile_incomplete or m.contact_details_incomplete then 'Complete personal member details first'
    when lower(a.email)<>lower(m.email) or u.email_confirmed_at is null or lower(u.email) is distinct from lower(a.email) then 'Confirm personal sign-in email first'
    when not public.has_permission_for(a.id,'directory.read') then 'Assign current workspace access first'
    when a.last_password_login_at is null then 'Awaiting first password sign-in' else 'Ready for review' end) order by m.full_name),'[]')
  from public.members m left join lateral (select * from public.executive_accounts where member_id=m.id order by active desc,created_at desc,id limit 1) a on true left join auth.users u on u.id=a.id
  where m.membership_status='active' and m.archived_at is null and m.merged_into_member_id is null
   and m.id is distinct from (select member_id from public.executive_accounts where id=auth.uid())
   and nullif(trim(m.email),'') is not null and lower(m.email)<>lower(coalesce((select contact_email from public.branding),'')));
end;$$;
revoke execute on function public.presidential_candidates() from public,anon,service_role;
grant execute on function public.presidential_candidates() to authenticated;

alter function public.execute_action(text,jsonb,uuid) rename to execute_action_pre_profile;
revoke execute on function public.execute_action_pre_profile(text,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.execute_action(p_action text,p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare source public.executive_accounts;target public.executive_accounts;m public.members;receipt public.command_receipts;hash text;result jsonb;reason text;new_role uuid;
begin
 if p_action='save_account' then
  perform public.require_permission('accounts.write');perform pg_advisory_xact_lock(18018);
  select * into target from public.executive_accounts where id=nullif(p_payload->>'id','')::uuid;
  if not exists(select 1 from public.command_receipts where actor_id=auth.uid() and idempotency_key=p_key) and p_payload ? 'office_codes' and (coalesce(p_payload->'office_codes','[]') ? 'president') is distinct from ('president'=any(target.office_codes)) then
   raise exception 'Use the protected presidential handover to change the President';end if;
 end if;
 if p_action='restore_executive' then
  perform public.require_permission('accounts.write');
  if not exists(select 1 from public.command_receipts where actor_id=auth.uid() and idempotency_key=p_key)
   and not exists(select 1 from public.role_assignments where executive_id=nullif(p_payload->>'id','')::uuid and revoked_at is null and (expires_at is null or expires_at>now())) then
   raise exception 'Assign a new office and access role through Manage permissions first';end if;
 end if;
 if p_action<>'handover_presidency' then return public.execute_action_pre_profile(p_action,p_payload,p_key);end if;
 perform public.require_permission('accounts.write');perform pg_advisory_xact_lock(18018);
 select * into source from public.executive_accounts where id=auth.uid() for update;
 if not ('president'=any(source.office_codes)) then raise exception 'Only the President can hand over this office' using errcode='42501';end if;
 if p_key is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>12000 then raise exception 'Invalid handover';end if;
 hash=md5(p_action||p_payload::text);select * into receipt from public.command_receipts where actor_id=source.id and idempotency_key=p_key;
 if found then if receipt.request_hash<>hash then raise exception 'Retry key reused with different contents';end if;return receipt.result;end if;
 reason=trim(p_payload->>'reason');
 if reason is null or length(reason) not between 2 and 1500 or coalesce((p_payload->>'confirmed')::boolean,false) is not true
  or coalesce((p_payload->>'mailbox_handover_acknowledged')::boolean,false) is not true then raise exception 'Confirm the successor, mailbox handover and approval reason';end if;
 if not exists(select 1 from public.members where id=source.member_id and not profile_incomplete and not contact_details_incomplete and lower(email)<>lower(coalesce((select contact_email from public.branding),''))) then raise exception 'Complete your personal member profile before handing over';end if;
 select * into m from public.members where id=nullif(p_payload->>'member_id','')::uuid and membership_status='active' and archived_at is null and merged_into_member_id is null for update;
 if not found or m.id=source.member_id or m.profile_incomplete or m.contact_details_incomplete then raise exception 'Choose another approved member with complete personal contact details';end if;
 select * into target from public.executive_accounts where member_id=m.id and id<>source.id and active and not access_pending order by created_at desc limit 1 for update;
 if not found or target.last_password_login_at is null or not public.has_permission_for(target.id,'directory.read')
  or lower(target.email)<>lower(m.email) or lower(m.email)=lower(coalesce((select contact_email from public.branding),''))
  or not exists(select 1 from auth.users where id=target.id and email_confirmed_at is not null and lower(email)=lower(target.email)) then raise exception 'The successor must accept their invitation and sign in with their personal email first';end if;
 -- Install the incoming owner before retiring the outgoing owner. The last-owner
 -- constraint remains in force, including at transaction commit.
 update public.role_assignments set revoked_at=now() where executive_id=target.id and revoked_at is null;
 insert into public.role_assignments(executive_id,role_code,assigned_by) values(target.id,'owner',source.id) returning id into new_role;
 delete from public.permission_denials where executive_id=target.id;
 update public.executive_accounts set office_codes=array['president'],updated_at=now() where id=target.id;
 update public.executive_accounts set active=false,office_codes='{}',auth_valid_after=now(),updated_at=now() where id=source.id;
 update public.role_assignments set revoked_at=now() where executive_id=source.id and revoked_at is null;
 delete from public.explicit_permissions where executive_id=source.id;
 perform public.log_action('president.handover_completed','account',target.id,jsonb_build_object('reason',reason,'outgoing_executive_id',source.id,'outgoing_member_id',source.member_id,'incoming_member_id',m.id,'mailbox_handover_acknowledged',true));
 result=jsonb_build_object('completed',true,'president_id',target.id,'member_id',m.id,'outgoing_member_retained',true);
 insert into public.command_receipts(actor_id,idempotency_key,request_hash,result) values(source.id,p_key,hash,result);return result;
end;$$;
revoke execute on function public.execute_action(text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.execute_action(text,jsonb,uuid) to authenticated;

create function public.member_contributions(p_member uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;received bigint;allocated bigint;
begin
 perform public.require_permission('directory.read');
 if not exists(select 1 from public.members where id=p_member and merged_into_member_id is null) then raise exception 'Member unavailable';end if;
 select coalesce(sum(public.net_payment(id)),0) into received from public.payments where member_id=p_member and status='confirmed';
 select coalesce(sum(a.amount_kobo),0) into allocated from public.payment_allocations a join public.payments p on p.id=a.payment_id where p.member_id=p_member and p.status='confirmed';
 with coverage as (
  select c.id,c.title,c.category,c.period,coalesce(a.expected_kobo-a.waiver_kobo,0) due_kobo,
   coalesce((select sum(x.amount_kobo) from public.payment_allocations x join public.payments p on p.id=x.payment_id where x.collection_id=c.id and x.member_id=p_member and p.status='confirmed'),0) paid_kobo
  from public.contribution_collections c left join public.member_assessments a on a.collection_id=c.id and a.member_id=p_member and a.superseded_by is null
  where c.status<>'draft' and (a.id is not null or exists(select 1 from public.payment_allocations x join public.payments p on p.id=x.payment_id where x.collection_id=c.id and x.member_id=p_member and p.status='confirmed'))
 )
 select jsonb_build_object('member_id',p_member,'total_confirmed_kobo',received,'credit_kobo',greatest(0,received-allocated),
  'monthly_kobo',coalesce((select sum(paid_kobo) from coverage where category='monthly'),0),'special_kobo',coalesce((select sum(paid_kobo) from coverage where category<>'monthly'),0),
  'outstanding_kobo',coalesce((select sum(greatest(0,due_kobo-paid_kobo)) from coverage),0),
  'coverage',(select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('outstanding_kobo',greatest(0,due_kobo-paid_kobo)) order by period nulls last,title),'[]') from coverage c),
  'payments',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'payment_date',p.payment_date,'net_kobo',public.net_payment(p.id),'status',p.status) order by p.payment_date desc,p.id),'[]') from public.payments p where p.member_id=p_member and p.status='confirmed')) into result;
 return result;
end;$$;
revoke execute on function public.member_contributions(uuid) from public,anon,service_role;
grant execute on function public.member_contributions(uuid) to authenticated;

alter function public.workspace_data(text,uuid) rename to workspace_data_pre_profile;
revoke execute on function public.workspace_data_pre_profile(text,uuid) from public,anon,authenticated,service_role;
create function public.workspace_data(p_area text,p_target uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin return public.workspace_data_pre_profile(case when p_area='profile' then 'overview' else p_area end,p_target);end;$$;
revoke execute on function public.workspace_data(text,uuid) from public,anon,service_role;
grant execute on function public.workspace_data(text,uuid) to authenticated;
commit;
