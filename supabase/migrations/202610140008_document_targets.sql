begin;
create function public.document_targets(p_scope text,p_query text default '') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin perform public.require_permission('documents.write');if length(p_query)>180 then raise exception 'Search is too long';end if;
case p_scope
when 'member' then perform public.require_permission('members.write');select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select id,member_no||' · '||full_name label from public.members where archived_at is null and (p_query='' or strpos(lower(full_name||' '||member_no),lower(p_query))>0) order by full_name limit 100)t;
when 'collection' then perform public.require_permission('finance.write');select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select id,title label from public.contribution_collections where p_query='' or strpos(lower(title),lower(p_query))>0 order by created_at desc limit 100)t;
when 'payment' then perform public.require_permission('finance.write');select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select p.id,p.reference||' · '||m.full_name label from public.payments p join public.members m on m.id=p.member_id where p_query='' or strpos(lower(p.reference||' '||m.full_name),lower(p_query))>0 order by p.payment_date desc limit 100)t;
when 'expense' then perform public.require_permission('finance.write');select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select id,description label from public.expenses where p_query='' or strpos(lower(description),lower(p_query))>0 order by expense_date desc limit 100)t;
when 'event' then perform public.require_permission('events.write');select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select id,title label from public.events where p_query='' or strpos(lower(title),lower(p_query))>0 order by event_date desc limit 100)t;
when 'welfare' then perform public.require_permission('welfare.write');select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select id,case_no label from public.welfare_cases where assigned_to=auth.uid() and (p_query='' or strpos(lower(case_no),lower(p_query))>0) order by created_at desc limit 100)t;
else raise exception 'Unsupported document scope';end case;return result;end;$$;
revoke execute on function public.document_targets(text,text) from public,anon;
grant execute on function public.document_targets(text,text) to authenticated;
commit;
