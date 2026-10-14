-- A linked replacement represents the same external receipt, including prior refunds.
begin;
alter table public.payments add column reversed_by uuid references public.executive_accounts,add column reversed_at timestamptz,add column reversal_note text;
alter table public.financial_adjustments add column carried_from_adjustment_id uuid references public.financial_adjustments;
create unique index adjustment_carried_once on public.financial_adjustments(payment_id,carried_from_adjustment_id) where carried_from_adjustment_id is not null;
create table public.payment_status_history(id uuid primary key default gen_random_uuid(),payment_id uuid not null references public.payments,old_status text,new_status text not null,actor_id uuid not null references public.executive_accounts,reason text not null,effective_date date not null,operation_key uuid,created_at timestamptz not null default now());
alter table public.payment_status_history enable row level security;
create policy payment_status_read on public.payment_status_history for select to authenticated using(public.has_permission('finance.read'));
grant select on public.payment_status_history to authenticated;
revoke all on public.payment_status_history from anon;
create or replace function public.guard_payment_transition() returns trigger language plpgsql set search_path='' as $$
begin
 if new.original_member_id<>old.original_member_id or (new.amount_kobo,new.currency) is distinct from (old.amount_kobo,old.currency) then raise exception 'Original identity and receipt amount are immutable';end if;
 if coalesce(current_setting('um18.payment_correction',true),'')<>'yes' and ((new.payment_date,new.method,new.reference,new.external_reference) is distinct from (old.payment_date,old.method,old.reference,old.external_reference) or (new.member_id<>old.member_id and coalesce(current_setting('um18.member_merge',true),'')<>'yes')) then raise exception 'Use an audited payment correction';end if;
 if new.status<>old.status then
 if not ((old.status='pending' and new.status in ('confirmed','rejected')) or (old.status='confirmed' and new.status='reversed')) then raise exception 'Payment transition is not allowed';end if;
 if new.status='reversed' then new.reversed_by=auth.uid();new.reversed_at=now();new.reversal_note=new.verification_note;new.verified_by=old.verified_by;new.verified_at=old.verified_at;new.verification_note=old.verification_note;end if;
 end if;return new;
end;$$;
create function public.capture_payment_status() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or new.status<>old.status then insert into public.payment_status_history(payment_id,old_status,new_status,actor_id,reason,effective_date,operation_key)
 values(new.id,case when tg_op='UPDATE' then old.status end,new.status,coalesce(auth.uid(),new.recorded_by),coalesce(case when new.status='reversed' then new.reversal_note else new.verification_note end,'Record created'),coalesce(nullif(current_setting('um18.financial_effective_date',true),'')::date,new.payment_date),nullif(current_setting('um18.financial_operation',true),'')::uuid);end if;return new;
end;$$;
create trigger payment_status_capture after insert or update of status on public.payments for each row execute function public.capture_payment_status();
revoke execute on function public.capture_payment_status() from public,anon,authenticated;

