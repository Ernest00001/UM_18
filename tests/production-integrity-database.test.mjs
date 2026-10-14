import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {database,role,action,OWNER,READER} from './database-harness.mjs';
const migration='supabase/migrations/202610140017_production_integrity.sql';
const member=db=>action(db,'save_member',{full_name:'Integrity test member',phone_original:'08012345678',city:'Uyo',country:'Nigeria',skills:[],reason:'Approved isolated test member'});
const receipt=(db,m,parent)=>action(db,'record_payment',{member_id:m.id,amount_kobo:100000,payment_date:'2026-10-14',method:'cash',verified:true,reason:'Externally checked test receipt',allocations:[],...(parent?{replaces_payment_id:parent.id}:{})});

test('replacement chains retain one active receipt, preserve retry and reject earlier parents',async()=>{
 const db=await database();try{
  const m=await member(db),first=await receipt(db,m);await action(db,'transition_payment',{id:first.id,status:'reversed',reason:'Correct preserved receipt'});
  const key=crypto.randomUUID(),payload={member_id:m.id,amount_kobo:100000,payment_date:'2026-10-14',method:'cash',verified:true,reason:'Reviewed replacement',allocations:[],replaces_payment_id:first.id};
  const second=await action(db,'record_payment',payload,key);assert.equal((await action(db,'record_payment',payload,key)).id,second.id);
  await action(db,'transition_payment',{id:second.id,status:'reversed',reason:'Correct latest preserved receipt'});const third=await receipt(db,m,second);
  await assert.rejects(receipt(db,m,first),/latest receipt|already has a replacement/);
  assert.equal(third.receipt_root_id,first.id);const summary=(await db.query("select public.executive_accountability('2026-10-01','2026-10-31') d")).rows[0].d;assert.equal(summary.totals.receipts_kobo,100000);
  const old=(await db.query('select public.workspace_data($1,$2) d',['payments',first.id])).rows[0].d.payments[0];assert.equal(old.replacement_available,false);assert.equal(old.replacement_id,second.id);
  await action(db,'transition_payment',{id:third.id,status:'reversed',reason:'Preserve final correction'});await assert.rejects(receipt(db,m,first),/latest receipt|already has a replacement/);await receipt(db,m,third);
  await role(db,'anon',null);await assert.rejects(db.query('select public.guard_receipt_lineage()'),/permission denied/);
 }finally{await db.close();}
});

test('document replacements reject stale bases and keep identical retries and complete history',async()=>{
 const db=await database();try{
  for(const name of ['base','next','stale','latest']){await db.exec('reset role');await db.query("insert into storage.objects(bucket_id,name) values('private-documents',$1)",[OWNER+'/general/general/'+name+'.pdf']);await role(db,'authenticated',OWNER);}
  const save=async(name,previous)=>(await db.query('select public.commit_document_v2($1::jsonb) d',[JSON.stringify({title:name,scope:'general',path:OWNER+'/general/general/'+name+'.pdf',mime_type:'application/pdf',byte_size:100,...(previous?{previous_version_id:previous.id}:{})})])).rows[0].d;
  const base=await save('base'),next=await save('next',base);assert.equal((await save('next',base)).id,next.id);await assert.rejects(save('stale',base),/Document changed/);
  const latest=await save('latest',next);assert.equal(latest.version,3);assert.equal((await db.query('select count(*) n from public.documents where archived_at is null')).rows[0].n,1);assert.equal((await db.query('select count(*) n from public.documents')).rows[0].n,3);
 }finally{await db.close();}
});

test('every executive area loads through the production workspace contract and assessment links stay permission scoped',async()=>{
 const db=await database();try{
  const m=await member(db),fund=await action(db,'save_collection',{title:'Test October dues',purpose:'Assessment route',category:'monthly',period:'2026-10',participation:'compulsory',amount_kobo:100000});await action(db,'publish_collection',{id:fund.id,member_ids:[m.id],reason:'Approved test assessment'});
  const assessment=(await db.query('select * from public.member_assessments where collection_id=$1',[fund.id])).rows[0];await action(db,'adjust_assessment',{id:assessment.id,expected_kobo:100000,waiver_kobo:10000,reason:'Reviewed assessment waiver'});
  for(const area of ['overview','office-reports','registrations','members','monthly','special','payments','expenses','events','welfare','contacts','documents','reports','branding','accounts','audit'])assert.ok((await db.query('select public.workspace_data($1,null) d',[area])).rows[0].d);
  const audit=(await db.query("select public.workspace_data('audit',null) d")).rows[0].d;assert.deepEqual(audit.assessments,[]);const entry=audit.audit.find(a=>a.action.includes('assessment'));assert.ok(entry);assert.equal(entry.assessment_collection_id,fund.id);
  await action(db,'save_account',{id:READER,display_name:'Audit-only reader',active:true,roles:['read_only'],permissions:['audit.read'],reason:'Review projected audit'});await role(db,'authenticated',READER);
  const limited=(await db.query("select public.workspace_data('audit',null) d")).rows[0].d;assert.ok(limited.audit.every(a=>!Object.hasOwn(a,'assessment_collection_id')));assert.deepEqual(limited.payments,[]);assert.ok((await db.query("select public.workspace_data('office-reports',null) d")).rows[0].d);
  await role(db,'anon',null);await assert.rejects(db.query("select public.workspace_data('office-reports',null)"),/permission denied/);
 }finally{await db.close();}
});

