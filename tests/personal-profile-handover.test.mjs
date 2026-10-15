import test from 'node:test';
import assert from 'node:assert/strict';
import {database,role,action,OWNER,READER,FINANCE} from './database-harness.mjs';
import {setup} from './dom-harness.mjs';
import {renderMyProfile} from '../public/assets/js/modules/profile.js';
import {renderAccounts} from '../public/assets/js/modules/settings.js';
import {renderMembers} from '../public/assets/js/modules/membership.js';
import {localMemberContributions} from '../public/assets/js/member-contributions.js';

const root=async(db,sql,args=[])=>{await db.exec('reset role');return db.query(sql,args);};
const rpc=async(db,name,p,key=crypto.randomUUID())=>(await db.query(`select public.${name}($1::jsonb,$2) d`,[p,key])).rows[0].d;
const personal=(email,member_id)=>({full_name:'Isolated Personal Member',email,phone_original:'08012345678',whatsapp:'08012345678',city:'Uyo',country:'Nigeria',region:'Akwa Ibom',member_id,reason:'Member confirmed these personal contact details'});
const complete=async db=>(await db.query('select public.complete_executive_membership() d')).rows[0].d;

test('personal identity, contributions and presidential transfer enforce live authority',async t=>{
 const db=await database();t.after(()=>db.close());let own,successor,readerMember,payment,monthly,special;
 await root(db,'update auth.users set email_confirmed_at=now()');await role(db,'authenticated',OWNER);await complete(db);
 own=(await db.query('select public.my_profile() d')).rows[0].d.member;
 await t.test('personal contact updates preserve credentials, ID and private fields; protected fields are rejected',async()=>{
  await action(db,'save_member',{...personal('person@example.invalid',own.id),id:own.id,details:{address:'PRIVATE-ADDRESS',whatsapp:'08012345678'},internal_remarks:'PRIVATE-REMARK',skills:['Mentoring'],membership_status:'active'});
  const p=personal('personal@example.invalid',own.id),key=crypto.randomUUID();
  const saved=await rpc(db,'save_my_profile',p,key);assert.equal(saved.member.id,own.id);assert.equal(saved.member.member_no,own.member_no);assert.equal(saved.account.email,'owner@example.invalid');
  assert.equal((await rpc(db,'save_my_profile',p,key)).member.id,own.id);await assert.rejects(rpc(db,'save_my_profile',{...p,email:'different@example.invalid'},key),/Retry key/);
  assert.equal(JSON.stringify(saved).includes('PRIVATE-'),false);
  for(const patch of [{roles:['owner']},{membership_status:'inactive'},{email:'unmatched018@gmail.com'},{whatsapp:''}])await assert.rejects(rpc(db,'save_my_profile',{...p,...patch}));
  const m=(await root(db,'select * from public.members where id=$1',[own.id])).rows[0];assert.equal(m.details.address,'PRIVATE-ADDRESS');assert.equal(m.internal_remarks,'PRIVATE-REMARK');assert.deepEqual(m.skills,['Mentoring']);await role(db,'authenticated',OWNER);
 });
 await t.test('confirmed personal sign-in changes require the saved member email and a fresh matching signed email claim',async()=>{
  await root(db,'update auth.users set email=$1 where id=$2',['personal@example.invalid',OWNER]);await role(db,'authenticated',OWNER);
  await assert.rejects(complete(db),/confirm the email change/);
  await db.query("select set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('email','personal@example.invalid'))::text,false)");
  await complete(db);assert.equal((await db.query('select public.my_profile() d')).rows[0].d.account.email,'personal@example.invalid');
 });
 await t.test('another executive edits only their own profile and password-less sessions cannot read it',async()=>{
  await role(db,'authenticated',READER);await complete(db);readerMember=(await db.query('select public.my_profile() d')).rows[0].d.member;
  await assert.rejects(rpc(db,'save_my_profile',personal('reader@example.invalid',own.id)),/Confirm your identity/);
  await rpc(db,'save_my_profile',personal('testreader@example.invalid',readerMember.id));
  await role(db,'authenticated',READER,'aal1');await assert.rejects(db.query('select public.my_profile()'),/Access denied/);await role(db,'authenticated',OWNER);
 });
 await t.test('approved membership is mandatory for new UI invitations and presidential title is protected',async()=>{
  successor=await action(db,'save_member',{...personal('next@example.invalid'),full_name:'Approved Successor',details:{whatsapp:'08012345678'},membership_status:'active'});
  const p={op:'invite',display_name:successor.full_name,email:successor.email,roles:['read_only'],office_codes:[],member_id:successor.id,include_membership:true,approved_member_invitation:true,reason:'Approved successor preparation'};
  for(const patch of [{member_id:null},{email:'wrong@example.invalid'},{office_codes:['president']}])await assert.rejects(db.query('select public.begin_invitation($1,$2) d',[crypto.randomUUID(),{...p,...patch}]));
  assert.ok((await db.query('select public.begin_invitation($1,$2) d',[crypto.randomUUID(),p])).rows[0].d.id);
  await assert.rejects(action(db,'save_account',{id:READER,display_name:'Reader',office_codes:['president'],roles:['owner'],active:true,reason:'Bypass attempt'}),/protected presidential/);
  await assert.rejects(action(db,'save_account',{id:OWNER,display_name:'Owner',office_codes:[],roles:['owner'],active:true,reason:'Bypass removal'}),/protected presidential/);
 });
 await t.test('directory readers see net contribution totals, advance monthly coverage and special contributions without private receipt fields',async()=>{
  monthly=await action(db,'save_collection',{title:'Future January dues',purpose:'Advance dues',category:'monthly',period:'2027-01',participation:'compulsory',amount_kobo:200000});
  special=await action(db,'save_collection',{title:'Special project',purpose:'Approved special project',category:'project',participation:'compulsory',amount_kobo:100000});
  for(const c of [monthly,special])await action(db,'publish_collection',{id:c.id,member_ids:[readerMember.id],reason:'Approved contribution schedule'});
  payment=await action(db,'record_payment',{member_id:readerMember.id,amount_kobo:350000,payment_date:'2026-10-15',method:'bank_transfer',reference:'PRIVATE-BANK-REFERENCE',notes:'PRIVATE-NOTES',verified:true,reason:'Verified isolated receipt',allocations:[{collection_id:monthly.id,amount_kobo:200000},{collection_id:special.id,amount_kobo:100000}]});
  await action(db,'adjust_payment',{id:payment.id,kind:'refund',delta_kobo:-10000,effective_date:'2026-10-15',reason:'Return some unallocated credit',allocations:[{collection_id:monthly.id,amount_kobo:200000},{collection_id:special.id,amount_kobo:100000}]});
  await action(db,'record_payment',{member_id:readerMember.id,amount_kobo:990000,payment_date:'2026-10-15',method:'cash',verified:false,reason:'Unverified isolated receipt'});
  await role(db,'authenticated',READER);const summary=(await db.query('select public.member_contributions($1) d',[readerMember.id])).rows[0].d;
  assert.equal(summary.total_confirmed_kobo,340000);assert.equal(summary.monthly_kobo,200000);assert.equal(summary.special_kobo,100000);assert.equal(summary.credit_kobo,40000);assert.equal(summary.outstanding_kobo,0);assert.equal(summary.payments.length,1);assert.ok(summary.coverage.some(c=>c.period==='2027-01'));assert.ok(!JSON.stringify(summary).includes('PRIVATE-'));
  await assert.rejects(action(db,'allocate_payment',{id:payment.id,allocations:[],reason:'Reader cannot edit'}),/Access denied/);
  await role(db,'anon',null);await assert.rejects(db.query('select public.member_contributions($1)',[readerMember.id]));await role(db,'authenticated',OWNER);
 });
 await t.test('handover requires accepted personal identity, password sign-in and explicit mailbox acknowledgement',async()=>{
  const p={member_id:successor.id,reason:'Board election approved',confirmed:true,mailbox_handover_acknowledged:true};
  await assert.rejects(action(db,'handover_presidency',p),/successor must accept/);
  await root(db,'update public.executive_accounts set member_id=$1 where id=$2',[successor.id,FINANCE]);await role(db,'authenticated',OWNER);
  await assert.rejects(action(db,'handover_presidency',p),/successor must accept/);
  await root(db,'update auth.users set email=$1 where id=$2',[successor.email,FINANCE]);await root(db,'update public.executive_accounts set email=$1,access_pending=false where id=$2',[successor.email,FINANCE]);
  await role(db,'authenticated',FINANCE);await complete(db);await role(db,'authenticated',OWNER);
  const candidate=(await db.query('select public.presidential_candidates() d')).rows[0].d.find(c=>c.member_id===successor.id);assert.equal(candidate.ready,true);
  await assert.rejects(action(db,'handover_presidency',{...p,mailbox_handover_acknowledged:false}),/Confirm the successor/);
  await role(db,'authenticated',READER);await assert.rejects(db.query('select public.presidential_candidates()'),/Access denied/);await role(db,'authenticated',OWNER);
  const result=await action(db,'handover_presidency',p);assert.equal(result.completed,true);assert.equal(result.president_id,FINANCE);
  assert.equal((await db.query("select public.has_permission('accounts.write') ok")).rows[0].ok,false);await assert.rejects(db.query('select public.my_profile()'),/Access denied/);
  const members=(await root(db,'select * from public.members where id in ($1,$2)',[own.id,successor.id])).rows;assert.equal(members.length,2);assert.ok(members.every(m=>m.membership_status==='active'));
  const assignments=(await root(db,"select executive_id from public.role_assignments where role_code='owner' and revoked_at is null")).rows;assert.deepEqual(assignments.map(a=>a.executive_id),[FINANCE]);
  await role(db,'authenticated',FINANCE);assert.equal((await complete(db)).permissions.includes('accounts.write'),true);await assert.rejects(action(db,'restore_executive',{id:OWNER,reason:'Former President needs a new appointment'}),/Assign a new office/);
 });
});

