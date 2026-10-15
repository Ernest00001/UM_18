import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {database,action,role,OWNER,FINANCE,READER} from './database-harness.mjs';
import {setup} from './dom-harness.mjs';
import {renderMyProfile} from '../public/assets/js/modules/profile.js';
import {mountMemberSearch} from '../public/assets/js/member-search.js';
import {verifyRestoreTarget} from '../scripts/restore-target.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const pending=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('stale expense edits and approvals are rejected; exact retries remain safe',async()=>{
 const db=await database();try{
  const fund=await action(db,'save_collection',{title:'Audit fixture fund',purpose:'Isolated approval checks',category:'event',participation:'voluntary'});
  await action(db,'publish_collection',{id:fund.id,reason:'Fixture approved fund'});
  const payload={collection_id:fund.id,description:'Original invoice',overview_summary:'Venue booking',payee:'Fixture venue',expense_date:'2026-10-15',amount_kobo:500000,reason:'Fixture invoice'};
  const first=await action(db,'save_expense',payload);await role(db,'authenticated',FINANCE);
  const changed=await action(db,'save_expense',{...payload,id:first.id,expected_revision:first.revision,amount_kobo:5000000});
  assert.ok(changed.revision>first.revision);await role(db,'authenticated',OWNER);
  await assert.rejects(action(db,'transition_expense',{id:first.id,status:'approved',expected_revision:first.revision,reason:'Old review'}),/Expense changed/);
  await assert.rejects(action(db,'save_expense',{...payload,id:first.id,expected_revision:first.revision}),/Expense changed/);
  await assert.rejects(db.query('select public.execute_action($1,$2::jsonb,$3)',['transition_expense',JSON.stringify({id:first.id,status:'approved',reason:'Missing review version'}),crypto.randomUUID()]),/Expense changed/);
  const key=crypto.randomUUID(),approval={id:first.id,status:'approved',expected_revision:changed.revision,reason:'Reviewed updated invoice'};
  const approved=await action(db,'transition_expense',approval,key);assert.equal(approved.amount_kobo,5000000);assert.equal(approved.status,'approved');assert.ok(approved.revision>changed.revision);
  assert.deepEqual(await action(db,'transition_expense',approval,key),approved);
  await assert.rejects(action(db,'transition_expense',{...approval,reason:'Different retry'},key),/Retry key/);
  await role(db,'authenticated',READER);await assert.rejects(action(db,'transition_expense',approval,key),/Access denied/);
 }finally{await db.close();}
});

test('ordinary workspaces return bounded member records, while explicit reports and search retain complete access',async()=>{
 const db=await database();try{
  const members=[];for(let i=0;i<31;i++)members.push(await action(db,'save_member',{full_name:'Scope fixture '+i,phone_original:'08012345678',city:'Uyo',country:i%2?'Nigeria':'Ghana',skills:['Engineering'],reason:'Approved fixture member'}));
  const data=async(area,target=null)=>(await db.query('select public.workspace_data($1,$2) d',[area,target])).rows[0].d;
  const overview=await data('overview');assert.ok(overview.members.length<=9);assert.equal(overview.directory_summary.member_count,31);assert.equal(overview.directory_summary.skills_count,1);
  const directory=await data('members');assert.equal(directory.members.length,0);assert.deepEqual(directory.directory_summary.countries,['Ghana','Nigeria']);
  for(const area of ['payments','monthly','special','expenses','branding','documents','audit','office-reports'])assert.ok((await data(area)).members.length<=1,area);
  const detail=await data('members',members[30].id);assert.equal(detail.members.length,1);assert.equal(detail.members[0].id,members[30].id);
  assert.equal((await data('reports')).members.length,31);
  const search=(await db.query("select public.search_members('', '', '', 20, 20, 'full_name', false) d")).rows[0].d;assert.equal(search.count,31);assert.equal(search.rows.length,11);
  await role(db,'anon',null);await assert.rejects(data('members'));
 }finally{await db.close();}
});

