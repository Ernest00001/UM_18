begin;

-- Lists need event-level counts without downloading individual attendance rows.
alter function public.workspace_data(text,uuid) rename to workspace_data_v5;
revoke execute on function public.workspace_data_v5(text,uuid) from public,anon,authenticated,service_role;
create function public.workspace_data(p_area text,p_target uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d jsonb;
begin
 perform public.require_permission('directory.read');
 d=public.workspace_data_v5(p_area,p_target);
 if p_area='events' and p_target is null then
  d=jsonb_set(d,'{events}',(
   select coalesce(jsonb_agg(entry||jsonb_build_object('recorded_present',coalesce(counts.present,0))),'[]')
   from jsonb_array_elements(d->'events') entry
   left join (select event_id,count(*) filter(where status='present') present from public.event_attendance group by event_id) counts
    on counts.event_id=(entry->>'id')::uuid
  ));
 end if;
 return d;
end;$$;
revoke execute on function public.workspace_data(text,uuid) from public,anon,service_role;
grant execute on function public.workspace_data(text,uuid) to authenticated;

-- Every executive can page through the same narrow, shared expense projection.
-- Private descriptions, payees, notes, documents and actor IDs stay outside this RPC.
create function public.accountability_expenses(
 p_from date,p_to date,p_query text default '',p_status text default '',
 p_offset integer default 0,p_limit integer default 20,p_sort text default 'expense_date',p_desc boolean default true
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_permission('directory.read');
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366
  or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 100
  or p_query is null or length(p_query)>180 or p_status is null or p_status not in ('','pending','approved','reversed')
  or p_sort is null or p_sort not in ('description','expense_date','collection_title','responsible_officer_name','amount_kobo','status')
  or p_desc is null then raise exception 'Choose a valid shared expense scope';end if;
 with projected as (
  select e.id,e.expense_date,coalesce(nullif(trim(e.overview_summary),''),'Expense recorded') description,
   e.amount_kobo,e.status,a.display_name responsible_officer_name,c.title collection_title
  from public.expenses e join public.executive_accounts a on a.id=e.recorded_by
   join public.contribution_collections c on c.id=e.collection_id
  where e.expense_date between p_from and p_to
 ), matches as (
  select * from projected where (p_status='' or status=p_status)
   and (p_query='' or strpos(lower(concat_ws(' ',description,expense_date,collection_title,responsible_officer_name,status)),lower(p_query))>0)
 ), ordered as (
  select *,case p_sort when 'description' then description when 'expense_date' then expense_date::text
   when 'collection_title' then collection_title when 'responsible_officer_name' then responsible_officer_name when 'status' then status end sort_text,
   case when p_sort='amount_kobo' then amount_kobo end sort_amount from matches
 )
 select jsonb_build_object('count',(select count(*) from matches),'rows',(
  select coalesce(jsonb_agg(to_jsonb(page)-array['sort_text','sort_amount']),'[]') from (
   select * from ordered order by case when not p_desc then sort_amount end asc nulls last,
    case when p_desc then sort_amount end desc nulls last,
    case when not p_desc then lower(sort_text) end asc nulls last,
    case when p_desc then lower(sort_text) end desc nulls last,id
   limit p_limit offset p_offset
  ) page
 )) into result;
 return result;
end;$$;
revoke execute on function public.accountability_expenses(date,date,text,text,integer,integer,text,boolean) from public,anon,service_role;
grant execute on function public.accountability_expenses(date,date,text,text,integer,integer,text,boolean) to authenticated;

create index expenses_shared_date on public.expenses(expense_date desc,id);

-- Cover foreign-key lookups without duplicating existing full prefix indexes.
do $$
declare fk record;columns_sql text;index_name text;
begin
 for fk in
  select c.conrelid,c.conname,c.conkey,n.nspname,t.relname
  from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
  where c.contype='f' and n.nspname='public' and not exists(
   select 1 from pg_index i where i.indrelid=c.conrelid and i.indisvalid and i.indisready
    and i.indpred is null and i.indnkeyatts>=cardinality(c.conkey)
    and c.conkey <@ (i.indkey::smallint[])[0:cardinality(c.conkey)-1]
  )
 loop
  select string_agg(quote_ident(a.attname),',' order by k.position) into columns_sql
   from unnest(fk.conkey) with ordinality k(attnum,position)
   join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.attnum;
  index_name='fk_'||left(fk.relname,35)||'_'||substr(md5(fk.conname),1,10);
  execute format('create index %I on %I.%I (%s)',index_name,fk.nspname,fk.relname,columns_sql);
 end loop;
end;$$;
commit;
