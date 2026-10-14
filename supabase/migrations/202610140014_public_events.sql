-- Public event copy and images are separate from private association documents.
begin;
alter table public.events
 add column status text not null default 'upcoming' check(status in ('upcoming','closed')),
 add column is_public boolean not null default false,
 add column public_location text check(public_location is null or length(public_location)<=300),
 add column public_description text check(public_description is null or length(public_description)<=1500),
 add column closed_at timestamptz,
 add constraint event_closure_state check((status='closed')=(closed_at is not null));
create index public_event_lifecycle on public.events(status,event_date) where is_public;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('event-media','event-media',false,3145728,array['image/png','image/jpeg','image/webp']) on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create table public.event_media(
 id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events,
 bucket text not null default 'event-media' check(bucket='event-media'),object_path text not null unique,
 mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp')),
 byte_size integer not null check(byte_size between 1 and 3145728),
 kind text not null check(kind in ('poster','photo')),
 caption text not null default '' check(length(caption)<=1500),
 alt_text text not null check(length(alt_text) between 1 and 300),
 is_banner boolean not null default false,show_in_gallery boolean not null default false,
 uploaded_by uuid not null references public.executive_accounts,
 archived_at timestamptz,archive_reason text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(not is_banner or kind='poster')
);
create unique index one_active_event_banner on public.event_media(event_id) where is_banner and archived_at is null;
create index event_media_record on public.event_media(event_id,created_at);
alter table public.event_media enable row level security;
revoke all on public.event_media from anon,authenticated;
create policy event_media_executive_read on public.event_media for select to authenticated using(public.has_permission('directory.read') and (archived_at is null or public.has_permission('events.write')));
grant select on public.event_media to authenticated;
create policy event_media_storage_read on storage.objects for select to authenticated using(bucket_id='event-media' and exists(select 1 from public.event_media m where m.object_path=name and public.has_permission('directory.read') and (m.archived_at is null or public.has_permission('events.write'))));

create function public.event_media_is_public(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.event_media m join public.events e on e.id=m.event_id where m.id=p_id and m.archived_at is null and e.is_public and ((e.status='upcoming' and e.event_date>=(now() at time zone 'Africa/Lagos')::date and m.is_banner) or (e.status='closed' and (m.is_banner or m.show_in_gallery))));
$$;
revoke execute on function public.event_media_is_public(uuid) from public,anon,authenticated;

create function public.public_events(p_view text default 'upcoming') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d jsonb;begin
 if p_view not in ('upcoming','gallery') or p_view is null then raise exception 'Choose upcoming events or gallery' using errcode='22023';end if;
 select jsonb_build_object('events',coalesce(jsonb_agg(jsonb_build_object(
  'id',e.id,'title',e.title,'event_date',e.event_date,'status',e.status,
  'public_location',e.public_location,'public_description',e.public_description,'closed_at',e.closed_at,
  'media',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'caption',m.caption,'alt_text',m.alt_text,'is_banner',m.is_banner) order by m.is_banner desc,m.created_at,m.id),'[]') from public.event_media m where m.event_id=e.id and public.event_media_is_public(m.id)))
  order by case when p_view='upcoming' then e.event_date end asc,case when p_view='gallery' then e.event_date end desc,e.id),'[]')) into d
 from public.events e where e.is_public and ((p_view='upcoming' and e.status='upcoming' and e.event_date>=(now() at time zone 'Africa/Lagos')::date) or (p_view='gallery' and e.status='closed'));
 return d;
end;$$;
revoke execute on function public.public_events(text) from public;
grant execute on function public.public_events(text) to anon,authenticated,service_role;