alter function public.execute_action(text,jsonb,uuid) rename to execute_action_v2;
revoke execute on function public.execute_action_v2(text,jsonb,uuid) from public,anon,authenticated;
create function public.execute_action(p_action text,p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid=auth.uid();parent public.payments;pay public.payments;receipt public.command_receipts;hash text=md5(p_action||p_payload::text);result jsonb;reason text=trim(coalesce(p_payload->>'reason',''));effective date=coalesce(nullif(p_payload->>'effective_date','')::date,case when p_action='record_payment' then (p_payload->>'payment_date')::date else (now() at time zone 'Africa/Lagos')::date end);
begin
 perform set_config('um18.financial_operation',coalesce(p_key::text,''),true);perform set_config('um18.financial_effective_date',effective::text,true);
 if p_action<>'record_payment' or nullif(p_payload->>'replaces_payment_id','') is null then return public.execute_action_v2(p_action,p_payload,p_key);end if;
 perform public.require_permission('finance.write');if actor is null or p_key is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536 or length(reason)<2 then raise exception 'Invalid replacement operation';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_key::text,0));select * into receipt from public.command_receipts where actor_id=actor and idempotency_key=p_key;
 if found then if receipt.request_hash<>hash then raise exception 'Retry key reused with different contents';end if;return receipt.result;end if;
 select * into parent from public.payments where id=(p_payload->>'replaces_payment_id')::uuid for update;if not found or parent.status not in ('reversed','rejected') then raise exception 'Only a reversed or rejected record can be replaced';end if;
 if p_payload->>'method'='bank_transfer' and nullif(trim(p_payload->>'reference'),'') is not null and exists(
 with recursive lineage as (select parent.id id,parent.replaces_payment_id ancestor union all select p.id,p.replaces_payment_id from public.payments p join lineage l on p.id=l.ancestor)
 select 1 from public.payments p where p.method='bank_transfer' and lower(p.external_reference)=lower(trim(p_payload->>'reference')) and p.status in ('reversed','rejected') and p.id not in(select id from lineage)) then raise exception 'Reference belongs to another preserved receipt. Review its identity before replacement';end if;
 if not exists(select 1 from public.members where id=(p_payload->>'member_id')::uuid and archived_at is null) then raise exception 'Member unavailable';end if;
 insert into public.payments(member_id,original_member_id,amount_kobo,payment_date,method,reference,external_reference,status,recorded_by,verified_by,verified_at,verification_note,replaces_payment_id)
 values((p_payload->>'member_id')::uuid,(p_payload->>'member_id')::uuid,(p_payload->>'amount_kobo')::bigint,(p_payload->>'payment_date')::date,p_payload->>'method',coalesce(nullif(trim(p_payload->>'reference'),''),case when p_payload->>'method'='cash' then 'CASH-' else 'PAY-' end||upper(substr(gen_random_uuid()::text,1,8))),nullif(trim(p_payload->>'reference'),''),case when coalesce((p_payload->>'verified')::boolean,false) then 'confirmed' else 'pending' end,actor,case when (p_payload->>'verified')::boolean then actor end,case when (p_payload->>'verified')::boolean then now() end,reason,parent.id) returning * into pay;
 insert into public.financial_adjustments(payment_id,delta_kobo,kind,reason,actor_id,created_at,effective_date,operation_key,carried_from_adjustment_id)
 select pay.id,delta_kobo,kind,reason,actor_id,created_at,effective_date,p_key,coalesce(carried_from_adjustment_id,id) from public.financial_adjustments where payment_id=parent.id;
 if pay.amount_kobo+(select coalesce(sum(delta_kobo),0) from public.financial_adjustments where payment_id=pay.id)<0 then raise exception 'Replacement amount is below preserved refunds and corrections';end if;
 if pay.status='confirmed' then perform public.replace_allocations(pay.id,coalesce(p_payload->'allocations','[]'),reason);end if;
 update public.allocation_history set operation_key=p_key,movement_kind='replacement_allocation',effective_date=effective where payment_id=pay.id;
 result=to_jsonb(pay);perform public.log_action('payment.replaced','payment',pay.id,jsonb_build_object('reason',reason,'replaces_payment_id',parent.id));
 insert into public.command_receipts(actor_id,idempotency_key,request_hash,result) values(actor,p_key,hash,result);return result;
end;$$;
revoke execute on function public.execute_action(text,jsonb,uuid) from public,anon;
grant execute on function public.execute_action(text,jsonb,uuid) to authenticated;
alter function public.record_history(text,uuid) rename to record_history_v1;
revoke execute on function public.record_history_v1(text,uuid) from public,anon,authenticated;
create function public.record_history(p_scope text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare d jsonb;begin d=public.record_history_v1(p_scope,p_id);if p_scope='payment' then d=d||jsonb_build_object('statuses',(select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') from public.payment_status_history t where payment_id=p_id));end if;return d;end;$$;
revoke execute on function public.record_history(text,uuid) from public,anon;
grant execute on function public.record_history(text,uuid) to authenticated;
commit;