test('President explicitly resolves an organisation placeholder while retaining the real membership and ledger',async t=>{
 const db=await database();t.after(()=>db.close());await root(db,"update auth.users set email='unmatched018@gmail.com',email_confirmed_at=now() where id=$1",[OWNER]);await root(db,"update public.executive_accounts set email='unmatched018@gmail.com' where id=$1",[OWNER]);await role(db,'authenticated',OWNER);await complete(db);
 const placeholder=(await db.query('select public.my_profile() d')).rows[0].d;assert.equal(placeholder.can_resolve_placeholder,true);
 const member=await action(db,'save_member',{...personal('actual@example.invalid'),full_name:'Actual Approved Member',membership_status:'active',details:{whatsapp:'08012345678'}});
 const receipt=await action(db,'record_payment',{member_id:placeholder.member.id,amount_kobo:10000,payment_date:'2026-10-15',method:'cash',verified:true,reason:'Isolated placeholder receipt'});
 const p=personal('actual@example.invalid',member.id);await assert.rejects(rpc(db,'save_my_profile',p),/Confirm your identity/);
 const saved=await rpc(db,'save_my_profile',{...p,link_confirmed:true});assert.equal(saved.member.id,member.id);assert.equal(saved.member.member_no,member.member_no);assert.equal(saved.account.email,'unmatched018@gmail.com');
 assert.equal((await root(db,'select member_id from public.payments where id=$1',[receipt.id])).rows[0].member_id,member.id);
 assert.equal((await root(db,'select merged_into_member_id from public.members where id=$1',[placeholder.member.id])).rows[0].merged_into_member_id,member.id);
});

