-- Production audit corrections. Preserve existing receipts, versions and history.
begin;

alter table public.payments add column receipt_root_id uuid references public.payments;
with recursive lineage as (
 select id,id as root from public.payments where replaces_payment_id is null
 union all select p.id,l.root from public.payments p join lineage l on p.replaces_payment_id=l.id
) update public.payments p set receipt_root_id=l.root from lineage l where p.id=l.id;
do $$begin
 if exists(select 1 from public.payments where receipt_root_id is null) then raise exception 'Receipt lineage is incomplete. Review preserved records before migration';end if;
 if exists(select 1 from public.payments where status in ('pending','confirmed') group by receipt_root_id having count(*)>1) then raise exception 'Multiple active receipts share a lineage. Review preserved records before migration';end if;
 if exists(select 1 from public.payments where replaces_payment_id is not null group by replaces_payment_id having count(*)>1) then raise exception 'Receipt replacement history branches. Review preserved records before migration';end if;
 if exists(select 1 from public.documents where previous_version_id is not null group by previous_version_id having count(*)>1) then raise exception 'Document version history branches. Review preserved records before migration';end if;
end;$$;
-- The backfill queues deferred financial invariant checks on existing rows.
set constraints all immediate;
alter table public.payments alter column receipt_root_id set not null;
create unique index one_active_receipt_lineage on public.payments(receipt_root_id) where status in ('pending','confirmed');
create unique index one_preserved_receipt_successor on public.payments(replaces_payment_id) where replaces_payment_id is not null;
create unique index one_document_successor on public.documents(previous_version_id) where previous_version_id is not null;

create function public.guard_receipt_lineage() returns trigger language plpgsql security definer set search_path='' as $$
declare parent public.payments;begin
 if tg_op='UPDATE' then
  if (new.receipt_root_id,new.replaces_payment_id) is distinct from (old.receipt_root_id,old.replaces_payment_id) then raise exception 'Receipt lineage is immutable';end if;
 else
  if new.replaces_payment_id is null then new.receipt_root_id=new.id;
  else
   select * into parent from public.payments where id=new.replaces_payment_id;
   if not found or parent.status not in ('reversed','rejected') then raise exception 'Only a reversed or rejected receipt can be replaced';end if;
   new.receipt_root_id=parent.receipt_root_id;
  end if;
 end if;
 -- Unique indexes serialize conflicting successors and active lineage leaves.
 if tg_op='INSERT' and new.replaces_payment_id is not null and exists(select 1 from public.payments where replaces_payment_id=new.replaces_payment_id) then raise exception 'Replace the latest receipt; this preserved record already has a replacement';end if;
 return new;
end;$$;
create trigger receipt_lineage_valid before insert or update on public.payments for each row execute function public.guard_receipt_lineage();
revoke execute on function public.guard_receipt_lineage() from public,anon,authenticated,service_role;

