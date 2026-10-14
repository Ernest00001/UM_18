-- UM18: intentionally no grants for anonymous membership/finance access.
begin;
create table public.executive_accounts (
 id uuid primary key references auth.users(id), display_name text not null check(length(display_name) between 2 and 180),
 email text not null, active boolean not null default true, member_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.roles(code text primary key, label text not null);
create table public.permissions(code text primary key);
create table public.role_permissions(role_code text references public.roles,permission text references public.permissions,primary key(role_code,permission));
create table public.role_assignments(id uuid primary key default gen_random_uuid(),executive_id uuid not null references public.executive_accounts,role_code text not null references public.roles,starts_at timestamptz not null default now(),expires_at timestamptz,revoked_at timestamptz,assigned_by uuid references public.executive_accounts,created_at timestamptz not null default now(),check(expires_at is null or expires_at>starts_at));
create unique index one_live_role_assignment on public.role_assignments(executive_id,role_code) where revoked_at is null;
create table public.explicit_permissions(executive_id uuid references public.executive_accounts,permission text references public.permissions,expires_at timestamptz,primary key(executive_id,permission));
insert into public.roles values ('owner','Owner / system administrator'),('secretary','Membership executive / secretary'),('treasurer','Treasurer / finance officer'),('welfare','Welfare officer'),('read_only','Read-only executive');
insert into public.permissions(code) select unnest(array['directory.read','members.write','registrations.review','contacts.write','events.write','finance.read','finance.write','finance.export','directory.export','members.import','welfare.read','welfare.write','welfare.export','documents.write','settings.write','accounts.write','audit.read']);
insert into public.role_permissions select 'owner',code from public.permissions;
insert into public.role_permissions values ('secretary','directory.read'),('secretary','members.write'),('secretary','registrations.review'),('secretary','contacts.write'),('secretary','events.write'),('secretary','members.import'),('secretary','directory.export'),('secretary','documents.write'),('treasurer','directory.read'),('treasurer','finance.read'),('treasurer','finance.write'),('treasurer','finance.export'),('treasurer','documents.write'),('welfare','directory.read'),('welfare','welfare.read'),('welfare','welfare.write'),('welfare','documents.write'),('read_only','directory.read');
create table public.branding(id boolean primary key default true check(id),organisation_name text not null default 'Unmatched 18',short_name text not null default 'UM18',slogan text not null default 'semper ultra',cohort smallint not null default 2018 check(cohort=2018),school_name text,contact_email text,contact_phone text,logo_path text,version bigint not null default 1,updated_at timestamptz not null default now());
insert into public.branding(id) values(true);
create table public.private_settings(id boolean primary key default true check(id),document_limit_mb smallint not null default 3 check(document_limit_mb between 1 and 3),retention_review_months smallint not null default 24 check(retention_review_months between 1 and 120),mfa_required boolean not null default true check(mfa_required),updated_at timestamptz not null default now());
insert into public.private_settings(id) values(true);
create sequence public.member_number_seq;
create table public.members(
 id uuid primary key default gen_random_uuid(),member_no text not null unique,
 full_name text not null check(length(full_name) between 2 and 180),name_normalized text not null,
 phone_original text not null,phone_normalized text not null check(phone_normalized ~ '^\+[1-9][0-9]{6,14}$'),email text,
 city text not null,country text not null,region text,occupation text check(occupation is null or occupation in ('employed','student','self-employed','job-seeking','retired','other')),
 joined_year smallint check(joined_year between 1900 and 2018),skills text[] not null default '{}',details jsonb not null default '{}',
 membership_status text not null default 'active' check(membership_status in ('active','inactive')),internal_remarks text,
 verified_by uuid references public.executive_accounts,verified_at timestamptz not null default now(),last_contact_date date,
 archived_at timestamptz,archive_reason text,merged_into_member_id uuid references public.members,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(cardinality(skills)<=30),check(jsonb_typeof(details)='object'),check(octet_length(details::text)<16000)
);
alter table public.executive_accounts add constraint executive_member_fk foreign key(member_id) references public.members;
create index members_name on public.members(name_normalized);
create index members_phone on public.members(phone_normalized);
create index members_location on public.members(country,city);
create index members_skills on public.members using gin(skills);
create index members_career on public.members(occupation,joined_year);
create table public.membership_submissions(id uuid primary key default gen_random_uuid(),reference uuid not null unique default gen_random_uuid(),idempotency_key uuid not null unique,payload_hash text not null,payload jsonb not null,review_status text not null default 'pending' check(review_status in ('pending','approved','linked','rejected')),possible_duplicate_ids uuid[] not null default '{}',member_id uuid references public.members,reason text,reviewed_by uuid references public.executive_accounts,reviewed_at timestamptz,created_at timestamptz not null default now(),check(octet_length(payload::text)<24000));
create index submissions_review on public.membership_submissions(review_status,created_at);
create table public.member_history(id uuid primary key default gen_random_uuid(),member_id uuid not null references public.members,actor_id uuid references public.executive_accounts,reason text not null,old_record jsonb,new_record jsonb,created_at timestamptz not null default now());
create table public.contact_history(id uuid primary key default gen_random_uuid(),member_id uuid not null references public.members,contact_date date not null,channel text not null check(channel in ('phone','whatsapp','email','in_person','other')),notes text not null check(length(notes)<=1500),recorded_by uuid not null references public.executive_accounts,created_at timestamptz not null default now());
create index contacts_member_date on public.contact_history(member_id,contact_date desc);
create table public.contribution_collections(id uuid primary key default gen_random_uuid(),title text not null check(length(title) between 2 and 180),purpose text not null check(length(purpose) between 2 and 1500),category text not null check(category in ('monthly','event','project','welfare','donation')),period text check(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),event_date date,participation text not null check(participation in ('compulsory','voluntary')),amount_kobo bigint check(amount_kobo between 0 and 100000000000),target_kobo bigint check(target_kobo between 1 and 100000000000),deadline date,status text not null default 'draft' check(status in ('draft','open','closed')),created_by uuid references public.executive_accounts,published_at timestamptz,closed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(category<>'monthly' or period is not null));
create index collections_period on public.contribution_collections(period,category,status);
create table public.member_assessments(id uuid primary key default gen_random_uuid(),member_id uuid not null references public.members,collection_id uuid not null references public.contribution_collections,expected_kobo bigint not null check(expected_kobo between 0 and 100000000000),waiver_kobo bigint not null default 0 check(waiver_kobo>=0 and waiver_kobo<=expected_kobo),reason text,superseded_by uuid references public.member_assessments,created_by uuid references public.executive_accounts,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(member_id,collection_id));
create table public.assessment_history(id uuid primary key default gen_random_uuid(),assessment_id uuid not null references public.member_assessments,actor_id uuid references public.executive_accounts,old_expected_kobo bigint,old_waiver_kobo bigint,new_expected_kobo bigint not null,new_waiver_kobo bigint not null,reason text not null,created_at timestamptz not null default now());
create table public.payments(id uuid primary key default gen_random_uuid(),member_id uuid not null references public.members,original_member_id uuid not null references public.members,amount_kobo bigint not null check(amount_kobo between 1 and 100000000000),currency text not null default 'NGN' check(currency='NGN'),payment_date date not null,method text not null check(method in ('bank_transfer','cash','other')),reference text not null,external_reference text,status text not null default 'pending' check(status in ('pending','confirmed','rejected','reversed')),recorded_by uuid not null references public.executive_accounts,verified_by uuid references public.executive_accounts,verified_at timestamptz,verification_note text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create unique index unique_transfer_reference on public.payments(lower(external_reference)) where method='bank_transfer' and external_reference is not null;
create index payments_date on public.payments(payment_date,status);
create index payments_member on public.payments(member_id,payment_date);
create table public.financial_adjustments(id uuid primary key default gen_random_uuid(),payment_id uuid not null references public.payments,delta_kobo bigint not null check(delta_kobo<>0 and delta_kobo between -100000000000 and 100000000000),kind text not null check(kind in ('refund','correction')),reason text not null check(length(reason) between 2 and 1500),actor_id uuid not null references public.executive_accounts,created_at timestamptz not null default now(),check(kind<>'refund' or delta_kobo<0));
create table public.payment_allocations(id uuid primary key default gen_random_uuid(),payment_id uuid not null references public.payments,member_id uuid not null references public.members,collection_id uuid not null references public.contribution_collections,amount_kobo bigint not null check(amount_kobo between 1 and 100000000000),created_by uuid references public.executive_accounts,created_at timestamptz not null default now(),unique(payment_id,collection_id));
create index allocations_collection_member on public.payment_allocations(collection_id,member_id);
create table public.allocation_history(id uuid primary key default gen_random_uuid(),payment_id uuid not null references public.payments,old_allocations jsonb not null,new_allocations jsonb not null,actor_id uuid not null references public.executive_accounts,reason text not null,created_at timestamptz not null default now());
create table public.expenses(id uuid primary key default gen_random_uuid(),collection_id uuid not null references public.contribution_collections,expense_date date not null,description text not null check(length(description) between 2 and 1500),payee text not null,amount_kobo bigint not null check(amount_kobo between 1 and 100000000000),status text not null default 'pending' check(status in ('pending','approved','rejected','reversed')),recorded_by uuid not null references public.executive_accounts,approved_by uuid references public.executive_accounts,approved_at timestamptz,reason text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index expenses_collection_date on public.expenses(collection_id,expense_date,status);
create table public.events(id uuid primary key default gen_random_uuid(),title text not null,event_date date not null,location text not null,description text,collection_id uuid references public.contribution_collections,created_by uuid references public.executive_accounts,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.event_attendance(id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events,member_id uuid not null references public.members,status text not null check(status in ('present','absent','excused','not_recorded')),recorded_by uuid references public.executive_accounts,updated_at timestamptz not null default now(),unique(event_id,member_id));
create sequence public.welfare_number_seq;
create table public.welfare_cases(id uuid primary key default gen_random_uuid(),case_no text not null unique,member_id uuid not null references public.members,category text not null,description text not null check(length(description)<=1500),status text not null default 'open' check(status in ('open','in_progress','closed')),assigned_to uuid not null references public.executive_accounts,opened_date date not null,closed_date date,actions text,expense_id uuid references public.expenses,created_by uuid references public.executive_accounts,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(closed_date is null or closed_date>=opened_date));
create index welfare_assignment on public.welfare_cases(assigned_to,status);
create table public.documents(id uuid primary key default gen_random_uuid(),title text not null,scope text not null check(scope in ('general','member','collection','payment','expense','welfare')),target_id uuid,bucket text not null default 'private-documents' check(bucket='private-documents'),object_path text not null unique,mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp','application/pdf')),byte_size integer not null check(byte_size between 1 and 3145728),uploaded_by uuid not null references public.executive_accounts,created_at timestamptz not null default now(),check((scope='general' and target_id is null) or (scope<>'general' and target_id is not null)));
create table public.audit_events(id uuid primary key default gen_random_uuid(),actor_id uuid references public.executive_accounts,action text not null,target_type text not null,target_id uuid,changes jsonb not null default '{}',created_at timestamptz not null default now());
create index audit_created on public.audit_events(created_at desc);
create table public.command_receipts(actor_id uuid references public.executive_accounts,idempotency_key uuid not null,request_hash text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,idempotency_key));
create table public.registration_rate_limits(key_hash text not null,window_start timestamptz not null,count integer not null default 1,primary key(key_hash,window_start));

create function public.has_permission_for(p_actor uuid,p_permission text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.executive_accounts a where a.id=p_actor and a.active and (
 exists(select 1 from public.role_assignments r join public.role_permissions p on p.role_code=r.role_code where r.executive_id=a.id and p.permission=p_permission and r.revoked_at is null and r.starts_at<=now() and (r.expires_at is null or r.expires_at>now()))
 or exists(select 1 from public.explicit_permissions e where e.executive_id=a.id and e.permission=p_permission and (e.expires_at is null or e.expires_at>now()))));
$$;
create function public.has_permission(p_permission text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'aal','aal1')='aal2' and public.has_permission_for(auth.uid(),p_permission);
$$;
create function public.require_permission(p_permission text) returns void language plpgsql security definer set search_path='' as $$
 begin if not public.has_permission(p_permission) then raise exception 'Access denied: current permission and multifactor verification required' using errcode='42501';end if;end;
$$;
create function public.current_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare a public.executive_accounts;rs jsonb;ps jsonb;
 begin select * into a from public.executive_accounts where id=auth.uid() and active;
 if not found or not exists(select 1 from public.role_assignments where executive_id=a.id and revoked_at is null and starts_at<=now() and (expires_at is null or expires_at>now())) then raise exception 'Account unavailable' using errcode='42501';end if;
 if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then return jsonb_build_object('id',a.id,'display_name',a.display_name,'needs_mfa',true,'permissions','[]'::jsonb);end if;
 select coalesce(jsonb_agg(role_code),'[]') into rs from public.role_assignments where executive_id=a.id and revoked_at is null and starts_at<=now() and (expires_at is null or expires_at>now());
 select coalesce(jsonb_agg(code),'[]') into ps from public.permissions where public.has_permission(code);
 return jsonb_build_object('id',a.id,'display_name',a.display_name,'email',a.email,'roles',rs,'permissions',ps,'needs_mfa',false);end;
$$;
create function public.log_action(p_action text,p_type text,p_target uuid,p_changes jsonb default '{}') returns void language sql security definer set search_path='' as $$ insert into public.audit_events(actor_id,action,target_type,target_id,changes) values(auth.uid(),p_action,p_type,p_target,case when p_type='welfare' then jsonb_build_object('redacted',true) else p_changes end); $$;
create function public.guard_owners() returns trigger language plpgsql security definer set search_path='' as $$
 begin perform pg_advisory_xact_lock(18018);
 if exists(select 1 from public.executive_accounts) and not exists(select 1 from public.role_assignments r join public.executive_accounts a on a.id=r.executive_id where a.active and r.role_code='owner' and r.revoked_at is null and r.starts_at<=now() and r.expires_at is null) then raise exception 'At least one active owner without expiry must remain' using errcode='23514';end if;return null;end;
$$;
create constraint trigger accounts_guard after insert or update or delete on public.executive_accounts deferrable initially deferred for each row execute function public.guard_owners();
create constraint trigger roles_guard after insert or update or delete on public.role_assignments deferrable initially deferred for each row execute function public.guard_owners();
create function public.net_payment(p_id uuid) returns bigint language sql stable security definer set search_path='' as $$ select case when p.status='confirmed' then p.amount_kobo+coalesce((select sum(a.delta_kobo) from public.financial_adjustments a where a.payment_id=p.id),0)::bigint else 0 end from public.payments p where p.id=p_id; $$;
create function public.check_financial_invariants() returns trigger language plpgsql security definer set search_path='' as $$
 declare pid uuid;p public.payments;net bigint;used bigint;
 begin if tg_table_name='payments' then pid=coalesce(new.id,old.id);else pid=coalesce(new.payment_id,old.payment_id);end if;
 select * into p from public.payments where id=pid for update;if not found then return null;end if;
 if exists(select 1 from public.payment_allocations a join public.contribution_collections c on c.id=a.collection_id where a.payment_id=pid and (a.member_id<>p.member_id or c.status='draft' or (c.participation='compulsory' and not exists(select 1 from public.member_assessments s where s.collection_id=c.id and s.member_id=p.member_id)))) then raise exception 'Invalid allocation relationship' using errcode='23514';end if;
 if p.status in ('pending','rejected') and exists(select 1 from public.payment_allocations where payment_id=pid) then raise exception 'Unconfirmed payments cannot be allocated' using errcode='23514';end if;
 if p.status='confirmed' then net=public.net_payment(pid);select coalesce(sum(amount_kobo),0) into used from public.payment_allocations where payment_id=pid;if net<0 or net>100000000000 or used>net then raise exception 'Allocations exceed available confirmed funds' using errcode='23514';end if;end if;return null;end;
$$;
create constraint trigger payment_balance after insert or update on public.payments deferrable initially deferred for each row execute function public.check_financial_invariants();
create constraint trigger allocation_balance after insert or update or delete on public.payment_allocations deferrable initially deferred for each row execute function public.check_financial_invariants();
create constraint trigger adjustment_balance after insert on public.financial_adjustments deferrable initially deferred for each row execute function public.check_financial_invariants();
create function public.guard_payment_transition() returns trigger language plpgsql set search_path='' as $$
 begin if new.original_member_id<>old.original_member_id then raise exception 'Original member identity is immutable';end if;if (new.amount_kobo,new.currency,new.payment_date,new.method,new.reference) is distinct from (old.amount_kobo,old.currency,old.payment_date,old.method,old.reference) or (new.member_id<>old.member_id and coalesce(current_setting('um18.member_merge',true),'')<>'yes') then raise exception 'Original payment fields are immutable; record a documented adjustment';end if;
 if new.status<>old.status and not ((old.status='pending' and new.status in ('confirmed','rejected')) or (old.status='confirmed' and new.status='reversed')) then raise exception 'Payment transition is not allowed';end if;return new;end;
$$;
create trigger payment_transition before update on public.payments for each row execute function public.guard_payment_transition();
create function public.guard_expense_transition() returns trigger language plpgsql set search_path='' as $$begin if old.status<>'pending' and (new.amount_kobo,new.collection_id,new.expense_date,new.payee,new.description) is distinct from (old.amount_kobo,old.collection_id,old.expense_date,old.payee,old.description) then raise exception 'Approved expense fields are immutable';end if;if new.status<>old.status and not ((old.status='pending' and new.status in ('approved','rejected')) or (old.status='approved' and new.status='reversed')) then raise exception 'Expense transition is not allowed';end if;return new;end;$$;
create trigger expense_transition before update on public.expenses for each row execute function public.guard_expense_transition();
create function public.can_access_document(p_scope text,p_target uuid,p_write boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select case
 when p_scope='general' then public.has_permission(case when p_write then 'documents.write' else 'directory.read' end)
 when p_scope='member' then public.has_permission('members.write') and exists(select 1 from public.members where id=p_target)
 when p_scope='collection' then public.has_permission(case when p_write then 'finance.write' else 'finance.read' end) and exists(select 1 from public.contribution_collections where id=p_target)
 when p_scope='payment' then public.has_permission(case when p_write then 'finance.write' else 'finance.read' end) and exists(select 1 from public.payments where id=p_target)
 when p_scope='expense' then public.has_permission(case when p_write then 'finance.write' else 'finance.read' end) and exists(select 1 from public.expenses where id=p_target)
 when p_scope='welfare' then public.has_permission(case when p_write then 'welfare.write' else 'welfare.read' end) and exists(select 1 from public.welfare_cases where id=p_target and assigned_to=auth.uid())
 else false end and (not p_write or public.has_permission('documents.write'));
$$;
-- All tables use RLS; only safe public branding has an anonymous SELECT grant.
do $$declare t text;begin foreach t in array array['executive_accounts','roles','permissions','role_permissions','role_assignments','explicit_permissions','branding','private_settings','members','membership_submissions','member_history','contact_history','contribution_collections','member_assessments','payments','financial_adjustments','payment_allocations','assessment_history','allocation_history','expenses','events','event_attendance','welfare_cases','documents','audit_events','command_receipts','registration_rate_limits'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon, authenticated',t);end loop;end;$$;
create policy public_branding on public.branding for select to anon,authenticated using(true);
grant select on public.branding to anon,authenticated;
-- Direct membership table reads require the secretary's permission; the directory RPC projects safe fields.
create policy secretary_members on public.members for select to authenticated using(public.has_permission('members.write'));
grant select on public.members to authenticated;
create policy registrations_read on public.membership_submissions for select to authenticated using(public.has_permission('registrations.review'));
grant select on public.membership_submissions to authenticated;
create policy member_history_read on public.member_history for select to authenticated using(public.has_permission('members.write'));
grant select on public.member_history to authenticated;
create policy contact_read on public.contact_history for select to authenticated using(public.has_permission('members.write'));
grant select on public.contact_history to authenticated;
do $$declare t text;begin foreach t in array array['contribution_collections','member_assessments','payments','financial_adjustments','payment_allocations','assessment_history','allocation_history','expenses'] loop execute format('create policy finance_read on public.%I for select to authenticated using(public.has_permission(''finance.read''))',t);execute format('grant select on public.%I to authenticated',t);end loop;end;$$;
create policy events_read on public.events for select to authenticated using(public.has_permission('directory.read'));
create policy attendance_read on public.event_attendance for select to authenticated using(public.has_permission('directory.read'));
grant select on public.events,public.event_attendance to authenticated;
create policy welfare_assigned_read on public.welfare_cases for select to authenticated using(public.has_permission('welfare.read') and assigned_to=auth.uid());
grant select on public.welfare_cases to authenticated;
create policy documents_scoped_read on public.documents for select to authenticated using(public.can_access_document(scope,target_id));
grant select on public.documents to authenticated;
create policy accounts_read on public.executive_accounts for select to authenticated using(public.has_permission('accounts.write'));
create policy audit_read on public.audit_events for select to authenticated using(public.has_permission('audit.read'));
create policy settings_read on public.private_settings for select to authenticated using(public.has_permission('settings.write'));
grant select on public.executive_accounts,public.audit_events,public.private_settings to authenticated;
-- No client INSERT/UPDATE/DELETE policies. Writes use only explicitly granted, authorised RPCs.
revoke all on all sequences in schema public from anon,authenticated;
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.has_permission(text),public.current_context(),public.can_access_document(text,uuid,boolean) to authenticated;
grant select on public.branding to service_role;
commit;
