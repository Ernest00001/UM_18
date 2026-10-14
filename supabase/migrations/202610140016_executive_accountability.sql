-- Executive accountability exposes approved summaries without the private ledger.
begin;
insert into public.permissions(code) values('office_reports.write') on conflict do nothing;
insert into public.role_permissions(role_code,permission) values('owner','office_reports.write') on conflict do nothing;
alter table public.expenses add column overview_summary text check(overview_summary is null or length(overview_summary)<=1500);

create function public.office_report_team(p_office text) returns text[] language sql immutable set search_path='' as $$
 select case when p_office in ('president','vice_president') then array['president','vice_president']
 when p_office in ('secretary','assistant_secretary') then array['secretary','assistant_secretary']
 when p_office in ('treasurer','assistant_treasurer') then array['treasurer','assistant_treasurer']
 when p_office in ('financial_secretary','assistant_financial_secretary') then array['financial_secretary','assistant_financial_secretary']
 else array[p_office] end;
$$;
revoke execute on function public.office_report_team(text) from public,anon,authenticated,service_role;
create function public.can_write_office_report(p_office text) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_permission('office_reports.write') and exists(select 1 from public.executive_offices where code=p_office) and
 (public.has_permission('accounts.write') or exists(select 1 from public.executive_accounts where id=auth.uid() and office_codes && public.office_report_team(p_office)));
$$;
revoke execute on function public.can_write_office_report(text) from public,anon,service_role;
grant execute on function public.can_write_office_report(text) to authenticated;

create table public.office_reports(
 id uuid primary key default gen_random_uuid(),office_code text not null references public.executive_offices,
 report_type text not null check(report_type in ('report','minutes','board_decision')),
 title text not null check(length(title) between 2 and 180),summary text not null check(length(summary) between 2 and 6000),report_date date not null,
 status text not null default 'draft' check(status in ('draft','published')),revision bigint not null default 1 check(revision>0),
 created_by uuid not null references public.executive_accounts,updated_by uuid not null references public.executive_accounts,published_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((status='published')=(published_at is not null))
);
create index office_reports_publication on public.office_reports(status,report_date desc,created_at desc);
create table public.office_report_history(
 id uuid primary key default gen_random_uuid(),report_id uuid not null references public.office_reports,actor_id uuid not null references public.executive_accounts,
 action text not null,reason text not null check(length(reason) between 2 and 1500),old_record jsonb,new_record jsonb not null,created_at timestamptz not null default now()
);
create index office_report_history_record on public.office_report_history(report_id,created_at);
alter table public.office_reports enable row level security;
alter table public.office_report_history enable row level security;
revoke all on public.office_reports,public.office_report_history from anon,authenticated;
create policy office_reports_executive_read on public.office_reports for select to authenticated using(public.has_permission('directory.read') and (status='published' or public.can_write_office_report(office_code)));
create policy office_report_history_team_read on public.office_report_history for select to authenticated using(public.has_permission('directory.read') and exists(select 1 from public.office_reports r where r.id=report_id and public.can_write_office_report(r.office_code)));
grant select on public.office_reports,public.office_report_history to authenticated;

create function public.office_report_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_permission('directory.read');
 return (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'office_code',r.office_code,'report_type',r.report_type,'title',r.title,'summary',r.summary,'report_date',r.report_date,'status',r.status,'revision',r.revision,'published_at',r.published_at,'created_at',r.created_at,'updated_at',r.updated_at,'author_name',a.display_name,'updated_by_name',u.display_name,'can_edit',public.can_write_office_report(r.office_code)) order by r.report_date desc,r.created_at desc,r.id),'[]') from public.office_reports r join public.executive_accounts a on a.id=r.created_by join public.executive_accounts u on u.id=r.updated_by where r.status='published' or public.can_write_office_report(r.office_code));
end;$$;
create function public.office_report_history(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare office text;begin
 perform public.require_permission('directory.read');select office_code into office from public.office_reports where id=p_id;
 if not found or not public.can_write_office_report(office) then raise exception 'Office report history is outside your current workspace' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(h) order by created_at desc,id),'[]') from public.office_report_history h where report_id=p_id);