test('My profile retry, personal editing and confirmation request controls work independently',async()=>{
 const {ctx,cleanup}=setup();try{let fail=true,saved,requested;const member={...personal('personal@example.invalid','profile-id'),id:'profile-id',member_no:'SET2018-111'};
  ctx.svc.myProfile=async()=>{if(fail)throw new Error('Connection interrupted');return {account:{id:ctx.user.id,email:'office@example.invalid',office_codes:['president']},member,official_email:'office@example.invalid'};};ctx.svc.saveMyProfile=async p=>{saved=p;};ctx.svc.changeSigninEmail=async email=>{requested=email;};
  await renderMyProfile(ctx);assert.ok(document.querySelector('#retry-my-profile'));fail=false;await document.querySelector('#retry-my-profile').onclick();
  const form=document.querySelector('#personal-profile');form.elements.reason.value='Member checked their contact details';await form.onsubmit({preventDefault(){}});assert.equal(saved.member_id,'profile-id');assert.equal(saved.email,'personal@example.invalid');assert.equal(saved.roles,undefined);
  const button=document.querySelector('#change-personal-signin');await button.onclick({target:button});assert.equal(requested,'personal@example.invalid');assert.match(document.querySelector('#signin-change-status').textContent,/Confirmation requested/);
 }finally{cleanup();}
});

