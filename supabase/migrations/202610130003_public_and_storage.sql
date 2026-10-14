begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('branding','branding',true,2097152,array['image/png','image/jpeg','image/webp']),('private-documents','private-documents',false,3145728,array['image/png','image/jpeg','image/webp','application/pdf']) on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- Bucket publicity is intentional for logos; receipts and case documents are never in it.
create policy um18_private_document_read on storage.objects for select to authenticated using(bucket_id='private-documents' and exists(select 1 from public.documents d where d.object_path=name and public.can_access_document(d.scope,d.target_id)));
-- Only the server's Storage API can upload. There are no anonymous or authenticated upload policies.
create function public.consume_registration_rate(p_hash text) returns boolean language plpgsql security definer set search_path='' as $$
 declare n integer;begin if auth.role()<>'service_role' then raise exception 'Server only' using errcode='42501';end if;if length(p_hash)<>64 then raise exception 'Invalid rate key';end if;
 insert into public.registration_rate_limits(key_hash,window_start,count) values(p_hash,date_trunc('hour',now()),1) on conflict(key_hash,window_start) do update set count=public.registration_rate_limits.count+1 returning count into n;
 delete from public.registration_rate_limits where window_start<now()-interval '48 hours';return n<=10;end;
$$;
create function public.submit_registration(p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
 declare s public.membership_submissions;matches uuid[];allowed text[]=array['full_name','former_name','phone','phone_original','phone_normalized','whatsapp','whatsapp_normalized','email','city','region','country','gender','birthday_day','birthday_month','birth_year','address','socials','joined_year','qualification','qualification_other','course','institution','occupation','occupation_other','business_name','business_sector','business_description','skills','emergency_name','emergency_relationship','emergency_phone','emergency_phone_normalized','emergency_permission','message','acknowledgement','name_normalized'];
 begin if auth.role()<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 if jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>24000 or (p_payload-allowed)<>'{}'::jsonb then raise exception 'Invalid registration fields';end if;
 if coalesce((p_payload->>'acknowledgement')::boolean,false) is not true or length(coalesce(p_payload->>'full_name',''))<2 or length(coalesce(p_payload->>'city',''))<2 or length(coalesce(p_payload->>'country',''))<2 or p_payload->>'phone_normalized' is null or p_payload->>'phone_normalized'<>public.normalise_phone(p_payload->>'phone_original') then raise exception 'Invalid required details';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));select * into s from public.membership_submissions where idempotency_key=p_key;
 if found then if s.payload_hash<>md5(p_payload::text) then raise exception 'Submission retry changed';end if;return jsonb_build_object('reference',s.reference,'message','Submission received for executive review');end if;
 select coalesce(array_agg(id),'{}') into matches from public.members where phone_normalized=p_payload->>'phone_normalized' or name_normalized=lower(regexp_replace(trim(p_payload->>'full_name'),'[^[:alnum:]]+',' ','g')) or (p_payload->>'email' is not null and lower(email)=lower(p_payload->>'email'));
 insert into public.membership_submissions(idempotency_key,payload_hash,payload,possible_duplicate_ids) values(p_key,md5(p_payload::text),p_payload,matches) returning * into s;
 return jsonb_build_object('reference',s.reference,'message','Submission received for executive review');end;
$$;
create function public.document_access(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare d public.documents;begin select * into d from public.documents where id=p_id;if not found or not public.can_access_document(d.scope,d.target_id) then raise exception 'Document unavailable' using errcode='42501';end if;return to_jsonb(d);end;$$;
create function public.commit_document(p_title text,p_scope text,p_target uuid,p_path text,p_mime text,p_size integer) returns jsonb language plpgsql security definer set search_path='' as $$declare d public.documents;begin
 if not public.can_access_document(p_scope,p_target,true) then raise exception 'Document upload denied' using errcode='42501';end if;
 if length(p_title)>180 or p_size>(select document_limit_mb*1048576 from public.private_settings where id) or not exists(select 1 from storage.objects where bucket_id='private-documents' and name=p_path) then raise exception 'Invalid stored document';end if;
 insert into public.documents(title,scope,target_id,object_path,mime_type,byte_size,uploaded_by) values(p_title,p_scope,p_target,p_path,p_mime,p_size,auth.uid()) returning * into d;perform public.log_action('document.attached',case when p_scope='welfare' then 'welfare' else 'document' end,d.id,jsonb_build_object('scope',p_scope));return to_jsonb(d);end;$$;
create function public.bootstrap_owner(p_id uuid,p_name text,p_email text) returns jsonb language plpgsql security definer set search_path='' as $$declare a public.executive_accounts;begin
 if auth.role()<>'service_role' then raise exception 'Server only' using errcode='42501';end if;perform pg_advisory_xact_lock(18018);
 if exists(select 1 from public.role_assignments where role_code='owner' and revoked_at is null) then raise exception 'Owner bootstrap is already complete';end if;
 insert into public.executive_accounts(id,display_name,email) values(p_id,p_name,p_email) returning * into a;insert into public.role_assignments(executive_id,role_code) values(a.id,'owner');
 insert into public.audit_events(actor_id,action,target_type,target_id,changes) values(a.id,'owner.bootstrap','account',a.id,jsonb_build_object('association_controlled',true));return to_jsonb(a);end;
$$;
create function public.provision_invited_account(p_actor uuid,p_id uuid,p_name text,p_email text,p_roles jsonb,p_permissions jsonb,p_expires timestamptz,p_member uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$declare a public.executive_accounts;v jsonb;begin
 if auth.role()<>'service_role' or not public.has_permission_for(p_actor,'accounts.write') then raise exception 'Invitation provisioning denied' using errcode='42501';end if;perform pg_advisory_xact_lock(18018);
 if length(trim(coalesce(p_reason,'')))<2 or jsonb_array_length(p_roles)=0 then raise exception 'Roles and access reason required';end if;
 insert into public.executive_accounts(id,display_name,email,member_id) values(p_id,p_name,p_email,p_member) returning * into a;
 for v in select value from jsonb_array_elements(p_roles) loop insert into public.role_assignments(executive_id,role_code,expires_at,assigned_by) values(a.id,v#>>'{}',p_expires,p_actor);end loop;
 for v in select value from jsonb_array_elements(coalesce(p_permissions,'[]')) loop insert into public.explicit_permissions(executive_id,permission,expires_at) values(a.id,v#>>'{}',p_expires);end loop;
 insert into public.audit_events(actor_id,action,target_type,target_id,changes) values(p_actor,'executive.invited','account',a.id,jsonb_build_object('reason',p_reason,'roles',p_roles,'extra_permissions',p_permissions));return to_jsonb(a);end;
$$;
revoke execute on function public.consume_registration_rate(text),public.submit_registration(jsonb,uuid),public.document_access(uuid),public.commit_document(text,text,uuid,text,text,integer),public.bootstrap_owner(uuid,text,text),public.provision_invited_account(uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text) from public,anon,authenticated;
grant execute on function public.consume_registration_rate(text),public.submit_registration(jsonb,uuid),public.bootstrap_owner(uuid,text,text),public.provision_invited_account(uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid,text) to service_role;
grant execute on function public.document_access(uuid),public.commit_document(text,text,uuid,text,text,integer) to authenticated;
commit;