end;$$;
revoke execute on function public.office_report_list(),public.office_report_history(uuid) from public,anon,service_role;
grant execute on function public.office_report_list(),public.office_report_history(uuid) to authenticated;

alter function public.execute_action(text,jsonb,uuid) rename to execute_action_v5;
revoke execute on function public.execute_action_v5(text,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.execute_action(p_action text,p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid=auth.uid();pid uuid;office text;r public.office_reports;receipt public.command_receipts;hash text;result jsonb;before_record jsonb;reason text;before_summary text;
begin
 if p_action='save_expense' then
  perform public.require_permission('finance.write');
  if actor is null or p_key is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>65536 then raise exception 'Invalid expense operation';end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_key::text,0));hash=md5(p_action||p_payload::text);
  select * into receipt from public.command_receipts where actor_id=actor and idempotency_key=p_key;
  if found then if receipt.request_hash<>hash then raise exception 'Retry key reused with different contents';end if;return receipt.result;end if;
  if p_payload ? 'overview_summary' and (jsonb_typeof(p_payload->'overview_summary') not in ('string','null') or length(coalesce(p_payload->>'overview_summary',''))>1500) then raise exception 'Keep the shared expense summary within 1500 characters';end if;
  pid=nullif(p_payload->>'id','')::uuid;if pid is not null then select overview_summary into before_summary from public.expenses where id=pid for update;end if;
  result=public.execute_action_v5(p_action,p_payload,p_key);pid=(result->>'id')::uuid;
  if p_payload ? 'overview_summary' then update public.expenses set overview_summary=nullif(trim(p_payload->>'overview_summary'),'') where id=pid returning to_jsonb(expenses) into result;end if;
  if before_summary is distinct from result->>'overview_summary' then perform public.log_action('expense.overview_summary_saved','expense',pid,jsonb_build_object('reason',p_payload->>'reason','before',before_summary,'after',result->'overview_summary'));end if;
  update public.command_receipts set result=result where actor_id=actor and idempotency_key=p_key;return result;
 end if;
 if p_action not in ('save_office_report','publish_office_report','withdraw_office_report') then return public.execute_action_v5(p_action,p_payload,p_key);end if;
 perform public.require_permission('office_reports.write');
 if actor is null or p_key is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>24000 then raise exception 'Invalid office report operation';end if;
 pid=nullif(p_payload->>'id','')::uuid;
 if p_action='save_office_report' and pid is null then office=p_payload->>'office_code';else select office_code into office from public.office_reports where id=pid;if not found then raise exception 'Office report unavailable';end if;end if;
 -- Office scope is live authority, even when the requested operation already completed.
 if not public.can_write_office_report(office) then raise exception 'Office report is outside your current workspace' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_key::text,0));hash=md5(p_action||p_payload::text);
 select * into receipt from public.command_receipts where actor_id=actor and idempotency_key=p_key;
 if found then if receipt.request_hash<>hash then raise exception 'Retry key reused with different contents';end if;return receipt.result;end if;
 reason=trim(coalesce(p_payload->>'reason',''));
 if pid is not null then
  select * into r from public.office_reports where id=pid for update;before_record=to_jsonb(r);
  if p_payload->>'expected_revision' is null or (p_payload->>'expected_revision')::bigint<>r.revision then raise exception 'Report changed. Refresh and review the latest version before saving.' using errcode='40001';end if;
  if length(reason) not between 2 and 1500 then raise exception 'Provide a report change or publication reason';end if;
 elsif p_action<>'save_office_report' then raise exception 'Choose an office report';
 else reason=coalesce(nullif(reason,''),'Report created');if length(reason) not between 2 and 1500 then raise exception 'Provide a valid report creation reason';end if;
 end if;
 case p_action
 when 'save_office_report' then
  if coalesce(p_payload->>'status','draft')<>'draft' then raise exception 'Save a draft and publish it after review';end if;
  if pid is null then
   insert into public.office_reports(office_code,report_type,title,summary,report_date,created_by,updated_by) values(office,p_payload->>'report_type',trim(p_payload->>'title'),trim(p_payload->>'summary'),(p_payload->>'report_date')::date,actor,actor) returning * into r;pid=r.id;
  else
   if r.status<>'draft' then raise exception 'Withdraw the published report before editing its draft';end if;
   if p_payload ? 'office_code' and p_payload->>'office_code' is distinct from r.office_code then raise exception 'The report office cannot change; create a report in the correct workspace';end if;
   update public.office_reports set report_type=p_payload->>'report_type',title=trim(p_payload->>'title'),summary=trim(p_payload->>'summary'),report_date=(p_payload->>'report_date')::date,revision=revision+1,updated_by=actor,updated_at=now() where id=pid returning * into r;
  end if;
 when 'publish_office_report' then
  if r.status<>'draft' then raise exception 'Only a draft report can be published';end if;
  update public.office_reports set status='published',published_at=now(),revision=revision+1,updated_by=actor,updated_at=now() where id=pid returning * into r;
 when 'withdraw_office_report' then
  if r.status<>'published' then raise exception 'Only a published report can be withdrawn to draft';end if;
  update public.office_reports set status='draft',published_at=null,revision=revision+1,updated_by=actor,updated_at=now() where id=pid returning * into r;
 end case;
 result=to_jsonb(r);
 insert into public.office_report_history(report_id,actor_id,action,reason,old_record,new_record) values(pid,actor,p_action,reason,before_record,result);
 perform public.log_action(p_action,'office_report',pid,jsonb_build_object('office_code',office,'revision',r.revision,'status',r.status,'reason',reason));
 insert into public.command_receipts(actor_id,idempotency_key,request_hash,result) values(actor,p_key,hash,result);return result;
