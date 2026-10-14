begin;
create function public.audit_projection(p_event jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare action text=p_event->>'action';scope text=p_event->'changes'->>'scope';restricted boolean=false;begin
 if p_event->>'target_type'='welfare' then return jsonb_set(p_event,'{changes}','{"redacted":true}');end if;
 if action ~ '(payment|allocation|collection|assessment|expense)' or scope in ('payment','collection','expense','finance') then restricted=not public.has_permission('finance.read');
 elsif action ~ '(member|import|contact)' or scope='member' then restricted=not public.has_permission('members.write');
 elsif action ~ 'submission' then restricted=not public.has_permission('registrations.review');end if;
 if restricted then return jsonb_set(p_event,'{changes}','{"restricted":true}');end if;return p_event;
end;$$;
-- Direct table reads omit rows whose change payload is outside the caller's authority.
alter policy audit_read on public.audit_events using(public.has_permission('audit.read') and not (public.audit_projection(to_jsonb(audit_events))->'changes' ? 'restricted'));
alter function public.workspace_data(text,uuid) rename to workspace_data_v1;
create function public.workspace_data(p_area text,p_target uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$declare d jsonb;begin d=public.workspace_data_v1(p_area,p_target);if p_area='audit' then d=jsonb_set(d,'{audit}',(select coalesce(jsonb_agg(public.audit_projection(x)),'[]') from jsonb_array_elements(d->'audit')x));end if;return d;end;$$;
alter function public.workspace_snapshot() rename to workspace_snapshot_v2;
create function public.workspace_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$declare d jsonb;begin d=public.workspace_snapshot_v2();d=jsonb_set(d,'{audit}',(select coalesce(jsonb_agg(public.audit_projection(x)),'[]') from jsonb_array_elements(d->'audit')x));return d;end;$$;
revoke execute on function public.workspace_data_v1(text,uuid),public.workspace_snapshot_v2(),public.audit_projection(jsonb),public.workspace_data(text,uuid),public.workspace_snapshot() from public,anon,authenticated;
-- Policy evaluation needs the projection helper; it reveals no table data by itself.
grant execute on function public.audit_projection(jsonb),public.workspace_data(text,uuid),public.workspace_snapshot() to authenticated;
commit;
