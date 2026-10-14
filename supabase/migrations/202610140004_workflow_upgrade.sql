-- Additive UM18 upgrade. Existing records, sequences and history are retained.
begin;
insert into public.permissions values('welfare.assign'),('accounts.mfa_reset') on conflict do nothing;
insert into public.role_permissions values('owner','welfare.assign'),('owner','accounts.mfa_reset') on conflict do nothing;
create table public.permission_denials(executive_id uuid references public.executive_accounts,permission text references public.permissions,expires_at timestamptz,primary key(executive_id,permission));
alter table public.permission_denials enable row level security;
revoke all on public.permission_denials from anon,authenticated;
alter table public.executive_accounts add column auth_valid_after timestamptz,add column mfa_recovery_pending boolean not null default false;
create or replace function public.has_permission_for(p_actor uuid,p_permission text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.executive_accounts a where a.id=p_actor and a.active and not a.mfa_recovery_pending and exists(select 1 from public.role_assignments live where live.executive_id=a.id and live.revoked_at is null and live.starts_at<=now() and (live.expires_at is null or live.expires_at>now())) and
 not exists(select 1 from public.permission_denials d where d.executive_id=a.id and d.permission=p_permission and (d.expires_at is null or d.expires_at>now())) and (
 exists(select 1 from public.role_assignments r join public.role_permissions p on p.role_code=r.role_code where r.executive_id=a.id and p.permission=p_permission and r.revoked_at is null and r.starts_at<=now() and (r.expires_at is null or r.expires_at>now())) or
 exists(select 1 from public.explicit_permissions e where e.executive_id=a.id and e.permission=p_permission and (e.expires_at is null or e.expires_at>now()))));
$$;
create function public.session_is_live() returns boolean language sql stable security definer set search_path='' as $$
 select case when coalesce(auth.jwt()->>'session_id','') ~ '^[0-9a-fA-F-]{36}$' then
 exists(select 1 from auth.sessions s join public.executive_accounts a on a.id=s.user_id where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=auth.uid() and a.active and not a.mfa_recovery_pending and (a.auth_valid_after is null or coalesce((auth.jwt()->>'iat')::bigint,0)>floor(extract(epoch from a.auth_valid_after)))) else false end;
$$;
create or replace function public.has_permission(p_permission text) returns boolean language sql stable security definer set search_path='' as $$select public.session_is_live() and coalesce(auth.jwt()->>'aal','aal1')='aal2' and public.has_permission_for(auth.uid(),p_permission);$$;
alter function public.current_context() rename to current_context_v1;
create function public.current_context() returns jsonb language plpgsql stable security definer set search_path='' as $$begin if not public.session_is_live() then raise exception 'Session expired, revoked, or recovery pending' using errcode='42501';end if;return public.current_context_v1();end;$$;
revoke execute on function public.current_context_v1(),public.session_is_live() from public,anon,authenticated;
grant execute on function public.current_context() to authenticated;

alter table public.payments add column revision bigint not null default 1,add column replaces_payment_id uuid references public.payments;
drop index public.unique_transfer_reference;
create unique index unique_transfer_reference on public.payments(lower(external_reference)) where method='bank_transfer' and external_reference is not null and status in ('pending','confirmed');
create unique index one_active_payment_replacement on public.payments(replaces_payment_id) where replaces_payment_id is not null and status in ('pending','confirmed');
alter table public.financial_adjustments add column effective_date date not null default (now() at time zone 'Africa/Lagos')::date,add column operation_key uuid;
alter table public.allocation_history add column effective_date date not null default (now() at time zone 'Africa/Lagos')::date,add column movement_kind text not null default 'allocation',add column operation_key uuid;
create table public.payment_metadata_history(id uuid primary key default gen_random_uuid(),payment_id uuid not null references public.payments,actor_id uuid not null references public.executive_accounts,reason text not null,old_record jsonb not null,new_record jsonb not null,created_at timestamptz not null default now());
alter table public.payment_metadata_history enable row level security;
create policy payment_metadata_read on public.payment_metadata_history for select to authenticated using(public.has_permission('finance.read'));
grant select on public.payment_metadata_history to authenticated;
create or replace function public.guard_payment_transition() returns trigger language plpgsql set search_path='' as $$
begin
 if new.original_member_id<>old.original_member_id or (new.amount_kobo,new.currency) is distinct from (old.amount_kobo,old.currency) then raise exception 'Original identity and receipt amount are immutable';end if;
 if coalesce(current_setting('um18.payment_correction',true),'')<>'yes' and ((new.payment_date,new.method,new.reference,new.external_reference) is distinct from (old.payment_date,old.method,old.reference,old.external_reference) or (new.member_id<>old.member_id and coalesce(current_setting('um18.member_merge',true),'')<>'yes')) then raise exception 'Use an audited payment correction';end if;
 if new.status<>old.status and not ((old.status='pending' and new.status in ('confirmed','rejected')) or (old.status='confirmed' and new.status='reversed')) then raise exception 'Payment transition is not allowed';end if;return new;
