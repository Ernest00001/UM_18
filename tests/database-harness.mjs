import {PGlite} from '@electric-sql/pglite';import {readFile,readdir} from 'node:fs/promises';
export const OWNER='10000000-0000-4000-8000-000000000001',READER='10000000-0000-4000-8000-000000000002',FINANCE='10000000-0000-4000-8000-000000000003',WELFARE='10000000-0000-4000-8000-000000000004';
export async function database({migrationsLimit}={}){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
 create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user)$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text,metadata jsonb default '{}');
 alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to anon,authenticated,service_role;
 grant select on storage.objects to authenticated;
 grant all on storage.buckets,storage.objects,auth.users to service_role;
 `);
 const migrations=(await readdir('supabase/migrations')).sort();
 for(const name of migrationsLimit===undefined?migrations:migrations.slice(0,migrationsLimit))await db.exec(await readFile('supabase/migrations/'+name,'utf8'));
 await db.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6),($7,$8)',[OWNER,'owner@example.invalid',READER,'reader@example.invalid',FINANCE,'finance@example.invalid',WELFARE,'welfare@example.invalid']);
 await role(db,'service_role',null);await db.query('select public.bootstrap_owner($1,$2,$3)',[OWNER,'Test Owner','owner@example.invalid']);
 for(const [id,name,r] of [[READER,'Test Reader','read_only'],[FINANCE,'Test Treasurer','treasurer'],[WELFARE,'Test Welfare','welfare']])await db.query('select public.provision_invited_account($1,$2,$3,$4,$5::jsonb,$6::jsonb,null,null,$7)',[OWNER,id,name,name.toLowerCase().replaceAll(' ','')+'@example.invalid',JSON.stringify([r]),'[]','Test invitation']);
 await role(db,'authenticated',OWNER);return db;
}
export async function role(db,name,id,aal='aal2'){await db.exec('reset role');if(id&&name==='authenticated')await db.query('insert into auth.sessions(id,user_id) values($1,$1) on conflict do nothing',[id]);await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false),set_config('request.jwt.claim.role',$3,false)",[id||'',JSON.stringify({sub:id,aal,role:name,session_id:id,iat:Math.floor(Date.now()/1000)}),name]);await db.exec('set role '+name);}
const requestKeys=new WeakMap();
export async function action(db,name,payload,key=crypto.randomUUID()){
 let keys=requestKeys.get(db);if(!keys){keys=new Map();requestKeys.set(db,keys);}
 let p={...payload};
 if(['allocate_payment','adjust_payment','transition_payment','correct_payment'].includes(name)&&p.expected_revision===undefined){
  if(keys.has(key))p.expected_revision=keys.get(key);
  else {p.expected_revision=(await db.query('select revision from public.payments where id=$1',[p.id])).rows[0]?.revision;keys.set(key,p.expected_revision);}
 }
 return (await db.query('select public.execute_action($1,$2::jsonb,$3) as result',[name,JSON.stringify(p),key])).rows[0].result;
}
