begin;
create function public.next_member_number() returns text language plpgsql set search_path='' as $$declare n text;begin n=nextval('public.member_number_seq')::text;return 'SET2018-'||lpad(n,greatest(3,length(n)),'0');end;$$;
create function public.next_welfare_number() returns text language plpgsql set search_path='' as $$declare n text;begin n=nextval('public.welfare_number_seq')::text;return 'WEL-'||lpad(n,greatest(5,length(n)),'0');end;$$;
create function public.normalise_phone(p text) returns text language plpgsql immutable set search_path='' as $$declare n text;begin n=regexp_replace(trim(p),'[[:space:]().-]','','g');if left(n,2)='00' then n='+'||substr(n,3);end if;if n ~ '^0[0-9]{10}$' then n='+234'||substr(n,2);end if;if n !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Invalid phone number';end if;return n;end;$$;
create function public.member_write(p jsonb,p_actor uuid) returns public.members language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
 declare m public.members;oldrow jsonb;mid uuid;skills_array text[];details jsonb;reason text;
 begin reason=trim(coalesce(p->>'reason',''));if length(reason)<2 then raise exception 'A correction or migration reason is required';end if;
 if length(trim(coalesce(p->>'full_name','')))<2 or length(trim(coalesce(p->>'city','')))<2 or length(trim(coalesce(p->>'country','')))<2 then raise exception 'Name, city, and country are required';end if;
 if p->>'email' is not null and p->>'email'<>'' and p->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email';end if;
 select coalesce(array_agg(value),'{}') into skills_array from jsonb_array_elements_text(coalesce(p->'skills','[]'));if exists(select 1 from unnest(skills_array) s where length(s)>80) then raise exception 'Skill too long';end if;
 details=coalesce(p->'details','{}');if details->>'whatsapp' is not null and details->>'whatsapp'<>'' then details=jsonb_set(details,'{whatsapp_normalized}',to_jsonb(public.normalise_phone(details->>'whatsapp')));end if;
 if details->>'emergency_phone' is not null and details->>'emergency_phone'<>'' then details=jsonb_set(details,'{emergency_phone_normalized}',to_jsonb(public.normalise_phone(details->>'emergency_phone')));end if;
 mid=nullif(p->>'id','')::uuid;
 if mid is not null then select to_jsonb(t) into oldrow from public.members t where id=mid for update;if not found then raise exception 'Member not found';end if;
 update public.members set full_name=trim(p->>'full_name'),name_normalized=lower(regexp_replace(trim(p->>'full_name'),'[^[:alnum:]]+',' ','g')),phone_original=p->>'phone_original',phone_normalized=public.normalise_phone(p->>'phone_original'),email=nullif(p->>'email',''),city=trim(p->>'city'),country=trim(p->>'country'),region=nullif(p->>'region',''),occupation=nullif(p->>'occupation',''),joined_year=nullif(p->>'joined_year','')::smallint,skills=skills_array,details=details,membership_status=coalesce(p->>'membership_status','active'),internal_remarks=p->>'internal_remarks',updated_at=now() where id=mid returning * into m;
 else insert into public.members(member_no,full_name,name_normalized,phone_original,phone_normalized,email,city,country,region,occupation,joined_year,skills,details,membership_status,internal_remarks,verified_by) values(public.next_member_number(),trim(p->>'full_name'),lower(regexp_replace(trim(p->>'full_name'),'[^[:alnum:]]+',' ','g')),p->>'phone_original',public.normalise_phone(p->>'phone_original'),nullif(p->>'email',''),trim(p->>'city'),trim(p->>'country'),nullif(p->>'region',''),nullif(p->>'occupation',''),nullif(p->>'joined_year','')::smallint,skills_array,details,coalesce(p->>'membership_status','active'),p->>'internal_remarks',p_actor) returning * into m;end if;
 insert into public.member_history(member_id,actor_id,reason,old_record,new_record) values(m.id,p_actor,reason,oldrow,to_jsonb(m));return m;end;