end;$$;
alter table public.member_assessments add column effective_date date;
alter table public.contact_history add column outcome text,add column follow_up_date date,add column updated_at timestamptz not null default now();
alter table public.documents add column category text not null default 'supporting',add column description text,add column version integer not null default 1,add column previous_version_id uuid references public.documents,add column archived_at timestamptz,add column archive_reason text;
create index document_record_scope on public.documents(scope,target_id,archived_at);

alter function public.execute_action(text,jsonb,uuid) rename to execute_action_v1;
revoke execute on function public.execute_action_v1(text,jsonb,uuid) from public,anon,authenticated;
create function public.execute_action(p_action text,p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid=auth.uid();permission text;receipt public.command_receipts;hash text;pid uuid;mid uuid;reason text;result jsonb;p public.payments;c public.contribution_collections;a public.member_assessments;old_rows jsonb;old_record jsonb;v jsonb;aid uuid;target uuid;doc public.documents;m public.members;w public.welfare_cases;effective date;hist_ids uuid[];
begin
 permission=case when p_action in ('correct_payment','add_assessments') then 'finance.write' when p_action='reassign_welfare' then 'welfare.assign' when p_action='update_contact' then 'contacts.write' when p_action='update_document' then 'documents.write' when p_action in ('import_link','import_update','import_create_reviewed') then 'members.import' else null end;
 if actor is null or p_key is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536 then raise exception 'Invalid authenticated operation' using errcode='42501';end if;
 -- Retries are checked before stale-revision checks, but current authority is always rechecked.
 if permission is null then permission=case when p_action in ('approve_submission','reject_submission') then 'registrations.review' when p_action in ('save_member','archive_member','merge_members') then 'members.write' when p_action='import_member' then 'members.import' when p_action in ('save_collection','publish_collection','close_collection','adjust_assessment','record_payment','transition_payment','allocate_payment','adjust_payment','save_expense','transition_expense') then 'finance.write' when p_action='save_contact' then 'contacts.write' when p_action in ('save_event','record_attendance') then 'events.write' when p_action='save_welfare' then 'welfare.write' when p_action in ('save_branding','save_settings') then 'settings.write' when p_action='save_account' then 'accounts.write' when p_action='export_audit' then case p_payload->>'scope' when 'finance' then 'finance.export' when 'welfare' then 'welfare.export' when 'directory' then 'directory.export' end else 'INVALID' end;end if;
 perform public.require_permission(permission);perform pg_advisory_xact_lock(hashtextextended(actor::text||p_key::text,0));hash=md5(p_action||p_payload::text);
 select * into receipt from public.command_receipts where actor_id=actor and idempotency_key=p_key;
 if found then if receipt.request_hash<>hash then raise exception 'Retry key reused with different contents';end if;return receipt.result;end if;
 pid=nullif(p_payload->>'id','')::uuid;reason=trim(coalesce(p_payload->>'reason',''));effective=coalesce(nullif(p_payload->>'effective_date','')::date,(now() at time zone 'Africa/Lagos')::date);
 if p_action in ('allocate_payment','adjust_payment','transition_payment','correct_payment') then
 select * into p from public.payments where id=pid for update;if not found then raise exception 'Payment unavailable';end if;
 if p_payload->>'expected_revision' is null or (p_payload->>'expected_revision')::bigint<>p.revision then raise exception 'Payment changed. Refresh and review the latest record before saving.' using errcode='40001';end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into old_rows from public.payment_allocations x where payment_id=pid;
 select coalesce(array_agg(id),'{}') into hist_ids from public.allocation_history where payment_id=pid;
 end if;
 case p_action
 when 'import_link' then
 perform public.require_permission('members.write');if p_payload->>'identity_verified' is distinct from 'true' or length(reason)<2 or not exists(select 1 from public.members where id=pid) then raise exception 'Reviewed identity, target member and reason required';end if;result=jsonb_build_object('id',pid,'linked',true);
 when 'import_update' then
 perform public.require_permission('members.write');if p_payload->>'identity_verified' is distinct from 'true' or not exists(select 1 from public.members where id=pid and archived_at is null) then raise exception 'Reviewed identity and current target member required';end if;m=public.member_write(p_payload,actor);result=to_jsonb(m);
 when 'import_create_reviewed' then
 perform public.require_permission('members.write');if p_payload->>'identity_verified' is distinct from 'true' then raise exception 'Confirm separate identity before creating a matching member';end if;m=public.member_write(p_payload-'id',actor);result=to_jsonb(m);pid=m.id;
 when 'correct_payment' then
 if length(reason)<2 then raise exception 'Correction reason required';end if;old_record=to_jsonb(p);mid=(p_payload->>'member_id')::uuid;
 if not exists(select 1 from public.members where id=mid and archived_at is null) then raise exception 'Corrected member unavailable';end if;
 if mid<>p.member_id then if p.status='confirmed' then perform public.replace_allocations(pid,'[]','Allocations released for member correction: '||reason);else delete from public.payment_allocations where payment_id=pid;end if;end if;
 perform set_config('um18.payment_correction','yes',true);
 update public.payments set member_id=mid,payment_date=(p_payload->>'payment_date')::date,method=p_payload->>'method',reference=coalesce(nullif(trim(p_payload->>'reference'),''),reference),external_reference=case when p_payload ? 'reference' then nullif(trim(p_payload->>'reference'),'') else external_reference end,updated_at=now() where id=pid returning to_jsonb(payments) into result;
 perform set_config('um18.payment_correction','',true);
 insert into public.payment_metadata_history(payment_id,actor_id,reason,old_record,new_record) values(pid,actor,reason,old_record,result);
 when 'add_assessments' then
 select * into c from public.contribution_collections where id=pid for update;if not found or c.status<>'open' or c.participation<>'compulsory' then raise exception 'An open compulsory collection is required';end if;
 if length(reason)<2 or jsonb_array_length(coalesce(p_payload->'member_ids','[]'))=0 or nullif(p_payload->>'expected_kobo','') is null then raise exception 'Selected members, approved amount, effective date and reason required';end if;
 for v in select value from jsonb_array_elements(p_payload->'member_ids') loop mid=(v#>>'{}')::uuid;if not exists(select 1 from public.members where id=mid and archived_at is null) then raise exception 'Eligible member unavailable';end if;
 insert into public.member_assessments(member_id,collection_id,expected_kobo,effective_date,created_by,reason) values(mid,c.id,(p_payload->>'expected_kobo')::bigint,effective,actor,reason) returning * into a;
 insert into public.assessment_history(assessment_id,actor_id,new_expected_kobo,new_waiver_kobo,reason) values(a.id,actor,a.expected_kobo,0,reason);end loop;result=jsonb_build_object('collection_id',c.id,'added',jsonb_array_length(p_payload->'member_ids'));
 when 'save_welfare' then
 perform public.require_permission('welfare.read');aid=(p_payload->>'assigned_to')::uuid;if aid<>actor then perform public.require_permission('welfare.assign');end if;if not public.has_permission_for(aid,'welfare.read') or not public.has_permission_for(aid,'welfare.write') then raise exception 'Assigned officer must have current welfare read and write access';end if;
 if nullif(p_payload->>'expense_id','') is not null then perform public.require_permission('finance.read');end if;
 if pid is not null then select * into w from public.welfare_cases where id=pid and assigned_to=actor for update;if not found then raise exception 'Case outside current assignment' using errcode='42501';end if;old_record=to_jsonb(w);
 update public.welfare_cases set member_id=(p_payload->>'member_id')::uuid,category=p_payload->>'category',description=p_payload->>'description',status=p_payload->>'status',assigned_to=aid,opened_date=(p_payload->>'opened_date')::date,closed_date=nullif(p_payload->>'closed_date','')::date,actions=p_payload->>'actions',expense_id=case when p_payload ? 'expense_id' then nullif(p_payload->>'expense_id','')::uuid else expense_id end,updated_at=now() where id=pid returning * into w;
 else insert into public.welfare_cases(case_no,member_id,category,description,status,assigned_to,opened_date,closed_date,actions,expense_id,created_by) values(public.next_welfare_number(),(p_payload->>'member_id')::uuid,p_payload->>'category',p_payload->>'description',coalesce(p_payload->>'status','open'),aid,(p_payload->>'opened_date')::date,nullif(p_payload->>'closed_date','')::date,p_payload->>'actions',nullif(p_payload->>'expense_id','')::uuid,actor) returning * into w;end if;
 insert into public.welfare_history(case_id,actor_id,old_record,new_record) values(w.id,actor,old_record,to_jsonb(w));result=to_jsonb(w);pid=w.id;
 when 'reassign_welfare' then
 if length(reason)<2 then raise exception 'Assignment reason required';end if;aid=(p_payload->>'assigned_to')::uuid;
 if not public.has_permission_for(aid,'welfare.read') or not public.has_permission_for(aid,'welfare.write') then raise exception 'Assigned officer must have current welfare read and write access';end if;
 select jsonb_build_object('assigned_to',w.assigned_to) into old_record from public.welfare_cases w where id=pid for update;if not found then raise exception 'Case unavailable';end if;
 update public.welfare_cases set assigned_to=aid,updated_at=now() where id=pid;
 insert into public.welfare_history(case_id,actor_id,old_record,new_record) values(pid,actor,old_record,jsonb_build_object('assigned_to',aid,'reason',reason));
 result=jsonb_build_object('id',pid,'assigned_to',aid);perform public.log_action('welfare.reassigned','welfare',pid);
 when 'update_contact' then
 perform public.require_permission('members.write');if length(reason)<2 then raise exception 'Contact correction reason required';end if;
 select to_jsonb(t) into old_record from public.contact_history t where id=pid for update;if not found then raise exception 'Contact unavailable';end if;
 update public.contact_history set contact_date=(p_payload->>'contact_date')::date,channel=p_payload->>'channel',notes=p_payload->>'notes',outcome=nullif(p_payload->>'outcome',''),follow_up_date=nullif(p_payload->>'follow_up_date','')::date,follow_up_status=coalesce(p_payload->>'follow_up_status','scheduled'),updated_at=now() where id=pid returning to_jsonb(contact_history) into result;
 update public.members set last_contact_date=(select max(contact_date) from public.contact_history where member_id=(old_record->>'member_id')::uuid) where id=(old_record->>'member_id')::uuid;
 perform public.log_action('contact.corrected','contact',pid,jsonb_build_object('reason',reason,'before',old_record,'after',result));
 when 'update_document' then
 select * into doc from public.documents where id=pid for update;if not found or not public.can_access_document(doc.scope,doc.target_id,true) then raise exception 'Document update denied' using errcode='42501';end if;
 if length(reason)<2 or length(coalesce(p_payload->>'title',doc.title)) not between 1 and 180 then raise exception 'Title and change reason required';end if;
 update public.documents set title=coalesce(p_payload->>'title',title),category=coalesce(nullif(p_payload->>'category',''),category),description=case when p_payload ? 'description' then p_payload->>'description' else description end,archived_at=case when p_payload->>'archive'='true' then now() when p_payload->>'archive'='false' then null else archived_at end,archive_reason=case when p_payload ? 'archive' then reason else archive_reason end where id=pid returning to_jsonb(documents) into result;
 else
 if p_action='record_payment' and nullif(p_payload->>'reference','') is not null then
 select * into p from public.payments where lower(external_reference)=lower(trim(p_payload->>'reference')) and method='bank_transfer' and status in ('reversed','rejected') order by created_at desc limit 1 for update;
 if found and nullif(p_payload->>'replaces_payment_id','')::uuid is distinct from p.id then raise exception 'Reference belongs to a preserved transaction. Use its explicit replacement action.';end if;
 end if;
 result=public.execute_action_v1(p_action,p_payload,p_key);
 if p_action='record_payment' and nullif(p_payload->>'replaces_payment_id','') is not null then
 target=(p_payload->>'replaces_payment_id')::uuid;select * into p from public.payments where id=target for update;if not found or p.status not in ('reversed','rejected') then raise exception 'Only a reversed or rejected record can be replaced';end if;
 update public.payments set replaces_payment_id=target where id=(result->>'id')::uuid returning to_jsonb(payments) into result;
 end if;
 if p_action='record_payment' then update public.allocation_history set operation_key=p_key,movement_kind='receipt_allocation',effective_date=(p_payload->>'payment_date')::date where payment_id=(result->>'id')::uuid;end if;
 if p_action='adjust_payment' then update public.financial_adjustments set effective_date=effective,operation_key=p_key where id=(select id from public.financial_adjustments where payment_id=pid and operation_key is null order by created_at desc,id desc limit 1);end if;
 if p_action='transition_payment' and p_payload->>'status'='reversed' then insert into public.allocation_history(payment_id,old_allocations,new_allocations,actor_id,reason,effective_date,movement_kind,operation_key) values(pid,old_rows,'[]',actor,reason,effective,'reversal',p_key);end if;
 if p_action='save_contact' then update public.contact_history set outcome=nullif(p_payload->>'outcome',''),follow_up_date=nullif(p_payload->>'follow_up_date','')::date,follow_up_status=coalesce(p_payload->>'follow_up_status','scheduled') where id=(result->>'id')::uuid returning to_jsonb(contact_history) into result;end if;
 if p_action='save_account' then
 if exists(select 1 from public.role_assignments where executive_id=pid and role_code='owner' and revoked_at is null) and (coalesce(p_payload->'denied_permissions','[]') ? 'accounts.write' or coalesce(p_payload->'denied_permissions','[]') ? 'directory.read') then raise exception 'An owner must retain account administration and directory access';end if;
 delete from public.permission_denials where executive_id=pid;
 for v in select value from jsonb_array_elements(coalesce(p_payload->'denied_permissions','[]')) loop insert into public.permission_denials(executive_id,permission,expires_at) values(pid,v#>>'{}',nullif(p_payload->>'expires_at','')::timestamptz);end loop;
 for v in select value from jsonb_array_elements(coalesce(p_payload->'role_schedule','[]')) loop update public.role_assignments set starts_at=coalesce(nullif(v->>'starts_at','')::timestamptz,starts_at),expires_at=nullif(v->>'expires_at','')::timestamptz where executive_id=pid and role_code=v->>'role_code' and revoked_at is null;end loop;
 perform public.log_action('permissions.configured','account',pid,jsonb_build_object('reason',reason,'denied_permissions',p_payload->'denied_permissions','role_schedule',p_payload->'role_schedule'));
 end if;
 end case;
 if p_action in ('allocate_payment','adjust_payment','transition_payment','correct_payment') then
 update public.payments set revision=revision+1,updated_at=now() where id=pid returning to_jsonb(payments) into result;
 -- Only the history created by this command is tagged; earlier snapshots remain unchanged.
 update public.allocation_history set operation_key=p_key,effective_date=effective,movement_kind=case when p_action='adjust_payment' then p_payload->>'kind' when p_action='correct_payment' then 'metadata_correction' else movement_kind end where payment_id=pid and operation_key is null and not (id=any(hist_ids));
 end if;
 if p_action in ('correct_payment','add_assessments','reassign_welfare','update_contact','update_document','import_link','import_update','import_create_reviewed','save_welfare') then
 perform public.log_action(p_action,case when p_action in ('reassign_welfare','save_welfare') then 'welfare' when p_action='update_document' then case when doc.scope='welfare' then 'welfare' else 'document' end else 'record' end,pid,jsonb_build_object('reason',reason));
 insert into public.command_receipts(actor_id,idempotency_key,request_hash,result) values(actor,p_key,hash,coalesce(result,'null'));
 else update public.command_receipts set result=coalesce(result,'null') where actor_id=actor and idempotency_key=p_key;end if;
 return result;
end;$$;
revoke execute on function public.execute_action(text,jsonb,uuid) from public,anon;
grant execute on function public.execute_action(text,jsonb,uuid) to authenticated;

-- History is fetched for the selected record, rather than copied into general directory views.
create function public.record_history(p_scope text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_scope='member' then perform public.require_permission('members.write');return (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') from public.member_history t where member_id=p_id);
 elsif p_scope='payment' then perform public.require_permission('finance.read');return jsonb_build_object('allocations',(select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') from public.allocation_history t where payment_id=p_id),'metadata',(select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') from public.payment_metadata_history t where payment_id=p_id));
 elsif p_scope='collection' then perform public.require_permission('finance.read');return jsonb_build_object('assessments',(select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc),'[]') from public.assessment_history h join public.member_assessments a on a.id=h.assessment_id where a.collection_id=p_id),'movements',(select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc),'[]') from public.allocation_history h where exists(select 1 from jsonb_array_elements(h.old_allocations||h.new_allocations) x where x->>'collection_id'=p_id::text)));
 elsif p_scope='welfare' then perform public.require_permission('welfare.read');if not exists(select 1 from public.welfare_cases where id=p_id and assigned_to=auth.uid()) then raise exception 'Assigned-case access required' using errcode='42501';end if;return (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') from public.welfare_history t where case_id=p_id);
 else raise exception 'Unsupported history scope';end if;
end;$$;
create function public.welfare_assignments() returns jsonb language plpgsql stable security definer set search_path='' as $$begin perform public.require_permission('welfare.assign');return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'case_no',case_no,'status',status,'assigned_to',assigned_to,'updated_at',updated_at)),'[]') from public.welfare_cases);end;$$;
create function public.search_members(p_query text default '',p_status text default '',p_country text default '',p_offset integer default 0,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin perform public.require_permission('directory.read');if p_offset<0 or p_limit not between 1 and 100 or length(p_query)>180 then raise exception 'Invalid search bounds';end if;
with matches as (select m.* from public.members m where not (m.merged_into_member_id is not null) and (p_status='' or membership_status=p_status) and (p_country='' or country=p_country) and (p_query='' or lower(concat_ws(' ',full_name,member_no,phone_original,phone_normalized,city,region,country,occupation,joined_year,array_to_string(skills,' '))) like '%'||lower(p_query)||'%'))
select jsonb_build_object('count',(select count(*) from matches),'rows',(select coalesce(jsonb_agg(to_jsonb(t)-array['details','internal_remarks','name_normalized','archive_reason']),'[]') from (select * from matches order by full_name,id limit p_limit offset p_offset)t)) into result;return result;end;$$;
revoke execute on function public.record_history(text,uuid),public.welfare_assignments(),public.search_members(text,text,text,integer,integer) from public,anon;
grant execute on function public.record_history(text,uuid),public.welfare_assignments(),public.search_members(text,text,text,integer,integer) to authenticated;

-- Expand account metadata only for authorised account administration; confidential histories use record_history.
alter function public.workspace_snapshot() rename to workspace_snapshot_v1;
create function public.workspace_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$declare d jsonb;begin d=public.workspace_snapshot_v1();
 if public.has_permission('accounts.write') then d=jsonb_set(d,'{accounts}',(select coalesce(jsonb_agg(x||jsonb_build_object('denied_permissions',(select coalesce(jsonb_agg(permission),'[]') from public.permission_denials where executive_id=(x->>'id')::uuid and (expires_at is null or expires_at>now())),'role_history',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') from public.role_assignments r where executive_id=(x->>'id')::uuid))),'[]') from jsonb_array_elements(d->'accounts')x));end if;return d;end;$$;
revoke execute on function public.workspace_snapshot_v1(),public.workspace_snapshot() from public,anon,authenticated;
grant execute on function public.workspace_snapshot() to authenticated;
commit;
