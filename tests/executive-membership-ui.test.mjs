import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './dom-harness.mjs';
import {renderAccounts} from '../public/assets/js/modules/settings.js';
import {renderMembers} from '../public/assets/js/modules/membership.js';
import {renderAuth} from '../public/assets/js/modules/auth.js';
import {fullMembershipRegister,membershipRow} from '../public/assets/js/membership-register.js';
import {reportData} from '../public/assets/js/report-data.js';

test('President can remove and restore through an audited dialog; replacing prefills offices, not the outgoing identity',async()=>{
 const {ctx,cleanup}=setup();try{
  ctx.user.office_codes=['president'];const executive={id:crypto.randomUUID(),display_name:'Outgoing Treasurer',email:'outgoing@example.invalid',roles:['treasurer'],office_codes:['treasurer'],active:true,extra_permissions:['accounts.write']};ctx.data.accounts.push(executive);
  let saved;ctx.act=async(name,p)=>{saved={name,p};};await renderAccounts(ctx);
  assert.equal(document.querySelector(`[data-executive-access="${ctx.user.id}"]`),null);
  document.querySelector(`[data-executive-access="${executive.id}"]`).click();let form=document.querySelector('dialog form');form.elements.reason.value='Change approved at board meeting';await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(saved.name,'remove_executive');assert.equal(saved.p.id,executive.id);
  executive.active=false;await renderAccounts(ctx);document.querySelector(`[data-executive-access="${executive.id}"]`).click();form=document.querySelector('dialog form');form.elements.reason.value='Restore board appointment';await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(saved.name,'restore_executive');
  executive.active=true;await renderAccounts(ctx);document.querySelector(`[data-replace-executive="${executive.id}"]`).click();form=document.querySelector('dialog form');assert.equal(form.elements.display_name.value,'');assert.equal(form.elements.email.value,'');assert.ok(form.querySelector('[name=office_codes][value=treasurer]').checked);assert.ok(form.querySelector('[name=roles][value=treasurer]').checked);assert.equal(form.querySelector('[name=permissions][value="accounts.write"]').checked,false);
  const replacement=ctx.data.members.find(m=>m.membership_status==='active');form.elements.member_id.value=replacement.id;let invitation;ctx.svc.invite=async p=>{invitation=p;};form.elements.display_name.value='Replacement Treasurer';form.elements.email.value='replacement@example.invalid';form.elements.reason.value='New election approved';await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(invitation.replaces_executive_id,executive.id);assert.equal(invitation.member_id,replacement.id);
 }finally{cleanup();}
});

test('non-President cannot see quick handover controls and pending invitations are clearly labelled',async()=>{
 const {ctx,cleanup}=setup();try{ctx.user={...ctx.user,office_codes:['secretary']};ctx.data.accounts.push({id:crypto.randomUUID(),display_name:'Pending Treasurer',email:'pending@example.invalid',roles:['treasurer'],office_codes:['treasurer'],active:true,access_pending:true});await renderAccounts(ctx);assert.equal(document.querySelector('[data-executive-access]'),null);assert.equal(document.querySelector('[data-replace-executive]'),null);assert.match(ctx.container.textContent,/invitation pending/);}finally{cleanup();}
});

test('full register fetches every server page without screen filters and includes executives, former executives and blank details',async()=>{
 const rows=Array.from({length:205},(_,i)=>({id:String(i).padStart(3,'0'),member_no:'SET2018-'+i,full_name:'Member '+i,phone_original:null,city:null,country:null,membership_status:i%2?'inactive':'active',executive_offices:i===0?['president']:[]}));rows.push({...rows[1],id:'merged',merged_into_member_id:rows[1].id});const calls=[];
 const all=await fullMembershipRegister({searchMembers:async p=>{calls.push(p);return {count:rows.length,rows:rows.slice(p.offset,p.offset+p.limit)};}});
 assert.equal(all.length,205);assert.deepEqual(calls.map(p=>p.offset),[0,100,200]);assert.ok(calls.every(p=>p.query===''&&p.status===''&&p.country===''));
 assert.equal(membershipRow(all.find(m=>m.id==='000')).at(-1),'President');assert.equal(membershipRow(all[0])[2],null);assert.ok(all.some(m=>m.membership_status==='inactive'));
 const {ctx,cleanup}=setup();try{ctx.data.members=all;const report=reportData(ctx.data,'membership');assert.equal(report.rows.length,205);assert.equal(report.rows.find(r=>r[0]==='SET2018-0').at(-1),'President');await renderMembers(ctx);assert.ok(document.querySelector('#print-full-membership'));assert.match(ctx.container.textContent,/Not provided/);assert.ok(!ctx.container.textContent.includes('null'));}finally{cleanup();}
});

test('incomplete pagination fails instead of silently printing a partial register',async()=>{
 await assert.rejects(fullMembershipRegister({searchMembers:async()=>({count:2,rows:[]})}),/complete register/);
});

test('pending handover shows a review state with retry and sign-out instead of private workspace',async()=>{
 const {ctx,cleanup}=setup();try{ctx.review=false;ctx.user={id:'pending',invitation_pending:true,needs_mfa:false,invitation_message:'The outgoing appointment changed.'};let successes=0,checks=0;ctx.svc.session=async()=>{checks++;return {...ctx.user,invitation_pending:false};};await renderAuth(ctx.container,ctx,async()=>{successes++;});assert.match(ctx.container.textContent,/outgoing appointment changed/);assert.equal(document.querySelector('#login-form'),null);await document.querySelector('#retry-invitation').onclick({target:document.querySelector('#retry-invitation')});assert.equal(checks,1);assert.equal(successes,1);}finally{cleanup();}
});