$$;
create function public.replace_allocations(p_id uuid,p_rows jsonb,p_reason text) returns void language plpgsql security definer set search_path='' as $$
 declare p public.payments;a jsonb;c public.contribution_collections;sum_amount bigint=0;before_rows jsonb;after_rows jsonb;
 begin select * into p from public.payments where id=p_id for update;if not found or p.status<>'confirmed' then raise exception 'A confirmed payment is required';end if;if length(trim(coalesce(p_reason,'')))<2 then raise exception 'An allocation reason is required';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 then raise exception 'Invalid allocation list';end if;
 for a in select value from jsonb_array_elements(p_rows) loop
 if a->>'member_id' is not null and (a->>'member_id')::uuid<>p.member_id then raise exception 'Allocation member mismatch';end if;
 select * into c from public.contribution_collections where id=(a->>'collection_id')::uuid;if not found or c.status='draft' then raise exception 'Invalid or unpublished collection';end if;
 if (a->>'amount_kobo')::bigint<=0 then raise exception 'Allocation amount must be positive';end if;
 if c.participation='compulsory' and not exists(select 1 from public.member_assessments where collection_id=c.id and member_id=p.member_id) then raise exception 'Member has no approved assessment';end if;sum_amount=sum_amount+(a->>'amount_kobo')::bigint;end loop;
 if sum_amount>public.net_payment(p.id) then raise exception 'Allocations exceed available confirmed funds';end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into before_rows from public.payment_allocations t where payment_id=p.id;
 delete from public.payment_allocations where payment_id=p.id;
 insert into public.payment_allocations(payment_id,member_id,collection_id,amount_kobo,created_by) select p.id,p.member_id,(entry.value->>'collection_id')::uuid,(entry.value->>'amount_kobo')::bigint,auth.uid() from jsonb_array_elements(p_rows) as entry(value);
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into after_rows from public.payment_allocations t where payment_id=p.id;
 insert into public.allocation_history(payment_id,old_allocations,new_allocations,actor_id,reason) values(p.id,before_rows,after_rows,auth.uid(),p_reason);end;
$$;
create table public.welfare_history(id uuid primary key default gen_random_uuid(),case_id uuid not null references public.welfare_cases,actor_id uuid references public.executive_accounts,old_record jsonb,new_record jsonb,created_at timestamptz not null default now());
alter table public.welfare_history enable row level security;
revoke all on public.welfare_history from anon,authenticated;
create policy assigned_welfare_history on public.welfare_history for select to authenticated using(public.has_permission('welfare.read') and exists(select 1 from public.welfare_cases c where c.id=case_id and c.assigned_to=auth.uid()));
grant select on public.welfare_history to authenticated;

