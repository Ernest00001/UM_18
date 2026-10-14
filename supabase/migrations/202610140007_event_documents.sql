begin;
alter table public.documents drop constraint documents_scope_check;
alter table public.documents add constraint documents_scope_check check(scope in ('general','member','collection','payment','expense','welfare','event'));
create or replace function public.can_access_document(p_scope text,p_target uuid,p_write boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select case when p_scope='general' then public.has_permission(case when p_write then 'documents.write' else 'directory.read' end)
 when p_scope='member' then public.has_permission('members.write') and exists(select 1 from public.members where id=p_target)
 when p_scope='event' then public.has_permission(case when p_write then 'events.write' else 'directory.read' end) and exists(select 1 from public.events where id=p_target)
 when p_scope='collection' then public.has_permission(case when p_write then 'finance.write' else 'finance.read' end) and exists(select 1 from public.contribution_collections where id=p_target)
 when p_scope='payment' then public.has_permission(case when p_write then 'finance.write' else 'finance.read' end) and exists(select 1 from public.payments where id=p_target)
 when p_scope='expense' then public.has_permission(case when p_write then 'finance.write' else 'finance.read' end) and exists(select 1 from public.expenses where id=p_target)
 when p_scope='welfare' then public.has_permission(case when p_write then 'welfare.write' else 'welfare.read' end) and exists(select 1 from public.welfare_cases where id=p_target and assigned_to=auth.uid()) else false end and (not p_write or public.has_permission('documents.write'));
$$;
-- Additional event files are fetched independently by the selected event page.
create function public.event_documents(p_event uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin perform public.require_permission('directory.read');return (select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.documents d where scope='event' and target_id=p_event and public.can_access_document(scope,target_id));end;$$;
revoke execute on function public.event_documents(uuid) from public,anon;
grant execute on function public.event_documents(uuid) to authenticated;
commit;
