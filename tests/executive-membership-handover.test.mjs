import test from 'node:test';
import assert from 'node:assert/strict';
import {database,role,action,OWNER,READER} from './database-harness.mjs';

async function invite(db,{email,office='pro',replacement,member=null,confirmed=true}={}){
 await role(db,'authenticated',OWNER);
 const p={op:'invite',display_name:email.split('@')[0]+' Executive',email,roles:['read_only'],office_codes:[office],member_id:member,include_membership:true,reason:'Approved executive appointment',...(replacement?{replaces_executive_id:replacement}:{})};
 const key=crypto.randomUUID(),op=(await db.query('select public.begin_invitation($1,$2) d',[key,p])).rows[0].d,id=crypto.randomUUID();
 await db.exec('reset role');await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)',[id,email,confirmed?new Date().toISOString():null]);
 await role(db,'authenticated',OWNER);await db.query('select public.mark_invitation_identity($1,$2,$3)',[op.id,op.lease_id,id]);await role(db,'service_role',null);
 await db.query('select public.provision_invitation_v2($1,$2,$3,$4,$5,$6,$7,$8,null,$9,$10,$11,$12,$13)',[op.id,op.lease_id,OWNER,id,p.display_name,email,p.roles,[],member,p.reason,[],[],p.office_codes]);
 return {id,p,key,op};
}
const complete=async db=>(await db.query('select public.complete_executive_membership() d')).rows[0].d;
const root=async(db,sql,args=[])=>{await db.exec('reset role');return db.query(sql,args);};
const account=async(db,id)=>(await root(db,'select * from public.executive_accounts where id=$1',[id])).rows[0];
async function fresh(db,id,aal='aal2'){await role(db,'authenticated',id,aal);await db.query("select set_config('request.jwt.claims',((current_setting('request.jwt.claims')::jsonb)||jsonb_build_object('iat',floor(extract(epoch from now()))+10))::text,false)");}