create function public.execute_action(p_action text,p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
 declare actor uuid=auth.uid();required_perm text;receipt public.command_receipts;request_hash text;result jsonb='true';pid uuid;mid uuid;aid uuid;reason text;old_record jsonb;v jsonb;
 m public.members;s public.membership_submissions;c public.contribution_collections;a public.member_assessments;p public.payments;e public.expenses;w public.welfare_cases;account public.executive_accounts;
 begin
 if actor is null then raise exception 'Authentication required' using errcode='42501';end if;
 required_perm=case
 when p_action in ('approve_submission','reject_submission') then 'registrations.review'
 when p_action in ('save_member','archive_member','merge_members') then 'members.write'
 when p_action='import_member' then 'members.import'
 when p_action in ('save_collection','publish_collection','close_collection','adjust_assessment','record_payment','transition_payment','allocate_payment','adjust_payment','save_expense','transition_expense') then 'finance.write'
 when p_action='save_contact' then 'contacts.write'
 when p_action in ('save_event','record_attendance') then 'events.write'
 when p_action='save_welfare' then 'welfare.write'
 when p_action in ('save_branding','save_settings') then 'settings.write'
 when p_action='save_account' then 'accounts.write'
 when p_action='export_audit' then case p_payload->>'scope' when 'finance' then 'finance.export' when 'welfare' then 'welfare.export' when 'directory' then 'directory.export' else 'INVALID' end
 else 'INVALID' end;
 perform public.require_permission(required_perm);
 if p_key is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536 then raise exception 'Invalid operation payload';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_key::text,0));
 request_hash=md5(p_action||p_payload::text);
 select * into receipt from public.command_receipts where actor_id=actor and idempotency_key=p_key;
 if found then if receipt.request_hash<>request_hash then raise exception 'Retry key reused with different contents';end if;return receipt.result;end if;
 pid=nullif(p_payload->>'id','')::uuid;reason=trim(coalesce(p_payload->>'reason',''));
 case p_action
 when 'approve_submission' then
 select * into s from public.membership_submissions where id=pid for update;if not found or s.review_status<>'pending' then raise exception 'Registration is not pending';end if;if length(reason)<2 then raise exception 'Review reason is required';end if;
 mid=nullif(p_payload->>'link_member_id','')::uuid;
 if mid is not null then select * into m from public.members where id=mid and archived_at is null for update;if not found then raise exception 'Linked member not found';end if;update public.membership_submissions set review_status='linked',member_id=mid,reviewed_by=actor,reviewed_at=now(),reason=reason where id=s.id;
 else m=public.member_write(jsonb_build_object('full_name',s.payload->>'full_name','phone_original',s.payload->>'phone_original','email',s.payload->>'email','city',s.payload->>'city','region',s.payload->>'region','country',s.payload->>'country','occupation',s.payload->>'occupation','skills',coalesce(s.payload->'skills','[]'),'joined_year',s.payload->>'joined_year','details',s.payload,'reason',reason),actor);update public.membership_submissions set review_status='approved',member_id=m.id,reviewed_by=actor,reviewed_at=now(),reason=reason where id=s.id;end if;result=to_jsonb(m);
 when 'reject_submission' then
 if length(reason)<2 then raise exception 'Rejection reason required';end if;update public.membership_submissions set review_status='rejected',reviewed_by=actor,reviewed_at=now(),reason=reason where id=pid and review_status='pending' returning to_jsonb(membership_submissions) into result;if not found then raise exception 'Registration is not pending';end if;
 when 'save_member' then m=public.member_write(p_payload,actor);result=to_jsonb(m);
 when 'import_member' then
 perform public.require_permission('members.write');if exists(select 1 from public.members where phone_normalized=public.normalise_phone(p_payload->>'phone_original') or name_normalized=lower(regexp_replace(trim(p_payload->>'full_name'),'[^[:alnum:]]+',' ','g'))) then raise exception 'Possible existing member; resolve through review';end if;m=public.member_write(p_payload-'id',actor);result=to_jsonb(m);
 when 'archive_member' then
 if length(reason)<2 then raise exception 'Archive reason required';end if;select to_jsonb(t) into old_record from public.members t where id=pid for update;update public.members set archived_at=now(),archive_reason=reason,updated_at=now() where id=pid and archived_at is null returning to_jsonb(members) into result;if not found then raise exception 'Member unavailable or already archived';end if;insert into public.member_history(member_id,actor_id,reason,old_record,new_record) values(pid,actor,reason,old_record,result);
 when 'merge_members' then
 perform pg_advisory_xact_lock(18180);mid=(p_payload->>'target_id')::uuid;
 if pid=mid or length(reason)<2 or (p_payload->>'assessment_policy' is distinct from 'keep_target' or p_payload->>'attendance_policy' is distinct from 'keep_target') then raise exception 'Choose different records and explicitly preserve the target assessment on overlap';end if;
 perform id from public.members where id in (pid,mid) and archived_at is null order by id for update;
 if (select count(*) from public.members where id in (pid,mid) and archived_at is null)<>2 then raise exception 'Both merge records must be available';end if;
 if exists(select 1 from public.payments where member_id=pid) or exists(select 1 from public.member_assessments where member_id=pid) then perform public.require_permission('finance.write');end if;
 if exists(select 1 from public.welfare_cases where member_id=pid) then perform public.require_permission('welfare.write');if exists(select 1 from public.welfare_cases where member_id=pid and assigned_to<>actor) then raise exception 'Merge requires review by the assigned restricted case officer' using errcode='42501';end if;end if;
 select to_jsonb(t)||jsonb_build_object('preserved_attendance',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.event_attendance x where x.member_id=pid)) into old_record from public.members t where id=pid;
 -- Original source ID, source assessment snapshots, and all historical changes survive.
 for a in select * from public.member_assessments where member_id=pid and superseded_by is null for update loop
 select id into aid from public.member_assessments where member_id=mid and collection_id=a.collection_id and superseded_by is null;
 if found then update public.member_assessments set superseded_by=aid,reason=reason,updated_at=now() where id=a.id;insert into public.assessment_history(assessment_id,actor_id,old_expected_kobo,old_waiver_kobo,new_expected_kobo,new_waiver_kobo,reason) values(a.id,actor,a.expected_kobo,a.waiver_kobo,a.expected_kobo,a.waiver_kobo,'Superseded on controlled member merge: '||reason);
 else update public.member_assessments set member_id=mid,updated_at=now() where id=a.id;end if;end loop;
 perform id from public.payments where member_id=pid order by id for update;
 insert into public.allocation_history(payment_id,old_allocations,new_allocations,actor_id,reason) select p0.id,coalesce((select jsonb_agg(to_jsonb(x)) from public.payment_allocations x where x.payment_id=p0.id),'[]'),jsonb_build_array(jsonb_build_object('merge_target',mid)),actor,'Member merge: '||reason from public.payments p0 where p0.member_id=pid;
 perform set_config('um18.member_merge','yes',true);update public.payments set member_id=mid,updated_at=now() where member_id=pid;update public.payment_allocations set member_id=mid where member_id=pid;perform set_config('um18.member_merge','',true);
 update public.contact_history set member_id=mid where member_id=pid;update public.welfare_cases set member_id=mid,updated_at=now() where member_id=pid;
 -- Explicit keep-target policy: source attendance snapshots are preserved in member history.
 delete from public.event_attendance x where x.member_id=pid and exists(select 1 from public.event_attendance y where y.event_id=x.event_id and y.member_id=mid);
 update public.event_attendance set member_id=mid,updated_at=now() where member_id=pid;update public.documents set target_id=mid where scope='member' and target_id=pid;update public.executive_accounts set member_id=mid,updated_at=now() where member_id=pid;
 update public.members set merged_into_member_id=mid,archived_at=now(),archive_reason='Merged: '||reason,updated_at=now() where id=pid returning to_jsonb(members) into result;
 insert into public.member_history(member_id,actor_id,reason,old_record,new_record) values(pid,actor,'Controlled merge: '||reason,old_record,result);
 when 'save_collection' then
 if pid is not null then select * into c from public.contribution_collections where id=pid for update;if not found then raise exception 'Collection not found';end if;if c.status<>'draft' then if length(reason)<2 then raise exception 'Published changes require a reason';end if;if (c.category,c.period,c.participation) is distinct from (p_payload->>'category',p_payload->>'period',p_payload->>'participation') then raise exception 'Published collection category, period, and participation are immutable';end if;end if;
 update public.contribution_collections set title=p_payload->>'title',purpose=p_payload->>'purpose',category=p_payload->>'category',period=nullif(p_payload->>'period',''),participation=p_payload->>'participation',amount_kobo=nullif(p_payload->>'amount_kobo','')::bigint,target_kobo=nullif(p_payload->>'target_kobo','')::bigint,event_date=nullif(p_payload->>'event_date','')::date,deadline=nullif(p_payload->>'deadline','')::date,updated_at=now() where id=pid returning * into c;
 else insert into public.contribution_collections(title,purpose,category,period,participation,amount_kobo,target_kobo,event_date,deadline,created_by) values(p_payload->>'title',p_payload->>'purpose',p_payload->>'category',nullif(p_payload->>'period',''),p_payload->>'participation',nullif(p_payload->>'amount_kobo','')::bigint,nullif(p_payload->>'target_kobo','')::bigint,nullif(p_payload->>'event_date','')::date,nullif(p_payload->>'deadline','')::date,actor) returning * into c;end if;result=to_jsonb(c);pid=c.id;
 when 'publish_collection' then
 select * into c from public.contribution_collections where id=pid for update;if not found or c.status<>'draft' then raise exception 'Only a draft can be published';end if;if length(reason)<2 then raise exception 'Approval reason required';end if;
 if c.participation='compulsory' then if c.amount_kobo is null then raise exception 'An approved amount must be configured';end if;if jsonb_array_length(coalesce(p_payload->'member_ids','[]'))=0 then raise exception 'Select eligible members';end if;
 for v in select value from jsonb_array_elements(p_payload->'member_ids') loop mid=(v#>>'{}')::uuid;if not exists(select 1 from public.members where id=mid and archived_at is null) then raise exception 'Invalid eligible member';end if;insert into public.member_assessments(member_id,collection_id,expected_kobo,created_by,reason) values(mid,c.id,c.amount_kobo,actor,reason) returning * into a;insert into public.assessment_history(assessment_id,actor_id,new_expected_kobo,new_waiver_kobo,reason) values(a.id,actor,a.expected_kobo,0,reason);end loop;end if;
 update public.contribution_collections set status='open',published_at=now(),updated_at=now() where id=c.id returning to_jsonb(contribution_collections) into result;
 when 'close_collection' then
 if length(reason)<2 then raise exception 'Closing reason required';end if;update public.contribution_collections set status='closed',closed_at=now(),updated_at=now() where id=pid and status='open' returning to_jsonb(contribution_collections) into result;if not found then raise exception 'Only open collections can be closed';end if;
 when 'adjust_assessment' then
 if length(reason)<2 then raise exception 'Assessment change reason required';end if;select * into a from public.member_assessments where id=pid for update;if not found then raise exception 'Assessment not found';end if;
 insert into public.assessment_history(assessment_id,actor_id,old_expected_kobo,old_waiver_kobo,new_expected_kobo,new_waiver_kobo,reason) values(a.id,actor,a.expected_kobo,a.waiver_kobo,(p_payload->>'expected_kobo')::bigint,(p_payload->>'waiver_kobo')::bigint,reason);
 update public.member_assessments set expected_kobo=(p_payload->>'expected_kobo')::bigint,waiver_kobo=(p_payload->>'waiver_kobo')::bigint,reason=reason,updated_at=now() where id=pid returning to_jsonb(member_assessments) into result;
 when 'record_payment' then
 if length(reason)<2 then raise exception 'Recording or verification note required';end if;
 if not exists(select 1 from public.members where id=(p_payload->>'member_id')::uuid and archived_at is null) then raise exception 'Member unavailable';end if;
 insert into public.payments(member_id,original_member_id,amount_kobo,payment_date,method,reference,external_reference,status,recorded_by,verified_by,verified_at,verification_note) values((p_payload->>'member_id')::uuid,(p_payload->>'member_id')::uuid,(p_payload->>'amount_kobo')::bigint,(p_payload->>'payment_date')::date,p_payload->>'method',coalesce(nullif(trim(p_payload->>'reference'),''),case when p_payload->>'method'='cash' then 'CASH-' else 'PAY-' end||upper(substr(gen_random_uuid()::text,1,8))),nullif(trim(p_payload->>'reference'),''),case when coalesce((p_payload->>'verified')::boolean,false) then 'confirmed' else 'pending' end,actor,case when (p_payload->>'verified')::boolean then actor end,case when (p_payload->>'verified')::boolean then now() end,reason) returning * into p;
 if p.status='confirmed' and jsonb_array_length(coalesce(p_payload->'allocations','[]'))>0 then perform public.replace_allocations(p.id,p_payload->'allocations',reason);end if;result=to_jsonb(p);pid=p.id;
 when 'transition_payment' then
 if length(reason)<2 then raise exception 'Verification or reversal reason required';end if;select * into p from public.payments where id=pid for update;if not found then raise exception 'Payment unavailable';end if;
 if not ((p.status='pending' and p_payload->>'status' in ('confirmed','rejected')) or (p.status='confirmed' and p_payload->>'status'='reversed')) then raise exception 'Payment transition is not allowed';end if;
 update public.payments set status=p_payload->>'status',verified_by=actor,verified_at=now(),verification_note=reason,updated_at=now() where id=pid returning to_jsonb(payments) into result;
 when 'allocate_payment' then perform public.replace_allocations(pid,coalesce(p_payload->'allocations','[]'),reason);select to_jsonb(t) into result from public.payments t where id=pid;
 when 'adjust_payment' then
 select * into p from public.payments where id=pid for update;if not found or p.status<>'confirmed' then raise exception 'A confirmed receipt is required';end if;
 if public.net_payment(pid)+(p_payload->>'delta_kobo')::bigint<0 then raise exception 'Refund exceeds the net receipt';end if;
 insert into public.financial_adjustments(payment_id,delta_kobo,kind,reason,actor_id) values(pid,(p_payload->>'delta_kobo')::bigint,p_payload->>'kind',reason,actor);
 perform public.replace_allocations(pid,coalesce(p_payload->'allocations','[]'),reason);select to_jsonb(t) into result from public.payments t where id=pid;
 when 'save_expense' then
 if pid is not null then select * into e from public.expenses where id=pid for update;if not found or e.status<>'pending' then raise exception 'Only a pending expense can be edited';end if;update public.expenses set collection_id=(p_payload->>'collection_id')::uuid,expense_date=(p_payload->>'expense_date')::date,description=p_payload->>'description',payee=p_payload->>'payee',amount_kobo=(p_payload->>'amount_kobo')::bigint,reason=reason,updated_at=now() where id=pid returning * into e;
 else insert into public.expenses(collection_id,expense_date,description,payee,amount_kobo,reason,recorded_by) values((p_payload->>'collection_id')::uuid,(p_payload->>'expense_date')::date,p_payload->>'description',p_payload->>'payee',(p_payload->>'amount_kobo')::bigint,reason,actor) returning * into e;end if;result=to_jsonb(e);pid=e.id;
 when 'transition_expense' then
 if length(reason)<2 then raise exception 'Expense approval / reversal reason required';end if;select * into e from public.expenses where id=pid for update;if not found then raise exception 'Expense unavailable';end if;update public.expenses set status=p_payload->>'status',approved_by=actor,approved_at=now(),reason=reason,updated_at=now() where id=pid returning to_jsonb(expenses) into result;
 when 'save_event' then
 if length(coalesce(p_payload->>'title',''))<2 or length(coalesce(p_payload->>'location',''))<2 then raise exception 'Event title and location required';end if;
 if nullif(p_payload->>'collection_id','') is not null and not exists(select 1 from public.contribution_collections where id=(p_payload->>'collection_id')::uuid and category<>'monthly') then raise exception 'Events may link only to a special collection';end if;
 if pid is null then insert into public.events(title,event_date,location,description,collection_id,created_by) values(p_payload->>'title',(p_payload->>'event_date')::date,p_payload->>'location',p_payload->>'description',nullif(p_payload->>'collection_id','')::uuid,actor) returning id into pid;
 else update public.events set title=p_payload->>'title',event_date=(p_payload->>'event_date')::date,location=p_payload->>'location',description=p_payload->>'description',collection_id=nullif(p_payload->>'collection_id','')::uuid,updated_at=now() where id=pid;if not found then raise exception 'Event not found';end if;end if;select to_jsonb(t) into result from public.events t where id=pid;
 when 'record_attendance' then
 pid=(p_payload->>'event_id')::uuid;if not exists(select 1 from public.events where id=pid) then raise exception 'Event unavailable';end if;if jsonb_array_length(p_payload->'rows')>2000 then raise exception 'Too many attendance rows';end if;
 for v in select value from jsonb_array_elements(p_payload->'rows') loop insert into public.event_attendance(event_id,member_id,status,recorded_by) values(pid,(v->>'member_id')::uuid,v->>'status',actor) on conflict(event_id,member_id) do update set status=excluded.status,recorded_by=actor,updated_at=now();end loop;
 when 'save_contact' then
 insert into public.contact_history(member_id,contact_date,channel,notes,recorded_by) values((p_payload->>'member_id')::uuid,(p_payload->>'contact_date')::date,p_payload->>'channel',p_payload->>'notes',actor) returning id into pid;update public.members set last_contact_date=greatest(coalesce(last_contact_date,'1900-01-01'),(p_payload->>'contact_date')::date),updated_at=now() where id=(p_payload->>'member_id')::uuid;select to_jsonb(t) into result from public.contact_history t where id=pid;
 when 'save_welfare' then
 aid=(p_payload->>'assigned_to')::uuid;if aid<>actor and not public.has_permission('accounts.write') then raise exception 'Case assignment requires account administration permission';end if;if not public.has_permission_for(aid,'welfare.read') then raise exception 'Assigned officer must have welfare permission';end if;
 if nullif(p_payload->>'expense_id','') is not null then perform public.require_permission('finance.read');end if;
 if pid is not null then select * into w from public.welfare_cases where id=pid and assigned_to=actor for update;if not found then raise exception 'Case outside current assignment' using errcode='42501';end if;old_record=to_jsonb(w);
 update public.welfare_cases set member_id=(p_payload->>'member_id')::uuid,category=p_payload->>'category',description=p_payload->>'description',status=p_payload->>'status',assigned_to=aid,opened_date=(p_payload->>'opened_date')::date,closed_date=nullif(p_payload->>'closed_date','')::date,actions=p_payload->>'actions',expense_id=case when p_payload ? 'expense_id' then nullif(p_payload->>'expense_id','')::uuid else expense_id end,updated_at=now() where id=pid returning * into w;
 else insert into public.welfare_cases(case_no,member_id,category,description,status,assigned_to,opened_date,closed_date,actions,expense_id,created_by) values(public.next_welfare_number(),(p_payload->>'member_id')::uuid,p_payload->>'category',p_payload->>'description',coalesce(p_payload->>'status','open'),aid,(p_payload->>'opened_date')::date,nullif(p_payload->>'closed_date','')::date,p_payload->>'actions',nullif(p_payload->>'expense_id','')::uuid,actor) returning * into w;end if;
 insert into public.welfare_history(case_id,actor_id,old_record,new_record) values(w.id,actor,old_record,to_jsonb(w));result=to_jsonb(w);pid=w.id;
 when 'save_branding' then
 if p_payload ? 'logo_path' and p_payload->>'logo_path' is not null and not exists(select 1 from storage.objects where bucket_id='branding' and name=p_payload->>'logo_path') then raise exception 'Logo must be an uploaded branding object';end if;
 update public.branding set organisation_name=coalesce(p_payload->>'organisation_name',organisation_name),short_name=coalesce(p_payload->>'short_name',short_name),slogan=case when p_payload ? 'slogan' then p_payload->>'slogan' else slogan end,school_name=case when p_payload ? 'school_name' then p_payload->>'school_name' else school_name end,contact_email=case when p_payload ? 'contact_email' then p_payload->>'contact_email' else contact_email end,contact_phone=case when p_payload ? 'contact_phone' then p_payload->>'contact_phone' else contact_phone end,logo_path=case when p_payload ? 'logo_path' then p_payload->>'logo_path' else logo_path end,version=version+1,updated_at=now() where id=true returning to_jsonb(branding) into result;
 if length(result->>'organisation_name')<2 or length(result->>'short_name')<2 then raise exception 'Organisation name and short name required';end if;
 when 'save_settings' then
 if length(reason)<2 then raise exception 'Settings change reason required';end if;update public.private_settings set document_limit_mb=(p_payload->>'document_limit_mb')::smallint,retention_review_months=(p_payload->>'retention_review_months')::smallint,updated_at=now() where id=true returning to_jsonb(private_settings)-'mfa_required' into result;
 when 'save_account' then
 perform pg_advisory_xact_lock(18018);if length(reason)<2 then raise exception 'Access change reason required';end if;select * into account from public.executive_accounts where id=pid for update;if not found then raise exception 'Executive not found; invite first';end if;old_record=to_jsonb(account);
 update public.executive_accounts set display_name=p_payload->>'display_name',active=(p_payload->>'active')::boolean,member_id=nullif(p_payload->>'member_id','')::uuid,updated_at=now() where id=pid;
 update public.role_assignments set revoked_at=now() where executive_id=pid and revoked_at is null;
 for v in select value from jsonb_array_elements(p_payload->'roles') loop insert into public.role_assignments(executive_id,role_code,expires_at,assigned_by) values(pid,v#>>'{}',nullif(p_payload->>'expires_at','')::timestamptz,actor);end loop;
 delete from public.explicit_permissions where executive_id=pid;
 for v in select value from jsonb_array_elements(coalesce(p_payload->'permissions','[]')) loop insert into public.explicit_permissions(executive_id,permission,expires_at) values(pid,v#>>'{}',nullif(p_payload->>'expires_at','')::timestamptz);end loop;
 select to_jsonb(t) into result from public.executive_accounts t where id=pid;perform public.log_action('permissions.changed','account',pid,jsonb_build_object('reason',reason,'old_active',old_record->'active','roles',p_payload->'roles','extra_permissions',p_payload->'permissions'));
 when 'export_audit' then result=jsonb_build_object('approved',true,'scope',p_payload->>'scope','generated_at',now());
 else raise exception 'Unsupported action';end case;
 perform public.log_action(p_action,case when p_action='save_welfare' then 'welfare' when p_action='export_audit' then 'export' else 'record' end,pid,case when p_action='export_audit' then jsonb_build_object('scope',p_payload->>'scope','report',p_payload->>'report','count',p_payload->'count','filters',p_payload->'filters') else jsonb_build_object('reason',reason) end);
 insert into public.command_receipts(actor_id,idempotency_key,request_hash,result) values(actor,p_key,request_hash,coalesce(result,'null'));
 return result;end;
$$;

create function public.workspace_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare result jsonb;v jsonb;
 begin perform public.require_permission('directory.read');result=jsonb_build_object('branding',(select to_jsonb(b) from public.branding b),'members',(select coalesce(jsonb_agg(case when public.has_permission('members.write') then to_jsonb(m) else (to_jsonb(m)-array['details','internal_remarks','archive_reason','name_normalized'])||jsonb_build_object('details',jsonb_build_object('qualification',m.details->'qualification','course',m.details->'course','institution',m.details->'institution','whatsapp',m.details->'whatsapp','whatsapp_normalized',m.details->'whatsapp_normalized','socials',m.details->'socials')) end),'[]') from public.members m),'events',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.events t),'attendance',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.event_attendance t));
 result=result||jsonb_build_object('submissions',case when public.has_permission('registrations.review') then (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.membership_submissions t) else '[]'::jsonb end,'contacts',case when public.has_permission('members.write') then (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.contact_history t) else '[]'::jsonb end);
 if public.has_permission('finance.read') then result=result||jsonb_build_object('collections',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.contribution_collections t),'assessments',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.member_assessments t where superseded_by is null),'payments',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.payments t),'allocations',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.payment_allocations t),'adjustments',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.financial_adjustments t),'expenses',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.expenses t));else result=result||jsonb_build_object('collections','[]'::jsonb,'assessments','[]'::jsonb,'payments','[]'::jsonb,'allocations','[]'::jsonb,'adjustments','[]'::jsonb,'expenses','[]'::jsonb);end if;
 result=result||jsonb_build_object('welfare',case when public.has_permission('welfare.read') then (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.welfare_cases t where t.assigned_to=auth.uid()) else '[]'::jsonb end,'documents',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.documents t where public.can_access_document(t.scope,t.target_id)),'audit',case when public.has_permission('audit.read') then (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') from public.audit_events t) else '[]'::jsonb end,'settings',case when public.has_permission('settings.write') then (select to_jsonb(t)-'mfa_required' from public.private_settings t) else '{}'::jsonb end);
 if public.has_permission('accounts.write') then select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('roles',(select coalesce(jsonb_agg(r.role_code),'[]') from public.role_assignments r where r.executive_id=t.id and r.revoked_at is null and r.starts_at<=now() and (r.expires_at is null or r.expires_at>now())),'expires_at',(select max(r.expires_at) from public.role_assignments r where r.executive_id=t.id and r.revoked_at is null),'extra_permissions',(select coalesce(jsonb_agg(e.permission),'[]') from public.explicit_permissions e where e.executive_id=t.id and (e.expires_at is null or e.expires_at>now())))),'[]') into v from public.executive_accounts t;else select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'display_name',t.display_name,'active',t.active)),'[]') into v from public.executive_accounts t where t.id=auth.uid();end if;result=result||jsonb_build_object('accounts',v);return result;end;
$$;
-- All helper functions remain private to the database owner.
revoke execute on function public.next_member_number(),public.next_welfare_number(),public.normalise_phone(text),public.member_write(jsonb,uuid),public.replace_allocations(uuid,jsonb,text),public.execute_action(text,jsonb,uuid),public.workspace_snapshot() from public,anon,authenticated;
grant execute on function public.execute_action(text,jsonb,uuid),public.workspace_snapshot() to authenticated;
commit;