end;$$;
revoke execute on function public.execute_action(text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.execute_action(text,jsonb,uuid) to authenticated;

-- One canonical aggregate implementation powers cards and the monthly schedule.
create function public.collection_summary_data() returns table(id uuid,received bigint,spending bigint,expected bigint,outstanding bigint,remaining bigint) language sql stable security definer set search_path='' as $$
 with paid as(select a.collection_id,a.member_id,sum(a.amount_kobo)::bigint amount from public.payment_allocations a join public.payments p on p.id=a.payment_id where p.status='confirmed' group by a.collection_id,a.member_id),
 receipts as(select collection_id,sum(amount)::bigint amount from paid group by collection_id),
 costs as(select collection_id,sum(amount_kobo)::bigint amount from public.expenses where status='approved' group by collection_id),
 dues as(select a.collection_id,sum(a.expected_kobo-a.waiver_kobo)::bigint expected,sum(greatest(0,a.expected_kobo-a.waiver_kobo-coalesce(p.amount,0)))::bigint outstanding from public.member_assessments a left join paid p on p.collection_id=a.collection_id and p.member_id=a.member_id where a.superseded_by is null group by a.collection_id)
 select c.id,coalesce(r.amount,0)::bigint,coalesce(x.amount,0)::bigint,coalesce(d.expected,0)::bigint,coalesce(d.outstanding,0)::bigint,(coalesce(r.amount,0)-coalesce(x.amount,0))::bigint from public.contribution_collections c left join receipts r on r.collection_id=c.id left join costs x on x.collection_id=c.id left join dues d on d.collection_id=c.id;
$$;
revoke execute on function public.collection_summary_data() from public,anon,authenticated,service_role;
create function public.collection_summaries() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform public.require_permission('finance.read');return (select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.collection_summary_data() s);end;$$;
revoke execute on function public.collection_summaries() from public,anon,service_role;
grant execute on function public.collection_summaries() to authenticated;

create function public.monthly_schedule(p_year integer,p_member uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare credit bigint=0;months jsonb;begin
 perform public.require_permission('finance.read');perform public.require_permission('directory.read');
 if p_year is null or p_year not between 1900 and 2100 then raise exception 'Choose a valid schedule year';end if;
 if p_member is not null then
  if not exists(select 1 from public.members where id=p_member) then raise exception 'Member unavailable';end if;
  select coalesce(sum(public.net_payment(p.id)-coalesce((select sum(amount_kobo) from public.payment_allocations where payment_id=p.id),0)),0)::bigint into credit from public.payments p where member_id=p_member and status='confirmed';
 end if;
 with summaries as(select * from public.collection_summary_data())
 select jsonb_agg(jsonb_build_object('period',to_char(make_date(p_year,n,1),'YYYY-MM'),'collections',(
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'status',c.status,'participation',c.participation,'amount_kobo',c.amount_kobo,'deadline',c.deadline,'received_kobo',s.received,'spending_kobo',s.spending,'expected_kobo',s.expected,'outstanding_kobo',s.outstanding,
  'assessment_count',(select count(*) from public.member_assessments where collection_id=c.id and superseded_by is null),'member_expected_kobo',a.expected_kobo,'member_waiver_kobo',a.waiver_kobo,'member_paid_kobo',case when p_member is not null then coalesce((select sum(x.amount_kobo) from public.payment_allocations x join public.payments p on p.id=x.payment_id where x.collection_id=c.id and x.member_id=p_member and p.status='confirmed'),0) else null end,'member_assessed',a.id is not null) order by c.created_at,c.id),'[]')
  from public.contribution_collections c join summaries s on s.id=c.id left join public.member_assessments a on a.collection_id=c.id and a.member_id=p_member and a.superseded_by is null where c.category='monthly' and c.period=to_char(make_date(p_year,n,1),'YYYY-MM')))
  order by n) into months from generate_series(1,12) n;
 return jsonb_build_object('year',p_year,'member_id',p_member,'credit_kobo',credit,'months',months);