test('confirmed executive membership and controlled handover preserve the complete register',async t=>{
 const db=await database();t.after(()=>db.close());let first,firstMember,next,other;
 await t.test('existing confirmed President is linked exactly once with genuinely unknown contact fields blank',async()=>{
  await root(db,'update auth.users set email_confirmed_at=now() where id=$1',[OWNER]);await role(db,'authenticated',OWNER);
  await complete(db);await complete(db);const a=await account(db,OWNER);assert.ok(a.member_id);
  const m=(await root(db,'select * from public.members where id=$1',[a.member_id])).rows[0];assert.equal(m.full_name,'Test Owner');assert.equal(m.phone_original,null);assert.equal(m.city,null);assert.equal(m.country,null);assert.equal(m.profile_incomplete,true);
  assert.equal((await root(db,'select count(*) n from public.members')).rows[0].n,1);
 });
 await t.test('invitation acceptance requires password setup before member enrollment and workspace access',async()=>{
  first=await invite(db,{email:'First@example.invalid'});assert.equal((await account(db,first.id)).member_id,null);
  await role(db,'authenticated',first.id,'aal1');const context=await complete(db);assert.equal(context.needs_password,true);assert.equal(context.invitation_pending,true);assert.deepEqual(context.permissions,[]);
  await assert.rejects(db.query("select public.workspace_data('members')"),/Access denied/);
  assert.equal((await account(db,first.id)).member_id,null);
  await role(db,'authenticated',first.id,'aal1','password');assert.equal((await complete(db)).invitation_pending,undefined);firstMember=(await account(db,first.id)).member_id;assert.ok(firstMember);assert.equal((await account(db,first.id)).access_pending,false);
  await role(db,'authenticated',OWNER);const results=(await db.query("select public.search_members('First') d")).rows[0].d;assert.equal(results.count,1);assert.deepEqual(results.rows[0].executive_offices,['pro']);
  const snapshot=(await db.query("select public.workspace_data('reports') d")).rows[0].d;assert.ok(snapshot.members.some(m=>m.id===firstMember&&m.executive_offices.includes('pro')));
 });
 await t.test('removal, restoration and retries preserve membership and invalidate old tokens',async()=>{
  const key=crypto.randomUUID(),p={id:first.id,reason:'Executive temporarily relieved of office'};
  const removed=await action(db,'remove_executive',p,key);assert.equal(removed.active,false);assert.equal(removed.member_id,firstMember);assert.equal((await action(db,'remove_executive',p,key)).id,first.id);
  await role(db,'authenticated',first.id);await assert.rejects(db.query("select public.workspace_data('members')"),/Access denied/);
  await role(db,'authenticated',OWNER);await action(db,'restore_executive',{id:first.id,reason:'Executive reinstated following review'});
  await role(db,'authenticated',first.id);await assert.rejects(db.query("select public.workspace_data('members')"),/Access denied/);
  await fresh(db,first.id);assert.ok((await complete(db)).permissions.includes('directory.read'));assert.equal((await account(db,first.id)).member_id,firstMember);
 });
 await t.test('two replacements can be invited but only one can finish the same handover',async()=>{
  next=await invite(db,{email:'next@example.invalid',replacement:first.id});other=await invite(db,{email:'other@example.invalid',replacement:first.id});
  await role(db,'authenticated',next.id,'aal1');assert.equal((await complete(db)).needs_password,true);assert.equal((await account(db,first.id)).active,true);
  await role(db,'authenticated',next.id,'aal1','password');assert.equal((await complete(db)).invitation_pending,undefined);
  assert.equal((await account(db,first.id)).active,false);assert.equal((await account(db,first.id)).member_id,firstMember);
  await role(db,'authenticated',other.id);const pending=await complete(db);assert.equal(pending.invitation_pending,true);assert.match(pending.invitation_message,/appointment changed/);
  await assert.rejects(db.query("select public.workspace_data('members')"),/Access denied/);
  await role(db,'authenticated',OWNER);await assert.rejects(action(db,'restore_executive',{id:first.id,reason:'Attempt restore into occupied office'}),/office is occupied/);
  const rows=(await db.query("select public.search_members('') d")).rows[0].d.rows;assert.ok(rows.some(m=>m.id===firstMember));assert.equal(rows.find(m=>m.id===firstMember).executive_offices.length,0);assert.equal(rows.filter(m=>m.executive_offices.includes('pro')).length,1);
 });
 await t.test('President/system administrator protection, live permission checks and completed retries hold',async()=>{
  await assert.rejects(action(db,'remove_executive',{id:OWNER,reason:'Cannot remove the President'}),/separate controlled handover/);
  await assert.rejects(action(db,'restore_executive',{id:OWNER,reason:'Cannot manipulate President'}),/separate controlled handover/);
  await assert.rejects(invite(db,{email:'bad@example.invalid',office:'president',replacement:OWNER}),/controlled handover/);
  await role(db,'authenticated',READER);await assert.rejects(action(db,'remove_executive',{id:next.id,reason:'Not authorised'}),/Access denied/);
  await role(db,'authenticated',OWNER);const retry=(await db.query('select public.begin_invitation($1,$2) d',[first.key,first.p])).rows[0].d;assert.equal(retry.completed,true);assert.equal(retry.user_id,first.id);
  await role(db,'anon',null);await assert.rejects(db.query('select public.complete_executive_membership()'),/permission denied/);
  await role(db,'authenticated',OWNER);await assert.rejects(db.query('select um18_internal.ensure_executive_member($1,$1)',[OWNER]),/permission denied/);
 });
});

test('membership linking reuses unique email, rejects ambiguous or unconfirmed identities and checks inviter authority',async t=>{
 const db=await database();t.after(()=>db.close());
 const existing=await action(db,'save_member',{full_name:'Existing Alumni',phone_original:'08012345678',city:'Uyo',country:'Nigeria',email:'existing@example.invalid',reason:'Confirmed existing member'});
 const linked=await invite(db,{email:'EXISTING@example.invalid'});await role(db,'authenticated',linked.id);await complete(db);assert.equal((await account(db,linked.id)).member_id,existing.id);
 const unsigned=await invite(db,{email:'notaccepted@example.invalid',office:'auditor_general',confirmed:false});await role(db,'authenticated',unsigned.id);await assert.rejects(complete(db),/Accept the invitation/);assert.equal((await account(db,unsigned.id)).member_id,null);
 await role(db,'authenticated',OWNER);for(const name of ['First ambiguous','Second ambiguous'])await action(db,'save_member',{full_name:name,phone_original:'08012345678',city:'Uyo',country:'Nigeria',email:'ambiguous@example.invalid',reason:'Two distinct approved members sharing email'});
 const ambiguous=await invite(db,{email:'ambiguous@example.invalid',office:'secretary'});await role(db,'authenticated',ambiguous.id);assert.equal((await complete(db)).invitation_pending,true);assert.equal((await account(db,ambiguous.id)).member_id,null);
 const revoked=await invite(db,{email:'revokedapproval@example.invalid',office:'treasurer'});await root(db,'update public.executive_accounts set mfa_recovery_pending=true where id=$1',[OWNER]);await role(db,'authenticated',revoked.id);await assert.rejects(complete(db),/new approval/);assert.equal((await account(db,revoked.id)).access_pending,true);
});