test('non-financial executives see safe contribution history and mobile cards keep only summary details',async()=>{
 const {ctx,cleanup}=setup();try{const member=ctx.data.members[0];ctx.can=p=>p==='directory.read';ctx.detailId=member.id;ctx.svc.memberContributions=async id=>localMemberContributions(ctx.data,id);await renderMembers(ctx);assert.ok(document.querySelector('[data-profile-tab=contributions]'));assert.equal(document.querySelector('[data-profile-tab=finance]'),null);document.querySelector('[data-profile-tab=contributions]').click();assert.ok(document.querySelector('#profile-section').textContent.includes('Monthly'));assert.equal(document.querySelector('#profile-section a[href*="payments"]'),null);
  ctx.detailId=null;await renderMembers(ctx);const card=document.querySelector('#members-table .mobile-record');assert.ok(card);assert.ok(!card.textContent.includes('Occupation'));assert.ok(!card.textContent.includes('Skills'));assert.ok(card.querySelector('a[href*="?id="]'));
 }finally{cleanup();}
});

test('presidential handover UI checks readiness and sends an explicit confirmed transfer',async()=>{
 const {ctx,cleanup}=setup();try{ctx.user.office_codes=['president'];let sent,loggedOut=false,destination;const member=ctx.data.members[1];
  ctx.svc.presidentialCandidates=async()=>[{member_id:member.id,member_no:member.member_no,full_name:member.full_name,executive_id:'successor-account',ready:true,status:'Ready for review'}];ctx.act=async(name,p)=>{sent={name,p};};ctx.svc.logout=async()=>{loggedOut=true;};ctx.navigate=async path=>{destination=path;};
  await renderAccounts(ctx);const selector=document.querySelector('[name=successor_member]');selector.value=member.id;selector.dispatchEvent(new window.Event('change'));assert.equal(document.querySelector('#complete-presidency').disabled,false);document.querySelector('#complete-presidency').click();
  const form=document.querySelector('dialog form');form.elements.reason.value='Election recorded in the board minutes';await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(sent,undefined);assert.match(form.querySelector('.form-error').textContent,/Confirm/);
  form.elements.confirmed.checked=true;form.elements.mailbox_handover_acknowledged.checked=true;await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(sent.name,'handover_presidency');assert.equal(sent.p.member_id,member.id);assert.equal(sent.p.confirmed,true);assert.equal(sent.p.mailbox_handover_acknowledged,true);assert.equal(loggedOut,true);assert.equal(destination,'/admin/login/');
 }finally{cleanup();}
});
