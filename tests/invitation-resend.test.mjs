import test from 'node:test';
import assert from 'node:assert/strict';
import {database,role,action,OWNER,READER,FINANCE} from './database-harness.mjs';
import {accountsHandler} from '../api/accounts.js';
import {HttpError} from '../server/http.js';
import {setup} from './dom-harness.mjs';
import {renderAccounts} from '../public/assets/js/modules/settings.js';

const root=async(db,sql,args=[])=>{await db.exec('reset role');return db.query(sql,args);};
async function pending(db,office='pro'){
 await role(db,'authenticated',OWNER);
 const m=await action(db,'save_member',{full_name:'Pending Executive',phone_original:'08012345678',email:crypto.randomUUID()+'@example.invalid',city:'Uyo',country:'Nigeria',details:{whatsapp:'08012345678'},reason:'Approved isolated membership'});
 const payload={op:'invite',display_name:m.full_name,email:m.email,roles:['read_only'],office_codes:[office],member_id:m.id,include_membership:true,approved_member_invitation:true,reason:'Approved pending appointment'};
 const op=(await db.query('select public.begin_invitation($1,$2) d',[crypto.randomUUID(),payload])).rows[0].d,id=crypto.randomUUID();
 await root(db,'insert into auth.users(id,email) values($1,$2)',[id,m.email]);await role(db,'authenticated',OWNER);await db.query('select public.mark_invitation_identity($1,$2,$3)',[op.id,op.lease_id,id]);await role(db,'service_role',null);
 await db.query('select public.provision_invitation_v2($1,$2,$3,$4,$5,$6,$7,$8,null,$9,$10,$11,$12,$13)',[op.id,op.lease_id,OWNER,id,m.full_name,m.email,['read_only'],[],m.id,payload.reason,[],[],[office]]);
 await role(db,'authenticated',OWNER);return {id,m,op};
}
const begin=async(db,target,key=crypto.randomUUID(),reason='Recipient requested another invitation')=>(await db.query('select public.begin_invitation_resend($1,$2,$3) d',[target,key,reason])).rows[0].d;
const prepare=async(db,r,actor=OWNER)=>(await db.query('select public.prepare_invitation_resend($1,$2,$3) d',[actor,r.id,r.lease_id])).rows[0].d;
const finish=async(db,r,state='sent',actor=OWNER)=>(await db.query('select public.finish_invitation_resend($1,$2,$3,$4) d',[actor,r.id,r.lease_id,state])).rows[0].d;
async function age(db,target){await root(db,"update public.invitation_operations set updated_at=now()-interval '3 minutes' where auth_user_id=$1",[target]);await root(db,"update um18_internal.invitation_resends set created_at=now()-interval '3 minutes' where target_id=$1",[target]);await role(db,'authenticated',OWNER);}