test('the migration preserves existing expenses and keeps privileged helpers inaccessible to browser roles',async()=>{
 const db=await database({migrationsLimit:24});try{
  const fund=await action(db,'save_collection',{title:'Preserved fixture fund',purpose:'Migration upgrade fixture',category:'event',participation:'voluntary'});
  await action(db,'publish_collection',{id:fund.id,reason:'Fixture published fund'});
  const original=await action(db,'save_expense',{collection_id:fund.id,description:'Preserved invoice',expense_date:'2026-10-15',amount_kobo:500000,payee:'Fixture venue',reason:'Original approved record'});
  await db.exec('reset role');await db.exec(await readFile('supabase/migrations/20261015122243_audit_production_repairs.sql','utf8'));await role(db,'authenticated',OWNER);
  const upgraded=(await db.query('select * from public.expenses where id=$1',[original.id])).rows[0];assert.equal(upgraded.amount_kobo,original.amount_kobo);assert.equal(upgraded.status,original.status);assert.equal(upgraded.revision,1);
  const grants=(await db.query("select has_function_privilege('anon','public.execute_action(text,jsonb,uuid)','EXECUTE') anon,has_function_privilege('authenticated','public.execute_action_pre_audit_repairs(text,jsonb,uuid)','EXECUTE') helper,has_function_privilege('authenticated','public.workspace_data_v1(text,uuid)','EXECUTE') base")).rows[0];assert.deepEqual(grants,{anon:false,helper:false,base:false});
 }finally{await db.close();}
});

test('profile selection ignores old responses, clears stale fields and blocks saving during load or failure',async()=>{
 const {ctx,cleanup}=setup();try{
  const current={id:'current',full_name:'President',member_no:'001',email:'office@example.invalid'},a=pending(),b=pending();let saved=false;
  ctx.data.members=[current,{id:'A',membership_status:'active'},{id:'B',membership_status:'active'}];
  ctx.svc.myProfile=async()=>({account:{office_codes:['president']},member:current,official_email:current.email,can_resolve_placeholder:true});
  ctx.svc.memberRecord=id=>id==='A'?a.promise:b.promise;ctx.svc.saveMyProfile=async()=>{saved=true;};await renderMyProfile(ctx);
  const form=document.querySelector('#personal-profile'),select=form.elements.member_id,save=form.querySelector('[type=submit]');
  select.value='A';select.dispatchEvent(new window.Event('change'));assert.equal(form.elements.full_name.value,'');assert.equal(save.disabled,true);await form.onsubmit({preventDefault(){}});assert.equal(saved,false);
  select.value='B';select.dispatchEvent(new window.Event('change'));b.resolve({full_name:'Member B',email:'b@example.invalid'});await tick();a.resolve({full_name:'Member A',email:'a@example.invalid'});await tick();
  assert.equal(select.value,'B');assert.equal(form.elements.full_name.value,'Member B');assert.equal(form.elements.email.value,'b@example.invalid');assert.equal(save.disabled,false);assert.equal(form.elements.link_confirmed.checked,false);
  const failed=pending();ctx.svc.memberRecord=()=>failed.promise;select.value='A';select.dispatchEvent(new window.Event('change'));failed.reject(new Error('Unavailable'));await tick();assert.equal(save.disabled,true);assert.equal(form.elements.full_name.value,'');await form.onsubmit({preventDefault(){}});assert.equal(saved,false);
 }finally{cleanup();}
});

