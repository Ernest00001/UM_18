begin;
-- Object paths bind a server-uploaded file to its actor, scope and target. A client cannot
-- turn a previously accessible private receipt into a generally accessible document.
revoke execute on function public.commit_document(text,text,uuid,text,text,integer) from authenticated;
create function public.commit_document_v2(p_meta jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.documents;prior public.documents;scope text=p_meta->>'scope';target uuid=nullif(p_meta->>'target_id','')::uuid;path text=p_meta->>'path';previous uuid=nullif(p_meta->>'previous_version_id','')::uuid;category text=coalesce(p_meta->>'category','supporting');
begin
 if not public.can_access_document(scope,target,true) then raise exception 'Document upload denied' using errcode='42501';end if;
 if left(path,length(auth.uid()::text||'/'||scope||'/'||coalesce(target::text,'general')||'/'))<>auth.uid()::text||'/'||scope||'/'||coalesce(target::text,'general')||'/' then raise exception 'Document path does not match the permitted record' using errcode='42501';end if;
 if category not in ('approval','announcement','minutes','budget','invoice','payment_evidence','acknowledgement','spending_receipt','final_report','supporting') or length(p_meta->>'title') not between 1 and 180 or length(coalesce(p_meta->>'description',''))>1500 or (p_meta->>'byte_size')::integer>(select document_limit_mb*1048576 from public.private_settings where id) or not exists(select 1 from storage.objects where bucket_id='private-documents' and name=path) then raise exception 'Invalid stored document';end if;
 perform pg_advisory_xact_lock(hashtextextended(path,0));
 select * into d from public.documents where object_path=path;
 if found then if d.scope<>scope or d.target_id is distinct from target or d.uploaded_by<>auth.uid() or d.previous_version_id is distinct from previous then raise exception 'Document retry target mismatch';end if;return to_jsonb(d);end if;
 if previous is not null then select * into prior from public.documents where id=previous for update;if not found or prior.scope<>scope or prior.target_id is distinct from target or not public.can_access_document(prior.scope,prior.target_id,true) then raise exception 'Version target mismatch' using errcode='42501';end if;end if;
 insert into public.documents(title,scope,target_id,object_path,mime_type,byte_size,uploaded_by,category,description,version,previous_version_id) values(p_meta->>'title',scope,target,path,p_meta->>'mime_type',(p_meta->>'byte_size')::integer,auth.uid(),category,p_meta->>'description',case when previous is null then 1 else prior.version+1 end,previous) returning * into d;
 if previous is not null then update public.documents set archived_at=now(),archive_reason='Preserved previous version of '||d.id::text where id=previous;end if;
 perform public.log_action('document.attached',case when scope='welfare' then 'welfare' else 'document' end,d.id,jsonb_build_object('scope',scope,'category',category,'version',d.version));return to_jsonb(d);
end;$$;
revoke execute on function public.commit_document_v2(jsonb) from public,anon;
grant execute on function public.commit_document_v2(jsonb) to authenticated;

create table public.account_recovery_operations(id uuid primary key default gen_random_uuid(),actor_id uuid not null references public.executive_accounts,target_id uuid not null references public.executive_accounts,idempotency_key uuid not null,reason text not null,state text not null default 'pending' check(state in ('pending','completed','failed')),lease_id uuid not null,lease_until timestamptz not null,details jsonb not null default '{}',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(actor_id,idempotency_key));
alter table public.account_recovery_operations enable row level security;
revoke all on public.account_recovery_operations from anon,authenticated;
create policy recovery_audited_read on public.account_recovery_operations for select to authenticated using(public.has_permission('accounts.mfa_reset'));
grant select on public.account_recovery_operations to authenticated;
create function public.begin_account_recovery(p_target uuid,p_key uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.account_recovery_operations;lease uuid=gen_random_uuid();begin
 perform public.require_permission('accounts.mfa_reset');if p_target=auth.uid() or p_key is null or length(trim(coalesce(p_reason,''))) not between 2 and 1500 then raise exception 'Use another authorised owner and provide a recovery reason';end if;
 perform pg_advisory_xact_lock(hashtextextended('mfa:'||p_target::text,0));
 if not exists(select 1 from public.executive_accounts where id=p_target) then raise exception 'Executive unavailable';end if;
 select * into op from public.account_recovery_operations where actor_id=auth.uid() and idempotency_key=p_key for update;
 if found then
 if op.target_id<>p_target or op.reason<>trim(p_reason) then raise exception 'Recovery retry changed';end if;
 if op.state='completed' then return jsonb_build_object('id',op.id,'completed',true);end if;
 if op.state='pending' and op.lease_until>now() then raise exception 'This recovery is already being processed';end if;
 update public.account_recovery_operations set state='pending',lease_id=lease,lease_until=now()+interval '2 minutes',updated_at=now() where id=op.id returning * into op;
 else
 if exists(select 1 from public.account_recovery_operations where target_id=p_target and state='pending' and lease_until>now()) then raise exception 'Another recovery is in progress';end if;
 insert into public.account_recovery_operations(actor_id,target_id,idempotency_key,reason,lease_id,lease_until) values(auth.uid(),p_target,p_key,trim(p_reason),lease,now()+interval '2 minutes') returning * into op;
 end if;
 update public.executive_accounts set mfa_recovery_pending=true,auth_valid_after=now(),updated_at=now() where id=p_target;
 perform public.log_action('mfa.recovery.requested','account',p_target,jsonb_build_object('operation_id',op.id,'reason',p_reason));
 return jsonb_build_object('id',op.id,'lease_id',op.lease_id,'completed',false);
end;$$;
create function public.finish_account_recovery(p_actor uuid,p_id uuid,p_lease uuid,p_completed boolean,p_details jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.account_recovery_operations;begin if auth.role()<>'service_role' or not public.has_permission_for(p_actor,'accounts.mfa_reset') then raise exception 'Recovery completion denied' using errcode='42501';end if;
 select * into op from public.account_recovery_operations where id=p_id and actor_id=p_actor and lease_id=p_lease for update;if not found then raise exception 'Recovery operation unavailable';end if;
 if op.state='completed' then return jsonb_build_object('completed',true);end if;
 if octet_length(p_details::text)>8000 then raise exception 'Recovery outcome too large';end if;
 update public.account_recovery_operations set state=case when p_completed then 'completed' else 'failed' end,details=p_details,updated_at=now() where id=p_id;
 if p_completed then update public.executive_accounts set mfa_recovery_pending=false,auth_valid_after=now(),updated_at=now() where id=op.target_id;end if;
 insert into public.audit_events(actor_id,action,target_type,target_id,changes) values(p_actor,case when p_completed then 'mfa.recovery.completed' else 'mfa.recovery.failed' end,'account',op.target_id,jsonb_build_object('operation_id',op.id,'reason',op.reason,'details',p_details));return jsonb_build_object('completed',p_completed);
end;$$;
revoke execute on function public.begin_account_recovery(uuid,uuid,text),public.finish_account_recovery(uuid,uuid,uuid,boolean,jsonb) from public,anon;
grant execute on function public.begin_account_recovery(uuid,uuid,text) to authenticated;
revoke execute on function public.finish_account_recovery(uuid,uuid,uuid,boolean,jsonb) from authenticated;
grant execute on function public.finish_account_recovery(uuid,uuid,uuid,boolean,jsonb) to service_role;
commit;