test('invitation resends preserve pending identity, permissions and membership while enforcing live checks',async t=>{
 const db=await database();t.after(()=>db.close());const target=await pending(db);let request,key;
 await t.test('new invitations have a cooldown and anonymous/read-only/password-less users cannot reserve a resend',async()=>{
  await assert.rejects(begin(db,target.id),e=>e.code==='PT429'&&/60 seconds/.test(e.message));
  for(const [name,id,aal] of [['anon',null,'aal1'],['authenticated',READER,'aal2'],['authenticated',OWNER,'aal1']]){await role(db,name,id,aal);await assert.rejects(begin(db,target.id));}
  await age(db,target.id);
 });
 await t.test('reserving an attempt is idempotent and prevents concurrent or changed retries',async()=>{
  await assert.rejects(db.query('select public.begin_invitation($1,$2)',[crypto.randomUUID(),{op:'invite',email:target.m.email,display_name:'Duplicate pending executive',roles:['owner'],office_codes:[],member_id:target.m.id,reason:'Attempt to bypass resend controls',include_membership:true,approved_member_invitation:true}]),/Use Resend invitation/);
  key=crypto.randomUUID();request=await begin(db,target.id,key);assert.equal(request.replayed,false);assert.equal(request.state,'sending');
  const replay=await begin(db,target.id,key);assert.equal(replay.replayed,true);assert.equal(replay.lease_id,undefined);
  await assert.rejects(begin(db,target.id,key,'Different retry reason'),/Retry key/);await assert.rejects(begin(db,target.id),e=>e.code==='PT429');
  await assert.rejects(prepare(db,request),/permission denied/);await assert.rejects(finish(db,request),/permission denied/);
 });
 await t.test('only a matching server lease prepares the canonical recipient; no records or assignments are provisioned',async()=>{
  await role(db,'service_role',null);await assert.rejects(prepare(db,{...request,lease_id:crypto.randomUUID()}),/unavailable/);
  const data=await prepare(db,request);assert.deepEqual(data,{target_id:target.id,email:target.m.email,kind:'invite'});
  await finish(db,request);await finish(db,request);await role(db,'authenticated',OWNER);assert.equal((await begin(db,target.id,key)).state,'sent');
  const before=(await root(db,'select member_id,office_codes,active,access_pending,invitation_last_resent_at from public.executive_accounts where id=$1',[target.id])).rows[0];assert.equal(before.member_id,target.m.id);assert.equal(before.active,true);assert.equal(before.access_pending,true);assert.deepEqual(before.office_codes,['pro']);assert.ok(before.invitation_last_resent_at);
  assert.equal((await root(db,'select count(*) n from public.members')).rows[0].n,1);assert.equal((await root(db,'select count(*) n from public.executive_accounts where id=$1',[target.id])).rows[0].n,1);
  const audit=(await root(db,"select actor_id,changes from public.audit_events where action='executive.invitation_resend_sent' and target_id=$1",[target.id])).rows;assert.equal(audit.length,1);assert.equal(audit[0].actor_id,OWNER);assert.equal(audit[0].changes.kind,'invite');await role(db,'authenticated',OWNER);
 });
 await t.test('cooldown applies across administrators and confirmed unfinished recipients receive a setup/recovery link',async()=>{
  await action(db,'save_account',{id:FINANCE,display_name:'Approved Administrator',roles:['treasurer'],permissions:['accounts.write'],active:true,reason:'Reviewed administrator assignment'});await role(db,'authenticated',FINANCE);await assert.rejects(begin(db,target.id),e=>e.code==='PT429');
  await age(db,target.id);await root(db,'update auth.users set email_confirmed_at=now() where id=$1',[target.id]);await role(db,'authenticated',OWNER);
  const r=await begin(db,target.id);await role(db,'service_role',null);assert.equal((await prepare(db,r)).kind,'recovery');await finish(db,r,'failed');await role(db,'authenticated',OWNER);await assert.rejects(begin(db,target.id),e=>e.code==='PT429');
 });
 await t.test('changed identities, revoked accounts and accepted appointments cannot get a new resend',async()=>{
  await age(db,target.id);await root(db,'update public.members set email=$1 where id=$2',['changed@example.invalid',target.m.id]);await role(db,'authenticated',OWNER);await assert.rejects(begin(db,target.id),/member and invited email/);
  await root(db,'update public.members set email=$1 where id=$2',[target.m.email,target.m.id]);await root(db,'update public.executive_accounts set active=false where id=$1',[target.id]);await role(db,'authenticated',OWNER);await assert.rejects(begin(db,target.id),/active pending/);
  await root(db,'update public.executive_accounts set active=true,access_pending=false where id=$1',[target.id]);await role(db,'authenticated',OWNER);await assert.rejects(begin(db,target.id),/active pending/);
  await root(db,'update public.executive_accounts set access_pending=true where id=$1',[target.id]);await role(db,'authenticated',OWNER);
 });
 await t.test('server preparation rechecks authority and recipient eligibility after reservation',async()=>{
  const r=await begin(db,target.id);await root(db,'update public.executive_accounts set active=false where id=$1',[target.id]);await role(db,'service_role',null);await assert.rejects(prepare(db,r),/active pending/);await finish(db,r,'failed');
  await root(db,'update public.executive_accounts set active=true where id=$1',[target.id]);await age(db,target.id);await role(db,'authenticated',FINANCE);const delegated=await begin(db,target.id);await role(db,'authenticated',OWNER);await action(db,'save_account',{id:FINANCE,display_name:'Former Administrator',roles:['read_only'],permissions:[],active:true,reason:'Revoke account administration'});
  await role(db,'service_role',null);await assert.rejects(prepare(db,delegated,FINANCE),/authority was revoked/);await finish(db,delegated,'failed',FINANCE);await role(db,'authenticated',OWNER);
 });
 await t.test('five hourly attempts cap further requests and resend internals stay inaccessible',async()=>{
  // Previous sent/failed reservations count towards the same target limit.
  while((await root(db,'select count(*) n from um18_internal.invitation_resends where target_id=$1',[target.id])).rows[0].n<5){await age(db,target.id);const r=await begin(db,target.id);await role(db,'service_role',null);await finish(db,r,'failed');}
  await age(db,target.id);await assert.rejects(begin(db,target.id),e=>e.code==='PT429'&&/Five resend/.test(e.message));
  await assert.rejects(db.query('select * from um18_internal.invitation_resends'),/permission denied/);await assert.rejects(db.query('select um18_internal.pending_invitation($1)',[target.id]),/permission denied/);
 });
});

