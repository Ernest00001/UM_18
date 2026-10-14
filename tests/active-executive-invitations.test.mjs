import test from 'node:test';
import assert from 'node:assert/strict';
import {database,role,action,OWNER,READER} from './database-harness.mjs';

const makeMember=(db,name,extra={})=>action(db,'save_member',{full_name:name,phone_original:'08012345678',city:'Uyo',country:'Nigeria',skills:[],email:'member@example.invalid',details:{address:'PRIVATE-ADDRESS',emergency_name:'PRIVATE-EMERGENCY'},internal_remarks:'PRIVATE-REMARK',reason:'Approved fictional member for eligibility test',...extra});
const payloadFor=member=>({op:'invite',email:'executive@example.invalid',display_name:'New executive',roles:['read_only'],office_codes:['pro'],member_id:member,reason:'Approved member executive invitation'});
const begin=async(db,key,payload)=>(await db.query('select public.begin_invitation($1,$2::jsonb) d',[key,JSON.stringify(payload)])).rows[0].d;
const provisionSql='select public.provision_invitation_v2($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb) d';
const provisionArgs=(op,id,payload)=>[op.id,op.lease_id,OWNER,id,payload.display_name,payload.email,JSON.stringify(payload.roles),'[]',null,payload.member_id||null,payload.reason,'[]','[]',JSON.stringify(payload.office_codes)];

test('executive member invitations recheck active eligibility without breaking completed retries',async t=>{
 const db=await database();t.after(()=>db.close());let member;
 await t.test('account administration receives only safe active member invitation details',async()=>{
  member=await makeMember(db,'Active invitation member');
  const d=(await db.query('select public.executive_invitation_member($1) d',[member.id])).rows[0].d;
  assert.deepEqual(Object.keys(d).toSorted(),['email','full_name','id','membership_status']);assert.equal(d.membership_status,'active');assert.ok(!JSON.stringify(d).includes('PRIVATE-'));
  await role(db,'authenticated',READER);await assert.rejects(db.query('select public.executive_invitation_member($1)',[member.id]),/Access denied/);
  await role(db,'anon',null);await assert.rejects(db.query('select public.executive_invitation_member($1)',[member.id]),/permission denied/);await role(db,'authenticated',OWNER);
 });
 await t.test('inactive, archived, merged or missing member links create no invitation operation',async()=>{
  const inactive=await makeMember(db,'Inactive invitation member',{membership_status:'inactive'}),archived=await makeMember(db,'Archived invitation member'),source=await makeMember(db,'Merged invitation member'),target=await makeMember(db,'Merge target member');
  await action(db,'archive_member',{id:archived.id,reason:'Archived fictional association membership'});
  await action(db,'merge_members',{id:source.id,target_id:target.id,assessment_policy:'keep_target',attendance_policy:'keep_target',reason:'Reviewed fictional duplicate identity'});
  for(const id of [inactive.id,archived.id,source.id,crypto.randomUUID()]){
   const key=crypto.randomUUID();await assert.rejects(begin(db,key,payloadFor(id)),/active, unarchived/);
   assert.equal((await db.query('select count(*) n from public.invitation_operations where idempotency_key=$1',[key])).rows[0].n,0);
   await assert.rejects(db.query('select public.executive_invitation_member($1)',[id]),/active, unarchived/);
  }
 });
 await t.test('an identity recorded before membership changes receives no executive access',async()=>{
  const candidate=await makeMember(db,'Member changed after invitation'),key=crypto.randomUUID(),payload=payloadFor(candidate.id),op=await begin(db,key,payload),id=crypto.randomUUID();
  await db.exec('reset role');await db.query('insert into auth.users(id,email) values($1,$2)',[id,payload.email]);await role(db,'authenticated',OWNER);
  await db.query('select public.mark_invitation_identity($1,$2,$3)',[op.id,op.lease_id,id]);
  await action(db,'save_member',{...candidate,membership_status:'inactive',reason:'Association membership made inactive before provisioning'});
  await role(db,'service_role',null);await assert.rejects(db.query(provisionSql,provisionArgs(op,id,payload)),/active, unarchived/);
  await db.exec('reset role');assert.equal((await db.query('select count(*) n from public.executive_accounts where id=$1',[id])).rows[0].n,0);assert.equal((await db.query('select state from public.invitation_operations where id=$1',[op.id])).rows[0].state,'pending');await role(db,'authenticated',OWNER);
 });
 await t.test('completed retries retain their identity after later membership inactivity',async()=>{
  const key=crypto.randomUUID(),payload=payloadFor(member.id),op=await begin(db,key,payload),id=crypto.randomUUID();
  await db.exec('reset role');await db.query('insert into auth.users(id,email) values($1,$2)',[id,payload.email]);await role(db,'authenticated',OWNER);await db.query('select public.mark_invitation_identity($1,$2,$3)',[op.id,op.lease_id,id]);
  await role(db,'service_role',null);const first=(await db.query(provisionSql,provisionArgs(op,id,payload))).rows[0].d;assert.equal(first.member_id,member.id);assert.deepEqual(first.office_codes,['pro']);
  await role(db,'authenticated',OWNER);await action(db,'save_member',{...member,membership_status:'inactive',reason:'Later membership inactivity does not replay the earlier invitation'});
  const retry=await begin(db,key,payload);assert.equal(retry.completed,true);assert.equal(retry.user_id,id);await assert.rejects(begin(db,key,{...payload,member_id:null}),/retry changed/);
  await role(db,'service_role',null);assert.equal((await db.query(provisionSql,provisionArgs(op,id,payload))).rows[0].d.id,id);await role(db,'authenticated',OWNER);
 });
 await t.test('trusted executive invitations can omit member linkage while the new guard remains server-only',async()=>{
  const payload={...payloadFor(null),email:'external@example.invalid'},op=await begin(db,crypto.randomUUID(),payload),id=crypto.randomUUID();
  await db.exec('reset role');await db.query('insert into auth.users(id,email) values($1,$2)',[id,payload.email]);await role(db,'authenticated',OWNER);await db.query('select public.mark_invitation_identity($1,$2,$3)',[op.id,op.lease_id,id]);
  await assert.rejects(db.query(provisionSql,provisionArgs(op,id,payload)),/permission denied/);await assert.rejects(db.query('select public.require_active_invitation_member($1)',[member.id]),/permission denied/);
  await role(db,'service_role',null);assert.equal((await db.query(provisionSql,provisionArgs(op,id,payload))).rows[0].d.member_id,null);await assert.rejects(db.query('select public.require_active_invitation_member($1)',[member.id]),/permission denied/);
 });
});