end;$$;
revoke execute on function public.monthly_schedule(integer,uuid) from public,anon,service_role;
grant execute on function public.monthly_schedule(integer,uuid) to authenticated;

create function public.executive_accountability(p_from date default date_trunc('month',now() at time zone 'Africa/Lagos')::date,p_to date default (now() at time zone 'Africa/Lagos')::date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare totals jsonb;expenses jsonb;reports jsonb;begin
 perform public.require_permission('directory.read');
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then raise exception 'Choose an accountability date range up to 12 months';end if;
 totals=jsonb_build_object('receipts_kobo',(select coalesce(sum(public.net_payment(id)),0) from public.payments where payment_date between p_from and p_to),'approved_expenses_kobo',(select coalesce(sum(amount_kobo),0) from public.expenses where status='approved' and expense_date between p_from and p_to),'pending_expenses_kobo',(select coalesce(sum(amount_kobo),0) from public.expenses where status='pending' and expense_date between p_from and p_to),'reversed_expenses_kobo',(select coalesce(sum(amount_kobo),0) from public.expenses where status='reversed' and expense_date between p_from and p_to));
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'expense_date',e.expense_date,'description',coalesce(nullif(trim(e.overview_summary),''),'Expense recorded'),'amount_kobo',e.amount_kobo,'status',e.status,'responsible_officer_name',a.display_name,'collection_title',c.title) order by e.expense_date desc,e.created_at desc,e.id),'[]') into expenses from (select * from public.expenses where expense_date between p_from and p_to order by expense_date desc,created_at desc,id limit 50) e join public.executive_accounts a on a.id=e.recorded_by join public.contribution_collections c on c.id=e.collection_id;
 select coalesce(jsonb_agg(x order by x->>'report_date' desc,x->>'created_at' desc,x->>'id'),'[]') into reports from (select x from jsonb_array_elements(public.office_report_list()) x where x->>'status'='published' and (x->>'report_date')::date between p_from and p_to order by x->>'report_date' desc,x->>'created_at' desc,x->>'id' limit 50) selected;
 return jsonb_build_object('from',p_from,'to',p_to,'totals',totals,'expenses',expenses,'reports',reports);
end;$$;
revoke execute on function public.executive_accountability(date,date) from public,anon,service_role;
grant execute on function public.executive_accountability(date,date) to authenticated;
commit;