test('replacement resends retain the outgoing executive and reject a changed appointment',async t=>{
 const db=await database();t.after(()=>db.close());const target=await pending(db);
 await action(db,'save_account',{id:FINANCE,display_name:'Outgoing Officer',active:true,roles:['read_only'],office_codes:['pro'],reason:'Approved outgoing office'});
 await root(db,"update public.invitation_operations set replacement_executive_id=$1,replacement_offices=array['pro'] where id=$2",[FINANCE,target.op.id]);await age(db,target.id);
 const r=await begin(db,target.id);await role(db,'service_role',null);await prepare(db,r);await finish(db,r);
 assert.equal((await root(db,'select active from public.executive_accounts where id=$1',[FINANCE])).rows[0].active,true);
 await root(db,'update public.executive_accounts set office_codes=array[]::text[] where id=$1',[FINANCE]);await age(db,target.id);await assert.rejects(begin(db,target.id),/replacement appointment changed/);
});

const ID='30000000-0000-4000-8000-000000000001',OP='40000000-0000-4000-8000-000000000001',LEASE='50000000-0000-4000-8000-000000000001';
function mocks({kind='invite',replay=null,beginError=null,deliveryError=false,throwDelivery=false,wrongIdentity=false,revoke=false}={}){
 const calls=[],sent=[];let checks=0;const attempt={id:OP,lease_id:LEASE,state:'sending',replayed:false},identity={id:ID,email:'pending@example.invalid',email_confirmed_at:kind==='recovery'?'2026-10-15':null};
 const send=async mode=>{sent.push(mode);if(throwDelivery)throw new Error('Network interrupted');return {data:{user:{id:wrongIdentity?'other-id':ID}},error:deliveryError?{message:'Provider rejected credentials'}:null};};
 const values={environment:()=>({origin:'https://association.example'}),executive:async()=>{if(revoke&&++checks>1)throw new HttpError(403,'Access revoked');return {user:{id:OWNER},client:{rpc:async(name,args)=>{calls.push({name,args});return {data:replay?{...attempt,replayed:true,state:replay,kind}:attempt,error:beginError};}}};},privileged:()=>({auth:{admin:{getUserById:async()=>({data:{user:identity},error:null}),inviteUserByEmail:async(email,options)=>{assert.equal(email,identity.email);assert.equal(options.redirectTo,'https://association.example/admin/login/');return send('invite');}},resetPasswordForEmail:async(email,options)=>{assert.equal(email,identity.email);assert.equal(options.redirectTo,'https://association.example/admin/login/');return send('recovery');}}}),rpc:async(client,name,args)=>{calls.push({name,args});if(name==='prepare_invitation_resend')return {target_id:ID,email:identity.email,kind};return {state:args.p_state,kind};}};
 return {values,calls,sent};
}
async function sendRequest(options={},change={}){const d=mocks(options),req={method:'POST',headers:{origin:'https://association.example','idempotency-key':crypto.randomUUID()},body:{op:'resend_invitation',id:ID,reason:'Recipient requested another link',...change}},res={setHeader(){},end(body){this.body=JSON.parse(body);}};await accountsHandler(d.values)(req,res);return {...d,res};}

