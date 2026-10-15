begin;

-- Require the exact reviewed expense version; row locks alone cannot detect stale forms.
alter table public.expenses add column revision bigint not null default 1 check(revision>0);
create function um18_internal.bump_expense_revision() returns trigger language plpgsql set search_path='' as $$
begin new.revision=old.revision+1;return new;end;$$;
revoke execute on function um18_internal.bump_expense_revision() from public,anon,authenticated,service_role;
create trigger expense_revision before update on public.expenses for each row execute function um18_internal.bump_expense_revision();
alter function public.execute_action(text,jsonb,uuid) rename to execute_action_pre_audit_repairs;
revoke execute on function public.execute_action_pre_audit_repairs(text,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.execute_action(p_action text,p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt public.command_receipts;expense public.expenses;pid uuid;
begin
 if p_action in ('save_expense','transition_expense') then
  perform public.require_permission('finance.write');
  if p_key is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid expense operation';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
  select * into receipt from public.command_receipts where actor_id=auth.uid() and idempotency_key=p_key;
  if found then
   if receipt.request_hash<>md5(p_action||p_payload::text) then raise exception 'Retry key reused with different contents';end if;
   return receipt.result;
  end if;
  pid=nullif(p_payload->>'id','')::uuid;
  if pid is not null then
   select * into expense from public.expenses where id=pid for update;
   if not found then raise exception 'Expense unavailable';end if;
   if p_payload->>'expected_revision' is null or (p_payload->>'expected_revision')::bigint<>expense.revision then
    raise exception 'Expense changed. Refresh and review the latest amount before saving or approving.' using errcode='40001';
   end if;
  elsif p_action='transition_expense' then raise exception 'Expense unavailable';end if;
 end if;
 return public.execute_action_pre_audit_repairs(p_action,p_payload,p_key);
end;$$;
revoke execute on function public.execute_action(text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.execute_action(text,jsonb,uuid) to authenticated;

-- Narrow the original data query before later permission/projection wrappers run.
create or replace function public.workspace_data_v1(p_area text,p_target uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d jsonb;pay_ids uuid[];mid uuid;begin perform public.require_permission('directory.read');
 if p_area not in ('login','overview','members','registrations','monthly','special','payments','expenses','events','welfare','contacts','documents','reports','branding','accounts','audit') then raise exception 'Unknown workspace area';end if;
 d=jsonb_build_object('branding',(select to_jsonb(b) from public.branding b),'members',(select coalesce(jsonb_agg(case when m.id=p_target and p_area='members' and public.has_permission('members.write') then to_jsonb(m) else (to_jsonb(m)-array['details','internal_remarks','archive_reason','name_normalized'])||jsonb_build_object('details',case when m.id=p_target and p_area='members' then jsonb_build_object('qualification',m.details->'qualification','qualification_other',m.details->'qualification_other','course',m.details->'course','institution',m.details->'institution','occupation_other',m.details->'occupation_other','business_name',m.details->'business_name','business_sector',m.details->'business_sector','business_description',m.details->'business_description','whatsapp',m.details->'whatsapp','whatsapp_normalized',m.details->'whatsapp_normalized','socials',m.details->'socials') else '{}'::jsonb end) end),'[]') from public.members m where
 p_area='reports' or p_area='events' and p_target is not null
 or m.id=(select member_id from public.executive_accounts where id=auth.uid())
 or p_area='overview' and m.id in (select id from public.members where archived_at is null and merged_into_member_id is null order by verified_at desc nulls last,id limit 8)
 or p_area in ('members','payments','accounts') and m.id=p_target
 or p_area='payments' and m.id in (select member_id from public.payments where id=p_target)
 or p_area in ('monthly','special') and p_target is not null and (exists(select 1 from public.member_assessments a where a.collection_id=p_target and a.member_id=m.id and a.superseded_by is null) or exists(select 1 from public.payment_allocations a where a.collection_id=p_target and a.member_id=m.id))
 or p_area='contacts' and exists(select 1 from public.contact_history c where c.member_id=m.id)
 or p_area='welfare' and exists(select 1 from public.welfare_cases w where w.member_id=m.id and w.assigned_to=auth.uid())
 or p_area='accounts' and exists(select 1 from public.executive_accounts a where a.member_id=m.id)
 or p_area='registrations' and exists(select 1 from public.membership_submissions s where (p_target is null or s.id=p_target) and (m.id=any(s.possible_duplicate_ids) or m.id=s.member_id))
),'events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from public.events e),'attendance',case when p_area in ('events','members','reports') then (select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.event_attendance a where p_area='reports' or p_area='events' and a.event_id=p_target or p_area='members' and a.member_id=p_target) else '[]'::jsonb end);
 d=d||jsonb_build_object('submissions',case when public.has_permission('registrations.review') and p_area in ('registrations','reports') then (select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.membership_submissions s) when public.has_permission('registrations.review') and p_area in ('overview','login') then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'review_status',review_status)),'[]') from public.membership_submissions where review_status='pending') else '[]'::jsonb end,'contacts',case when public.has_permission('members.write') and p_area in ('overview','contacts','members','reports') then (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.contact_history t where p_area<>'members' or member_id=p_target) else '[]'::jsonb end);
 if public.has_permission('finance.read') then
 if p_area='payments' then select member_id into mid from public.payments where id=p_target;end if;
 select coalesce(array_agg(p.id),'{}') into pay_ids from public.payments p where p_area='reports' or p_area='payments' and p.id=p_target or p_area='members' and p.member_id=p_target or p_area in ('monthly','special') and exists(select 1 from public.payment_allocations a where a.payment_id=p.id and a.collection_id=p_target);
 d=d||jsonb_build_object('collections',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.contribution_collections c),'payments',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.payments p where p.id=any(pay_ids)),'allocations',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.payment_allocations a where a.payment_id=any(pay_ids)),'adjustments',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.financial_adjustments a where a.payment_id=any(pay_ids)),'assessments',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.member_assessments a where superseded_by is null and (p_area='reports' or p_area='members' and member_id=p_target or p_area='payments' and member_id=mid or p_area in ('monthly','special') and collection_id=p_target)),'expenses',case when p_area in ('monthly','special','expenses','welfare','reports') then (select coalesce(jsonb_agg(to_jsonb(e)),'[]') from public.expenses e where p_area not in ('monthly','special') or collection_id=p_target) else '[]'::jsonb end);
 else d=d||jsonb_build_object('collections','[]'::jsonb,'payments','[]'::jsonb,'allocations','[]'::jsonb,'adjustments','[]'::jsonb,'assessments','[]'::jsonb,'expenses','[]'::jsonb);end if;
 d=d||jsonb_build_object('welfare',case when public.has_permission('welfare.read') and p_area in ('welfare','reports','documents','overview') then (select coalesce(jsonb_agg(to_jsonb(w)),'[]') from public.welfare_cases w where assigned_to=auth.uid()) else '[]'::jsonb end,'documents',case when p_area in ('documents','members','payments','monthly','special','expenses','welfare','events') then (select coalesce(jsonb_agg(to_jsonb(f)),'[]') from public.documents f where public.can_access_document(f.scope,f.target_id) and (p_area='documents' or p_area='welfare' and f.scope='welfare' or p_area='members' and f.scope='member' and target_id=p_target or p_area='payments' and f.scope='payment' and target_id=p_target or p_area in ('monthly','special') and (f.scope='collection' and target_id=p_target or f.scope='expense' and exists(select 1 from public.expenses e where e.id=target_id and collection_id=p_target)) or p_area='expenses' and f.scope='expense' or p_area='events' and f.scope='collection' and exists(select 1 from public.events e where e.id=p_target and e.collection_id=f.target_id))) else '[]'::jsonb end,'audit',case when p_area='audit' and public.has_permission('audit.read') then (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]') from public.audit_events a) else '[]'::jsonb end,'settings',case when p_area='branding' and public.has_permission('settings.write') then (select to_jsonb(s)-'mfa_required' from public.private_settings s) else '{}'::jsonb end,'officers',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'display_name',a.display_name,'active',a.active,'welfare_eligible',public.has_permission_for(a.id,'welfare.read') and public.has_permission_for(a.id,'welfare.write'))),'[]') from public.executive_accounts a));
 if p_area='accounts' and public.has_permission('accounts.write') then d=d||jsonb_build_object('accounts',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('roles',(select coalesce(jsonb_agg(role_code),'[]') from public.role_assignments where executive_id=a.id and revoked_at is null and starts_at<=now() and (expires_at is null or expires_at>now())),'extra_permissions',(select coalesce(jsonb_agg(permission),'[]') from public.explicit_permissions where executive_id=a.id),'denied_permissions',(select coalesce(jsonb_agg(permission),'[]') from public.permission_denials where executive_id=a.id),'role_history',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') from public.role_assignments r where executive_id=a.id))),'[]') from public.executive_accounts a));else d=d||jsonb_build_object('accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'display_name',a.display_name,'active',a.active)),'[]') from public.executive_accounts a where id=auth.uid()));end if;
 if p_area in ('overview','members') then
  d=d||jsonb_build_object('directory_summary',(select jsonb_build_object(
   'member_count',count(*) filter(where archived_at is null),'active_count',count(*) filter(where archived_at is null and membership_status='active'),
   'inactive_count',count(*) filter(where archived_at is null and membership_status='inactive'),
   'countries',(select coalesce(jsonb_agg(country order by country),'[]') from (select distinct country from public.members where country is not null and country<>'') c),
   'skills_count',(select count(distinct skill) from public.members m cross join unnest(m.skills) skill where m.archived_at is null)
  ) from public.members where merged_into_member_id is null));
 end if;
 return d;
end;$$;

revoke execute on function public.workspace_data_v1(text,uuid) from public,anon,authenticated,service_role;
-- These pages load their own profile/report RPC; they do not need Overview's recent roster.
create or replace function public.workspace_data(p_area text,p_target uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin return public.workspace_data_pre_profile(case when p_area in ('profile','office-reports') then 'login' else p_area end,p_target);end;$$;
revoke execute on function public.workspace_data(text,uuid) from public,anon,service_role;
grant execute on function public.workspace_data(text,uuid) to authenticated;
commit;
