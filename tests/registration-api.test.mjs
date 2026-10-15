import test from 'node:test';import assert from 'node:assert/strict';
import {registrationHandler} from '../api/register.js';
import {database,role,action,OWNER} from './database-harness.mjs';
import {setup} from './dom-harness.mjs';
import {mountRegistration} from '../public/assets/js/registration.js';

test('public registration needs no CAPTCHA and remains pending leadership review',async t=>{
 const db=await database();t.after(()=>db.close());
 const priorMode=process.env.VERCEL_ENV;process.env.VERCEL_ENV='production';t.after(()=>{if(priorMode===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=priorMode;});
 const env={url:'https://fictional-project.supabase.co',key:'sb_publishable_fixture',secret:'sb_secret_fixture',origin:'https://association.example',rateSalt:'a'.repeat(64)};
 let rpcCalls=0,first;
 const client={rpc:async(name,args)=>{
  rpcCalls++;await role(db,'service_role',null);
  try{
   let rows;
   if(name==='consume_registration_rate')({rows}=await db.query('select public.consume_registration_rate($1) result',[args.p_hash]));
   else if(name==='submit_member_application')({rows}=await db.query('select public.submit_member_application($1::jsonb,$2) result',[JSON.stringify(args.p_payload),args.p_key]));
   else throw Error('Unexpected registration RPC');
   return {data:rows[0].result,error:null};
  }catch(error){return {data:null,error};}
 }};
 const payload={full_name:'Isolated API member',phone:'08012345678',city:'Uyo',country:'Nigeria',email:'member@example.invalid',whatsapp:'08012345678',acknowledgement:true};
 const send=async(value=payload,options={})=>{
  let output='';const headers={};
  const res={setHeader:(k,v)=>headers[k]=v,end:value=>output=value};
  const req={method:options.method||'POST',body:value,headers:{origin:options.origin||env.origin,'idempotency-key':Object.hasOwn(options,'key')?options.key:crypto.randomUUID(),'x-vercel-forwarded-for':options.ip||'192.0.2.1',...options.headers}};
  await registrationHandler({environment:()=>({...env,...options.environment}),privileged:()=>client})(req,res);
  return {status:res.statusCode,body:JSON.parse(output),headers};
 };
 const count=async table=>{await db.exec('reset role');return Number((await db.query('select count(*) n from '+table)).rows[0].n);};
 await t.test('production requests without a challenge save once and create no member or login',async()=>{
  const authBefore=await count('auth.users'),key=crypto.randomUUID();
  first=await send(payload,{key});assert.equal(first.status,200);
  const retry=await send({...payload,bot_token:'unused-token-from-an-old-tab'},{key});assert.equal(retry.status,200);assert.equal(retry.body.reference,first.body.reference);
  assert.deepEqual(Object.keys(first.body).sort(),['message','reference']);
  assert.equal(await count('public.membership_submissions'),1);assert.equal(await count('public.members'),0);assert.equal(await count('auth.users'),authBefore);
  const s=(await db.query('select review_status,payload from public.membership_submissions')).rows[0];assert.equal(s.review_status,'pending');assert.equal(s.payload.bot_token,undefined);assert.equal(s.payload.roles,undefined);
 });
 await t.test('invalid details, missing consent and privileged fields never become pending requests',async()=>{
  const before=await count('public.membership_submissions');
  for(const value of [{...payload,acknowledgement:false},{...payload,phone:'invalid'},{...payload,roles:['owner']},{...payload,email:''},{...payload,whatsapp:''}])assert.equal((await send(value,{ip:'192.0.2.2'})).status,422);
  assert.equal(await count('public.membership_submissions'),before);
 });
 await t.test('the hidden spam trap returns an opaque response without saving a request',async()=>{
  const before=await count('public.membership_submissions'),result=await send({...payload,website:'filled-by-a-bot'},{ip:'192.0.2.3'});
  assert.equal(result.status,200);assert.deepEqual(Object.keys(result.body).sort(),['message','reference']);assert.equal(await count('public.membership_submissions'),before);
 });
 await t.test('the hosted database rate limit still rejects a burst before the eleventh save',async()=>{
  const before=await count('public.membership_submissions'),statuses=[];
  for(let i=0;i<11;i++)statuses.push((await send(payload,{ip:'192.0.2.4'})).status);
  assert.deepEqual(statuses,[...Array(10).fill(200),429]);assert.equal(await count('public.membership_submissions'),before+10);
 });
 await t.test('origin, method, size, retry key and missing server controls fail before RPC writes',async()=>{
  const before=rpcCalls;
  assert.equal((await send(payload,{origin:'https://untrusted.example'})).status,403);
  assert.equal((await send(payload,{method:'GET'})).status,405);
  assert.equal((await send(payload,{headers:{'content-length':'25000'}})).status,413);
  assert.equal((await send('bad json')).status,400);
  assert.equal((await send(payload,{key:null})).status,400);
  assert.equal((await send(payload,{environment:{rateSalt:''}})).status,503);
  assert.equal(rpcCalls,before);
 });
 await t.test('leadership approval creates the member while preserving the separate login count',async()=>{
  const authBefore=await count('auth.users'),submission=(await db.query('select id from public.membership_submissions where reference=$1',[first.body.reference])).rows[0];
  await role(db,'authenticated',OWNER);
  const member=await action(db,'approve_submission',{id:submission.id,reason:'Reviewed isolated API fixture'});
  assert.equal(member.member_no,'SET2018-001');assert.equal((await db.query('select review_status from public.membership_submissions where id=$1',[submission.id])).rows[0].review_status,'approved');
  assert.equal(await count('auth.users'),authBefore);
 });
});

test('the live registration UI submits directly and ignores obsolete challenge configuration',async()=>{
 const {ctx,cleanup}=setup();let registration,submitted;
 try{
  const svc={config:{turnstileSiteKey:'obsolete-widget-setting'},register:async data=>{submitted=data;return {reference:'PENDING-UI-TEST'};}};
  registration=mountRegistration(ctx.container,{brand:ctx.brand,review:false,getService:async()=>svc});await registration.start();
  const form=document.querySelector('#registration'),field=name=>form.querySelector('[name="'+name+'"]'),advance=()=>form.onsubmit({preventDefault(){}});
  for(const [name,value] of Object.entries({full_name:'Isolated UI member',phone:'08012345678',city:'Uyo',country:'Nigeria',email:'ui@example.invalid',whatsapp:'08012345678'}))field(name).value=value;
  await advance();await advance();await advance();field('acknowledgement').checked=true;
  assert.equal(form.querySelector('#bot-check'),null);assert.equal(document.querySelector('script[src*="challenges.cloudflare.com"]'),null);assert.equal(form.querySelector('[type=password]'),null);
  await advance();assert.ok(submitted);assert.equal(submitted.bot_token,undefined);assert.ok(ctx.container.textContent.includes('received for executive review'));assert.ok(ctx.container.textContent.includes('No account or password is needed'));
 }finally{registration?.destroy();cleanup();}
});