async function startWorkspace(service,ctx){
 ctx.container.id='app';globalThis.__auditRepairService=service;
 const result=await build({entryPoints:['public/assets/js/admin.js'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'audit-repair-service',setup(builder){builder.onResolve({filter:/^\.\/service\.js$/},()=>({path:'repair-service',namespace:'repair'}));builder.onLoad({filter:/.*/,namespace:'repair'},()=>({contents:'export const reviewMode=false,uiPreview=false;export async function service(){return globalThis.__auditRepairService;}export async function branding(){return globalThis.__auditRepairService.branding();}',loader:'js'}));builder.onResolve({filter:/vendor\//},args=>({path:args.path,external:true}));}}]});
 await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text+'\n//'+crypto.randomUUID()).toString('base64'));
}
test('a revoked startup session returns to sign-in; a network failure remains retryable with account switching',async()=>{
 const {ctx,cleanup}=setup();try{
  let signouts=0;await startWorkspace({branding:async()=>ctx.brand,session:async()=>{throw Object.assign(new Error('Access denied'),{code:'42501'});},logout:async()=>{signouts++;}},ctx);
  assert.equal(signouts,1);assert.ok(document.querySelector('#login-form'));assert.equal(document.querySelector('#retry'),null);
  ctx.container=document.querySelector('#app');await startWorkspace({branding:async()=>ctx.brand,session:async()=>{throw new Error('Temporary network interruption');},logout:async()=>{signouts++;}},ctx);
  assert.equal(signouts,1);assert.ok(document.querySelector('#retry'));assert.ok(document.querySelector('#startup-signout'));
  let destination;location.assign=path=>destination=path;document.querySelector('#startup-signout').click();await tick();assert.equal(signouts,2);assert.equal(destination,'/admin/login/');
 }finally{delete globalThis.__auditRepairService;cleanup();}
});

test('member-profile shortcuts retain their member target for advance payments and executive invitations',async()=>{
 for(const area of ['payments','accounts']){
  const {ctx,cleanup}=setup();try{
   const member=ctx.data.members[1],scopes=[];location.pathname='/admin/'+area+'/';location.search=area==='payments'?'?new=1&member='+member.id:'?invite_member='+member.id;
   await startWorkspace({branding:async()=>ctx.brand,session:async()=>ctx.user,load:async scope=>{scopes.push(scope);return ctx.data;},memberAssessments:async id=>ctx.data.assessments.filter(a=>a.member_id===id)},ctx);
   assert.equal(scopes.at(-1).target,member.id);assert.equal(scopes.at(-1).area,area);assert.equal(document.querySelector('[name=member_id]').value,member.id);
  }finally{delete globalThis.__auditRepairService;cleanup();}
 }
});

test('remote member choices reach later pages and cannot be overwritten by an older search',async()=>{
 const {ctx,cleanup}=setup();try{
  ctx.page='payments';ctx.container.innerHTML='<label class="field"><span>Member</span><select name="member_id"><option value="">Choose</option><option value="keep" selected>Previously selected member</option></select></label>';
  const calls=[],old=pending();let first=true;
  ctx.svc.searchMembers=async p=>{calls.push(p);if(first){first=false;return old.promise;}return {count:41,rows:[{id:'member-'+p.offset,member_no:'SET-'+p.offset,full_name:'Found member',membership_status:'active'}]};};
  const select=document.querySelector('select');mountMemberSearch(select,ctx);const search=document.querySelector('[data-find]');const initial=search.onclick();document.querySelector('input').value='new';await search.onclick();
  old.resolve({count:1,rows:[{id:'old',full_name:'Outdated member'}]});await initial;assert.equal(select.value,'keep');assert.equal(select.querySelector('option[value=old]'),null);
  document.querySelector('[data-next]').click();await tick();assert.equal(calls.at(-1).offset,20);assert.ok(select.querySelector('option[value=member-20]'));assert.ok(ctx.data.members.some(m=>m.id==='member-20'));
 }finally{cleanup();}
});

test('staging restores reject production, source projects and mismatched or missing approvals before client creation',()=>{
 const valid={targetUrl:'https://abcdefghijklmnopqrst.supabase.co',sourceUrl:'https://hpbzhaleqphfucnautpl.supabase.co',approvedProjectRef:'abcdefghijklmnopqrst',environment:'staging',confirmation:'STAGING_RESTORE_APPROVED'};
 assert.equal(verifyRestoreTarget(valid),'abcdefghijklmnopqrst');
 for(const patch of [{targetUrl:valid.sourceUrl,approvedProjectRef:'hpbzhaleqphfucnautpl'},{sourceUrl:valid.targetUrl},{environment:'production'},{approvedProjectRef:'differentprojectref00'},{approvedProjectRef:''},{confirmation:''},{sourceUrl:undefined},{targetUrl:'https://abcdefghijklmnopqrst.supabase.co.evil.invalid'}])assert.throws(()=>verifyRestoreTarget({...valid,...patch}));
});