create or replace function public.commit_document_v2(p_meta jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.documents;prior public.documents;scope text=p_meta->>'scope';target uuid=nullif(p_meta->>'target_id','')::uuid;path text=p_meta->>'path';previous uuid=nullif(p_meta->>'previous_version_id','')::uuid;category text=coalesce(p_meta->>'category','supporting');
begin
 if not public.can_access_document(scope,target,true) then raise exception 'Document upload denied' using errcode='42501';end if;
 if left(path,length(auth.uid()::text||'/'||scope||'/'||coalesce(target::text,'general')||'/'))<>auth.uid()::text||'/'||scope||'/'||coalesce(target::text,'general')||'/' then raise exception 'Document path does not match the permitted record' using errcode='42501';end if;
 if category not in ('approval','announcement','minutes','budget','invoice','payment_evidence','acknowledgement','spending_receipt','final_report','supporting') or length(p_meta->>'title') not between 1 and 180 or length(coalesce(p_meta->>'description',''))>1500 or (p_meta->>'byte_size')::integer>(select document_limit_mb*1048576 from public.private_settings where id) or not exists(select 1 from storage.objects where bucket_id='private-documents' and name=path) then raise exception 'Invalid stored document';end if;
 perform pg_advisory_xact_lock(hashtextextended(path,0));
 select * into d from public.documents where object_path=path;
 if found then if d.scope<>scope or d.target_id is distinct from target or d.uploaded_by<>auth.uid() or d.previous_version_id is distinct from previous then raise exception 'Document retry target mismatch';end if;return to_jsonb(d);end if;
 if previous is not null then
  select * into prior from public.documents where id=previous for update;
  if not found or prior.scope<>scope or prior.target_id is distinct from target or not public.can_access_document(prior.scope,prior.target_id,true) then raise exception 'Version target mismatch' using errcode='42501';end if;
  if prior.archived_at is not null or exists(select 1 from public.documents where previous_version_id=prior.id) then raise exception 'Document changed. Refresh and replace its current version' using errcode='40001';end if;
 end if;
 insert into public.documents(title,scope,target_id,object_path,mime_type,byte_size,uploaded_by,category,description,version,previous_version_id) values(p_meta->>'title',scope,target,path,p_meta->>'mime_type',(p_meta->>'byte_size')::integer,auth.uid(),category,p_meta->>'description',case when previous is null then 1 else prior.version+1 end,previous) returning * into d;
 if previous is not null then update public.documents set archived_at=now(),archive_reason='Preserved previous version of '||d.id::text where id=previous;end if;
 perform public.log_action('document.attached',case when scope='welfare' then 'welfare' else 'document' end,d.id,jsonb_build_object('scope',scope,'category',category,'version',d.version));return to_jsonb(d);
end;$$;
revoke execute on function public.commit_document_v2(jsonb) from public,anon;
grant execute on function public.commit_document_v2(jsonb) to authenticated;

alter function public.execute_action(text,jsonb,uuid) rename to execute_action_v6;
revoke execute on function public.execute_action_v6(text,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.execute_action(p_action text,p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid=auth.uid();pid uuid;receipt public.command_receipts;hash text;reason text;old_record jsonb;result jsonb;
begin
 if p_action<>'update_contact' then return public.execute_action_v6(p_action,p_payload,p_key);end if;
 perform public.require_permission('contacts.write');
 if actor is null or p_key is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>65536 then raise exception 'Invalid authenticated operation' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_key::text,0));hash=md5(p_action||p_payload::text);
 select * into receipt from public.command_receipts where actor_id=actor and idempotency_key=p_key;
 if found then if receipt.request_hash<>hash then raise exception 'Retry key reused with different contents';end if;return receipt.result;end if;
 pid=nullif(p_payload->>'id','')::uuid;reason=trim(coalesce(p_payload->>'reason',''));if length(reason)<2 then raise exception 'Contact correction reason required';end if;
 select to_jsonb(t) into old_record from public.contact_history t where id=pid for update;if not found then raise exception 'Contact unavailable';end if;
 update public.contact_history set contact_date=(p_payload->>'contact_date')::date,channel=p_payload->>'channel',notes=p_payload->>'notes',outcome=nullif(p_payload->>'outcome',''),follow_up_date=nullif(p_payload->>'follow_up_date','')::date,follow_up_status=coalesce(p_payload->>'follow_up_status','scheduled'),updated_at=now() where id=pid returning to_jsonb(contact_history) into result;
 update public.members set last_contact_date=(select max(contact_date) from public.contact_history where member_id=(old_record->>'member_id')::uuid) where id=(old_record->>'member_id')::uuid;
 perform public.log_action('contact.corrected','contact',pid,jsonb_build_object('reason',reason,'before',old_record,'after',result));
 insert into public.command_receipts(actor_id,idempotency_key,request_hash,result) values(actor,p_key,hash,result);return result;
end;$$;
revoke execute on function public.execute_action(text,jsonb,uuid) from public,anon;
grant execute on function public.execute_action(text,jsonb,uuid) to authenticated;

alter function public.workspace_data(text,uuid) rename to workspace_data_v4;
revoke execute on function public.workspace_data_v4(text,uuid) from public,anon,authenticated,service_role;
create function public.workspace_data(p_area text,p_target uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d jsonb;begin
 d=public.workspace_data_v4(case when p_area='office-reports' then 'overview' else p_area end,p_target);
 if public.has_permission('finance.read') then
  d=jsonb_set(d,'{payments}',(select coalesce(jsonb_agg(entry||jsonb_build_object('replacement_available',entry->>'status' in ('reversed','rejected') and not exists(select 1 from public.payments child where child.replaces_payment_id=(entry->>'id')::uuid),'replacement_id',(select child.id from public.payments child where child.replaces_payment_id=(entry->>'id')::uuid))),'[]') from jsonb_array_elements(d->'payments')entry));
  if p_area='audit' then d=jsonb_set(d,'{audit}',(select coalesce(jsonb_agg(entry||case when entry->>'target_type'='assessment' or entry->>'action' like '%assessment%' then jsonb_build_object('assessment_collection_id',coalesce((select a.collection_id from public.member_assessments a where a.id=(entry->>'target_id')::uuid),case when entry->>'target_type'='collection' then (entry->>'target_id')::uuid end)) else '{}'::jsonb end),'[]') from jsonb_array_elements(d->'audit')entry));end if;
 end if;
 return d;
end;$$;
revoke execute on function public.workspace_data(text,uuid) from public,anon;
grant execute on function public.workspace_data(text,uuid) to authenticated;
commit;