test('resend endpoint uses existing invite identity or confirmed-recipient recovery and records the outcome',async()=>{
 for(const kind of ['invite','recovery']){const d=await sendRequest({kind});assert.equal(d.res.statusCode,200);assert.deepEqual(d.sent,[kind]);assert.equal(d.calls.at(-1).args.p_state,'sent');assert.equal(d.calls.at(-1).args.p_actor,OWNER);assert.equal(d.res.body.kind,kind);assert.ok(!JSON.stringify(d.res.body).includes('@'));}
});
test('resend endpoint never sends for completed/uncertain retries, cooldowns or malformed/privilege-changing requests',async()=>{
 for(const replay of ['sent','sending','failed','uncertain']){const d=await sendRequest({replay});assert.equal(d.res.statusCode,replay==='sent'?200:replay==='sending'?409:503);assert.deepEqual(d.sent,[]);}
 const cooldown=await sendRequest({beginError:{code:'PT429',message:'Wait at least 60 seconds'}});assert.equal(cooldown.res.statusCode,429);assert.deepEqual(cooldown.sent,[]);
 for(const patch of [{id:'wrong'},{reason:''},{email:'attacker@example.invalid'},{roles:['owner']}]){const d=await sendRequest({},patch);assert.equal(d.res.statusCode,422);assert.deepEqual(d.sent,[]);}
});
test('SMTP failures, interrupted delivery, identity changes and revoked authority never mark successful delivery',async()=>{
 for(const [options,state,status] of [[{deliveryError:true},'failed',503],[{throwDelivery:true},'uncertain',500],[{wrongIdentity:true},'uncertain',409],[{revoke:true},'failed',403]]){const d=await sendRequest(options);assert.equal(d.res.statusCode,status);assert.equal(d.calls.at(-1).args.p_state,state);assert.equal(d.res.body.sent,undefined);if(options.revoke)assert.deepEqual(d.sent,[]);}
});

test('starting another new invitation directs the administrator to Resend without emailing or changing permissions',async()=>{
 const d=await sendRequest({beginError:{code:'P0001',message:'This executive already has a pending invitation. Use Resend invitation to send another email'}},{op:'invite',display_name:'Pending Officer',email:'pending@example.invalid',member_id:ID,roles:['read_only'],office_codes:['pro']});assert.equal(d.res.statusCode,409);assert.match(d.res.body.error,/Use Resend invitation/);assert.deepEqual(d.sent,[]);
});

test('only active pending executives have resend controls and dialog retries retain the request key',async()=>{
 const {ctx,cleanup}=setup();try{const target={id:ID,display_name:'Pending Officer',email:'pending@example.invalid',roles:['read_only'],office_codes:['pro'],active:true,access_pending:true};ctx.data.accounts.push(target);let requests=0,requestKey;
  const {operationKey}=await import('../public/assets/js/ui.js');ctx.svc.resendInvitation=async p=>{assert.deepEqual(p,{id:ID,reason:'Recipient requested another link'});requests++;if(!requestKey)requestKey=operationKey();else assert.equal(operationKey(),requestKey);if(requests===1)throw Error('Temporary interruption');return {sent:true,kind:'invite'};};await renderAccounts(ctx);document.querySelector(`[data-resend-invitation="${ID}"]`).click();const form=document.querySelector('dialog form');assert.equal(form.elements.email,undefined);form.elements.reason.value='Recipient requested another link';await form.onsubmit({preventDefault(){},currentTarget:form});assert.match(form.querySelector('.form-error').textContent,/Temporary/);await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(requests,2);
  for(const patch of [{active:false,access_pending:true},{active:true,access_pending:false}]){Object.assign(target,patch);await renderAccounts(ctx);assert.equal(document.querySelector(`[data-resend-invitation="${ID}"]`),null);}
 }finally{cleanup();}
});