test('PRO contact correction needs contact authority, preserves replay and never grants membership editing',async()=>{
 const db=await database();try{
  const m=await member(db);await action(db,'save_account',{id:READER,display_name:'PRO test officer',active:true,roles:['read_only'],office_codes:['pro'],permissions:['contacts.read','contacts.write'],reason:'Approved separate contact duties'});await role(db,'authenticated',READER);
  assert.equal((await db.query("select public.has_permission('members.write') allowed")).rows[0].allowed,false);
  const contact=await action(db,'save_contact',{member_id:m.id,contact_date:'2026-10-14',channel:'phone',notes:'Member contacted',follow_up_status:'scheduled'}),key=crypto.randomUUID(),payload={id:contact.id,contact_date:'2026-10-14',channel:'phone',notes:'Follow-up completed',outcome:'Confirmed',follow_up_status:'completed',reason:'Confirmed contact correction'};
  const result=await action(db,'update_contact',payload,key);assert.equal(result.follow_up_status,'completed');assert.equal((await action(db,'update_contact',payload,key)).id,result.id);await assert.rejects(action(db,'save_member',{id:m.id,full_name:'Forbidden change',reason:'Must stay outside contact authority'}),/Access denied/);
  await role(db,'authenticated',OWNER);assert.equal((await db.query("select count(*) n from public.audit_events where action='contact.corrected' and target_id=$1",[contact.id])).rows[0].n,1);
  await action(db,'save_account',{id:READER,display_name:'PRO test officer',active:true,roles:['read_only'],office_codes:['pro'],permissions:[],reason:'Revoke contact editing'});await role(db,'authenticated',READER);await assert.rejects(action(db,'update_contact',payload,key),/Access denied/);
 }finally{await db.close();}
});

test('migration upgrades preserved receipt history without changing IDs or totals',async()=>{
 const db=await database({migrationsLimit:16});try{
  const m=await member(db),first=await receipt(db,m);await action(db,'transition_payment',{id:first.id,status:'reversed',reason:'Preserved correction'});const second=await receipt(db,m,first);await db.exec('reset role');await db.exec(await readFile(migration,'utf8'));await role(db,'authenticated',OWNER);
  const rows=(await db.query('select id,receipt_root_id,status from public.payments order by created_at')).rows;assert.equal(rows.length,2);assert.ok(rows.every(p=>p.receipt_root_id===first.id));assert.ok(rows.some(p=>p.id===second.id&&p.status==='confirmed'));assert.equal((await db.query("select public.overview_metrics('2026-10-01','2026-10-31') d")).rows[0].d.cash,100000);
 }finally{await db.close();}
});

test('migration refuses existing branched receipts without silently editing preserved records',async()=>{
 const db=await database({migrationsLimit:16});try{
  const m=await member(db),first=await receipt(db,m);await action(db,'transition_payment',{id:first.id,status:'reversed',reason:'Preserved correction'});const second=await receipt(db,m,first);await action(db,'transition_payment',{id:second.id,status:'reversed',reason:'Preserved correction'});await receipt(db,m,second);await receipt(db,m,first);
  await db.exec('reset role');await assert.rejects(db.exec(await readFile(migration,'utf8')),/Multiple active receipts|history branches/);await db.exec('rollback');assert.equal((await db.query('select count(*) n from public.payments')).rows[0].n,4);assert.equal((await db.query("select count(*) n from information_schema.columns where table_schema='public' and table_name='payments' and column_name='receipt_root_id'")).rows[0].n,0);
 }finally{await db.close();}
});
