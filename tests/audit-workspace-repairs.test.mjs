import test from 'node:test';import assert from 'node:assert/strict';
import {database,role,action,OWNER,READER} from './database-harness.mjs';
import {setup} from './dom-harness.mjs';
import {renderAuth} from '../public/assets/js/modules/auth.js';
import {renderEvents} from '../public/assets/js/modules/operations.js';
import {renderOverview} from '../public/assets/js/modules/overview.js';

const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
async function signIn(ctx){ctx.review=false;ctx.user=null;ctx.svc.login=async()=>({needs_mfa:true});await renderAuth(ctx.container,ctx,async()=>{});const form=document.querySelector('#login-form');form.elements.email.value='isolated@example.invalid';form.elements.password.value='isolated-placeholder';form.onsubmit({preventDefault(){}});await settle();}

test('failed authenticator enrollment is visible, blocks native submission and recovers through Retry',async()=>{
 const {ctx,cleanup}=setup();let verifyCalls=0,enrollCalls=0;
 try{ctx.svc.factors=async()=>[];ctx.svc.enroll=async()=>{enrollCalls++;throw new Error('Enrollment interrupted');};ctx.svc.verify=async()=>{verifyCalls++;};await signIn(ctx);
  const form=document.querySelector('#mfa-form');assert.equal(typeof form.onsubmit,'function');assert.equal(form.querySelector('[type=submit]').disabled,true);assert.ok(form.querySelector('.form-error').textContent.includes('Enrollment interrupted'));assert.equal(document.querySelector('#mfa-retry').hidden,false);
  let prevented=false;await form.onsubmit({preventDefault(){prevented=true;}});assert.ok(prevented);assert.equal(verifyCalls,0);
  ctx.svc.enroll=async()=>{enrollCalls++;return {id:'test-factor',totp:{qr_code:'data:image/svg+xml,test-only',secret:'ISOLATED-TEST-ONLY'}};};await document.querySelector('#mfa-retry').onclick();assert.equal(enrollCalls,2);assert.equal(form.querySelector('[type=submit]').disabled,false);assert.equal(form.querySelector('.form-error').textContent,'');assert.equal(document.querySelectorAll('#mfa-qr img').length,1);
 }finally{cleanup();}
});

test('factor lookup failure is recoverable and verified factors do not enroll another authenticator',async()=>{
 const {ctx,cleanup}=setup();let verified;
 try{ctx.svc.factors=async()=>{throw new Error('Factor lookup interrupted');};await signIn(ctx);assert.ok(document.querySelector('#mfa-form .form-error').textContent.includes('Factor lookup interrupted'));ctx.svc.factors=async()=>[{id:'existing-factor',status:'verified'}];ctx.svc.enroll=async()=>{throw new Error('Must preserve verified factor');};ctx.svc.verify=async(id,code)=>{verified={id,code};return {needs_mfa:false};};await document.querySelector('#mfa-retry').onclick();const form=document.querySelector('#mfa-form');form.elements.code.value='123456';await form.onsubmit({preventDefault(){}});assert.deepEqual(verified,{id:'existing-factor',code:'123456'});assert.equal(document.querySelectorAll('#mfa-qr img').length,0);
 }finally{cleanup();}
});

test('signing out during setup prevents a delayed enrollment from exposing its QR or secret',async()=>{
 const {ctx,cleanup}=setup();let finish,loggedOut=false;
 try{ctx.svc.factors=async()=>[];ctx.svc.enroll=()=>new Promise(resolve=>{finish=resolve;});ctx.svc.logout=async()=>{loggedOut=true;};await signIn(ctx);assert.equal(document.querySelector('#mfa-form [type=submit]').disabled,true);await document.querySelector('#mfa-signout').onclick();assert.ok(loggedOut);assert.ok(document.querySelector('#login-form'));finish({id:'obsolete-factor',totp:{qr_code:'data:image/svg+xml,obsolete',secret:'MUST-NOT-APPEAR'}});await settle();assert.equal(document.querySelector('#mfa-qr'),null);assert.ok(!document.body.textContent.includes('MUST-NOT-APPEAR'));
 }finally{cleanup();}
});

test('accepted invitation password setup does not start an unused authenticator enrollment first',async()=>{
 const {ctx,cleanup}=setup();try{ctx.review=false;ctx.user={needs_mfa:true};ctx.svc.callback={mode:'invite'};ctx.svc.factors=async()=>{throw new Error('Password setup must come first');};await renderAuth(ctx.container,ctx,async()=>{});assert.ok(document.querySelector('#password-form'));assert.equal(document.querySelector('#mfa-form'),null);}finally{cleanup();}
});