-- The server can sign only currently visible public media; paths stay out of feeds.
create function public.public_event_media(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.event_media;begin
 if auth.role()<>'service_role' then raise exception 'Server only' using errcode='42501';end if;
 if not public.event_media_is_public(p_id) then raise exception 'Public event image unavailable' using errcode='42501';end if;
 select * into m from public.event_media where id=p_id;return to_jsonb(m);
end;$$;
revoke execute on function public.public_event_media(uuid) from public,anon,authenticated;
grant execute on function public.public_event_media(uuid) to service_role;

create function public.event_media_list(p_event uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform public.require_permission('directory.read');return (select coalesce(jsonb_agg(to_jsonb(m) order by m.is_banner desc,m.created_at,m.id),'[]') from public.event_media m where event_id=p_event and (archived_at is null or public.has_permission('events.write')));end;$$;
create function public.event_media_access(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.event_media;begin
 perform public.require_permission('directory.read');select * into m from public.event_media where id=p_id and (archived_at is null or public.has_permission('events.write'));
 if not found then raise exception 'Event image unavailable' using errcode='42501';end if;return to_jsonb(m);
end;$$;
revoke execute on function public.event_media_list(uuid),public.event_media_access(uuid) from public,anon;
grant execute on function public.event_media_list(uuid),public.event_media_access(uuid) to authenticated;

-- Validated server uploads are bound to their actor, event and content hash.
create function public.commit_event_media(p_actor uuid,p_meta jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare eid uuid;path text;mime text;kind text;caption text;alt text;banner boolean;gallery boolean;m public.event_media;receipt public.command_receipts;hash text;result jsonb;
begin
 if auth.role()<>'service_role' or not public.has_permission_for(p_actor,'events.write') then raise exception 'Event upload denied' using errcode='42501';end if;
 if p_key is null or jsonb_typeof(p_meta) is distinct from 'object' or octet_length(p_meta::text)>12000 then raise exception 'Invalid event image operation';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_key::text,0));hash=md5('commit_event_media'||p_meta::text);
 select * into receipt from public.command_receipts where actor_id=p_actor and idempotency_key=p_key;
 if found then if receipt.request_hash<>hash then raise exception 'Retry key reused with different contents';end if;return receipt.result;end if;
 eid=(p_meta->>'event_id')::uuid;path=p_meta->>'path';mime=p_meta->>'mime_type';kind=p_meta->>'kind';caption=coalesce(p_meta->>'caption','');alt=coalesce(nullif(trim(p_meta->>'alt_text'),''),case when kind='poster' then 'Event poster' else 'Event photo' end);
 if kind is null or kind not in ('poster','photo') or length(caption)>1500 or length(alt)>300 or mime is null or mime not in ('image/png','image/jpeg','image/webp') or p_meta->>'byte_size' is null or (p_meta->>'byte_size')::integer not between 1 and 3145728 then raise exception 'Use a permitted event poster or photo';end if;
 if (p_meta ? 'is_banner' and jsonb_typeof(p_meta->'is_banner') is distinct from 'boolean') or (p_meta ? 'show_in_gallery' and jsonb_typeof(p_meta->'show_in_gallery') is distinct from 'boolean') then raise exception 'Choose image publication options';end if;
 banner=coalesce((p_meta->>'is_banner')::boolean,false);gallery=coalesce((p_meta->>'show_in_gallery')::boolean,false);
 if banner and kind<>'poster' then raise exception 'Only a poster can be the announcement banner';end if;
 if path is null or path !~ ('^'||p_actor::text||'/event/'||eid::text||'/[0-9a-f]{64}\.'||case mime when 'image/png' then 'png' when 'image/jpeg' then 'jpg' else 'webp' end||'$') then raise exception 'Image path does not match its actor, event and content hash' using errcode='42501';end if;
 perform id from public.events where id=eid for update;if not found then raise exception 'Event unavailable';end if;
 if not exists(select 1 from storage.objects where bucket_id='event-media' and name=path) then raise exception 'Upload the validated event image first';end if;
 select * into m from public.event_media where object_path=path;
 if found then
  raise exception 'This image is already attached; update the existing media.';
 else
  if banner then update public.event_media set is_banner=false,updated_at=now() where event_id=eid and is_banner and archived_at is null;end if;
  insert into public.event_media(event_id,object_path,mime_type,byte_size,kind,caption,alt_text,is_banner,show_in_gallery,uploaded_by) values(eid,path,mime,(p_meta->>'byte_size')::integer,kind,caption,alt,banner,gallery,p_actor) returning * into m;result=to_jsonb(m);
  insert into public.audit_events(actor_id,action,target_type,target_id,changes) values(p_actor,'event.media_attached','event',eid,jsonb_build_object('media_id',m.id,'kind',kind,'is_banner',banner,'show_in_gallery',gallery));
 end if;
 insert into public.command_receipts(actor_id,idempotency_key,request_hash,result) values(p_actor,p_key,hash,result);return result;
end;$$;
revoke execute on function public.commit_event_media(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.commit_event_media(uuid,jsonb,uuid) to service_role;

alter function public.execute_action(text,jsonb,uuid) rename to execute_action_v4;
revoke execute on function public.execute_action_v4(text,jsonb,uuid) from public,anon,authenticated;
create function public.execute_action(p_action text,p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid=auth.uid();pid uuid;eid uuid;e public.events;m public.event_media;receipt public.command_receipts;hash text;result jsonb;before_record jsonb;reason text;is_new boolean;banner boolean;gallery boolean;archive boolean;
begin
 if p_action not in ('save_event','close_event','set_event_publication','update_event_media') then return public.execute_action_v4(p_action,p_payload,p_key);end if;
 perform public.require_permission('events.write');
 if actor is null or p_key is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>65536 then raise exception 'Invalid authenticated event operation' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_key::text,0));hash=md5(p_action||p_payload::text);
 select * into receipt from public.command_receipts where actor_id=actor and idempotency_key=p_key;
 if found then if receipt.request_hash<>hash then raise exception 'Retry key reused with different contents';end if;return receipt.result;end if;
 pid=nullif(p_payload->>'id','')::uuid;reason=trim(coalesce(p_payload->>'reason',''));
 if p_action<>'save_event' and length(reason) not between 2 and 1500 then raise exception 'Provide an event publication or closure reason';end if;
 if p_action in ('save_event','set_event_publication') then
  if (p_payload ? 'is_public' and jsonb_typeof(p_payload->'is_public') is distinct from 'boolean') or (p_payload ? 'public_location' and jsonb_typeof(p_payload->'public_location') not in ('string','null')) or (p_payload ? 'public_description' and jsonb_typeof(p_payload->'public_description') not in ('string','null')) or length(coalesce(p_payload->>'public_location',''))>300 or length(coalesce(p_payload->>'public_description',''))>1500 then raise exception 'Review the public event copy and publication option';end if;
 end if;
 case p_action
 when 'save_event' then
  is_new=pid is null;
  if not is_new then select * into e from public.events where id=pid for update;if not found then raise exception 'Event unavailable';end if;before_record=jsonb_build_object('is_public',e.is_public,'public_location',e.public_location,'public_description',e.public_description);end if;
  result=public.execute_action_v4(p_action,p_payload,p_key);pid=(result->>'id')::uuid;
  update public.events set is_public=case when p_payload ? 'is_public' then (p_payload->>'is_public')::boolean when is_new then true else is_public end,public_location=case when p_payload ? 'public_location' then nullif(trim(p_payload->>'public_location'),'') else public_location end,public_description=case when p_payload ? 'public_description' then nullif(trim(p_payload->>'public_description'),'') else public_description end where id=pid returning to_jsonb(events) into result;
  perform public.log_action('event.publication_saved','event',pid,jsonb_build_object('reason',reason,'before',before_record,'after',jsonb_build_object('is_public',result->'is_public','public_location',result->'public_location','public_description',result->'public_description')));
  update public.command_receipts set result=result where actor_id=actor and idempotency_key=p_key;
  return result;
 when 'close_event' then
  select * into e from public.events where id=pid for update;if not found or e.status<>'upcoming' then raise exception 'Only an upcoming event can be closed';end if;
  update public.events set status='closed',closed_at=now(),updated_at=now() where id=pid returning to_jsonb(events) into result;
  perform public.log_action('event.closed','event',pid,jsonb_build_object('reason',reason,'is_public',e.is_public));
 when 'set_event_publication' then
  if not (p_payload ? 'is_public') then raise exception 'Choose whether to publish the event';end if;
  select * into e from public.events where id=pid for update;if not found then raise exception 'Event unavailable';end if;
  before_record=jsonb_build_object('is_public',e.is_public,'public_location',e.public_location,'public_description',e.public_description);
  update public.events set is_public=(p_payload->>'is_public')::boolean,public_location=case when p_payload ? 'public_location' then nullif(trim(p_payload->>'public_location'),'') else public_location end,public_description=case when p_payload ? 'public_description' then nullif(trim(p_payload->>'public_description'),'') else public_description end,updated_at=now() where id=pid returning to_jsonb(events) into result;
  perform public.log_action('event.publication_changed','event',pid,jsonb_build_object('reason',reason,'before',before_record,'after',jsonb_build_object('is_public',result->'is_public','public_location',result->'public_location','public_description',result->'public_description')));
 when 'update_event_media' then
  select event_id into eid from public.event_media where id=pid;if not found then raise exception 'Event image unavailable';end if;
  perform id from public.events where id=eid for update;
  select * into m from public.event_media where id=pid for update;
  if (p_payload ? 'is_banner' and jsonb_typeof(p_payload->'is_banner') is distinct from 'boolean') or (p_payload ? 'show_in_gallery' and jsonb_typeof(p_payload->'show_in_gallery') is distinct from 'boolean') or (p_payload ? 'archive' and jsonb_typeof(p_payload->'archive') is distinct from 'boolean') or length(coalesce(p_payload->>'caption',''))>1500 or length(coalesce(p_payload->>'alt_text',''))>300 then raise exception 'Review image captions and publication options';end if;
  banner=case when p_payload ? 'is_banner' then (p_payload->>'is_banner')::boolean else m.is_banner end;gallery=case when p_payload ? 'show_in_gallery' then (p_payload->>'show_in_gallery')::boolean else m.show_in_gallery end;archive=case when p_payload ? 'archive' then (p_payload->>'archive')::boolean else m.archived_at is not null end;
  if banner and m.kind<>'poster' then raise exception 'Only a poster can be the announcement banner';end if;
  before_record=jsonb_build_object('caption',m.caption,'alt_text',m.alt_text,'is_banner',m.is_banner,'show_in_gallery',m.show_in_gallery,'archived',m.archived_at is not null);
  if banner and not archive then update public.event_media set is_banner=false,updated_at=now() where event_id=eid and id<>pid and is_banner and archived_at is null;end if;
  update public.event_media set caption=case when p_payload ? 'caption' then coalesce(p_payload->>'caption','') else caption end,alt_text=case when p_payload ? 'alt_text' then coalesce(nullif(trim(p_payload->>'alt_text'),''),case when kind='poster' then 'Event poster' else 'Event photo' end) else alt_text end,is_banner=banner,show_in_gallery=gallery,archived_at=case when archive then coalesce(archived_at,now()) else null end,archive_reason=case when p_payload ? 'archive' then case when archive then reason else null end else archive_reason end,updated_at=now() where id=pid returning to_jsonb(event_media) into result;
  perform public.log_action('event.media_updated','event',eid,jsonb_build_object('reason',reason,'media_id',pid,'before',before_record,'after',jsonb_build_object('caption',result->'caption','alt_text',result->'alt_text','is_banner',result->'is_banner','show_in_gallery',result->'show_in_gallery','archived',archive)));
 end case;
 insert into public.command_receipts(actor_id,idempotency_key,request_hash,result) values(actor,p_key,hash,result);return result;
end;$$;
revoke execute on function public.execute_action(text,jsonb,uuid) from public,anon;
grant execute on function public.execute_action(text,jsonb,uuid) to authenticated;

alter function public.workspace_data(text,uuid) rename to workspace_data_v3;
revoke execute on function public.workspace_data_v3(text,uuid) from public,anon,authenticated;
create function public.workspace_data(p_area text,p_target uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d jsonb;begin d=public.workspace_data_v3(p_area,p_target);return d||jsonb_build_object('event_media',case when p_area='events' and p_target is not null then public.event_media_list(p_target) else '[]'::jsonb end);end;$$;
revoke execute on function public.workspace_data(text,uuid) from public,anon;
grant execute on function public.workspace_data(text,uuid) to authenticated;
commit;