test('shared expense pagination and saved event counts repair the deployed workspace contracts',async t=>{
 const db=await database();t.after(()=>db.close());
 const member=await action(db,'save_member',{full_name:'Isolated audit member',phone_original:'08012345678',city:'Uyo',country:'Nigeria',skills:[],reason:'Isolated regression fixture'});
 const event=await action(db,'save_event',{title:'Isolated audit event',event_date:'2026-10-15',location:'Private fixture',is_public:false});await action(db,'record_attendance',{event_id:event.id,rows:[{member_id:member.id,status:'present'}]});
 await action(db,'save_collection',{title:'Isolated audit fund',purpose:'Regression fixture',category:'donation',participation:'voluntary',amount_kobo:null});
 await db.exec('reset role');await db.exec(`insert into public.expenses(collection_id,description,payee,amount_kobo,expense_date,recorded_by,status,overview_summary) select (select id from public.contribution_collections limit 1),'PRIVATE description '||n,'PRIVATE payee',n*100,'2026-10-15','${OWNER}','pending','Shared expense '||lpad(n::text,2,'0') from generate_series(1,51) n`);
 const shared=async({from='2026-10-01',to='2026-10-15',query='',status='',offset=0,limit=20,sort='expense_date',descending=true}={})=>(await db.query('select public.accountability_expenses($1,$2,$3,$4,$5,$6,$7,$8) d',[from,to,query,status,offset,limit,sort,descending])).rows[0].d;
 await t.test('the list reports actual attendance without loading individual attendance rows',async()=>{
  await role(db,'authenticated',OWNER);const list=(await db.query("select public.workspace_data('events',null) d")).rows[0].d;assert.equal(list.events[0].recorded_present,1);assert.deepEqual(list.attendance,[]);const detail=(await db.query("select public.workspace_data('events',$1) d",[event.id])).rows[0].d;assert.equal(detail.attendance.length,1);
  const {ctx,cleanup}=setup();try{ctx.data=list;await renderEvents(ctx);assert.equal(document.querySelectorAll('tbody tr:first-child td')[6].textContent,'1');const search=document.querySelector('#events-table [type=search]');search.value='Isolated';assert.doesNotThrow(()=>search.oninput({target:search}));document.querySelector('[data-sort=present]').click();assert.equal(document.querySelectorAll('tbody tr:first-child td')[6].textContent,'1');}finally{cleanup();}
 });
 await t.test('all fifty-one expenses are reachable with stable pagination by a non-finance executive',async()=>{
  await role(db,'authenticated',READER);const pages=await Promise.all([0,20,40].map(offset=>shared({offset})));assert.ok(pages.every(page=>page.count===51));const rows=pages.flatMap(page=>page.rows);assert.equal(rows.length,51);assert.equal(new Set(rows.map(row=>row.id)).size,51);assert.equal(rows.reduce((sum,row)=>sum+row.amount_kobo,0),132600);
  for(const row of rows){assert.deepEqual(Object.keys(row).sort(),['id','expense_date','description','amount_kobo','status','responsible_officer_name','collection_title'].sort());assert.ok(!JSON.stringify(row).includes('PRIVATE'));}
 });
 await t.test('search, status, date, sorting and empty pages apply to the complete shared projection',async()=>{
  assert.equal((await shared({query:'Shared expense 51'})).count,1);assert.equal((await shared({query:'PRIVATE'})).count,0);assert.equal((await shared({status:'approved'})).count,0);assert.equal((await shared({to:'2026-10-14'})).count,0);assert.equal((await shared({sort:'amount_kobo',descending:true})).rows[0].amount_kobo,5100);assert.equal((await shared({sort:'amount_kobo',descending:false})).rows[0].amount_kobo,100);assert.deepEqual((await shared({offset:100})).rows,[]);
 });
 await t.test('invalid or unbounded scopes are rejected',async()=>{
  for(const options of [{limit:101},{limit:null},{offset:-1},{query:'x'.repeat(181)},{sort:'payee'},{status:'invalid'},{from:'2026-10-16'},{to:'2028-10-15'}])await assert.rejects(shared(options));
 });
 await t.test('every application foreign key has a valid covering prefix index',async()=>{
  await db.exec('reset role');const {rows}=await db.query("select c.conname from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where c.contype='f' and n.nspname='public' and not exists(select 1 from pg_index i where i.indrelid=c.conrelid and i.indisvalid and i.indisready and i.indpred is null and i.indnkeyatts>=cardinality(c.conkey) and c.conkey <@ (i.indkey::smallint[])[0:cardinality(c.conkey)-1])");assert.deepEqual(rows,[]);await role(db,'authenticated',READER);
 });
 await t.test('anonymous, AAL1, denied and revoked executives cannot read shared expense pages',async()=>{
  await role(db,'anon',null);await assert.rejects(shared());await role(db,'authenticated',READER,'aal1');await assert.rejects(shared());await db.exec('reset role');await db.query("insert into public.permission_denials(executive_id,permission) values($1,'directory.read')",[READER]);await role(db,'authenticated',READER);await assert.rejects(shared());await db.exec('reset role');await db.query('delete from public.permission_denials where executive_id=$1',[READER]);await db.query('update public.executive_accounts set active=false where id=$1',[READER]);await role(db,'authenticated',READER);await assert.rejects(shared());
 });
});

test('Overview pages beyond fifty expenses and keeps search, approval and date scope on the server',async()=>{
 const {ctx,cleanup}=setup();const calls=[];try{ctx.can=p=>p==='directory.read';ctx.svc.accountabilityOverview=async()=>({totals:{},expenses:[],reports:[]});ctx.svc.accountabilityExpenses=async options=>{calls.push(options);return {count:51,rows:[{id:'expense-'+options.offset,description:'Shared row '+options.offset,expense_date:'2026-10-15',amount_kobo:100,status:'pending',collection_title:'Fixture'}]};};await renderOverview(ctx);const holder=document.querySelector('#accountability-expenses');assert.ok(holder.textContent.includes('of 51 records'));assert.equal(calls[0].sort,'expense_date');assert.equal(calls[0].descending,true);holder.querySelector('[data-next]').click();await settle();assert.equal(calls.at(-1).offset,20);holder.querySelector('[data-next]').click();await settle();assert.equal(calls.at(-1).offset,40);assert.ok(holder.textContent.includes('Shared row 40'));const status=holder.querySelector('[data-remote-filter=status]');status.value='approved';status.onchange();await settle();assert.equal(calls.at(-1).status,'approved');assert.equal(calls.at(-1).offset,0);const search=holder.querySelector('[type=search]');search.value='target';search.oninput({target:search});await new Promise(resolve=>setTimeout(resolve,220));assert.equal(calls.at(-1).query,'target');assert.ok(calls.every(call=>call.from&&call.to));assert.equal(holder.querySelector('a[data-route]'),null);
 }finally{cleanup();}
});
