import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './dom-harness.mjs';
import {renderMembers} from '../public/assets/js/modules/membership.js';
import {renderAccounts} from '../public/assets/js/modules/settings.js';

test('an account administrator can start an executive invitation from an active member without profile-edit access',async()=>{
  const {ctx,cleanup}=setup();let destination;
  try{
    const member=ctx.data.members[0];member.details.address='PRIVATE-HOME-ADDRESS';member.details.emergency_name='PRIVATE-EMERGENCY-CONTACT';member.internal_remarks='PRIVATE-SECRETARY-NOTE';
    ctx.detailId=member.id;ctx.can=permission=>['directory.read','accounts.write'].includes(permission);ctx.navigate=async path=>{destination=path;};
    await renderMembers(ctx);
    const invite=document.querySelector('#invite-member-executive');
    assert.ok(invite);assert.equal(invite.textContent,'Invite to executive workspace');
    assert.equal(document.querySelector('#edit-member'),null);
    assert.equal(document.querySelector('[data-profile-tab=documents]'),null);
    for(const privateValue of ['PRIVATE-HOME-ADDRESS','PRIVATE-EMERGENCY-CONTACT','PRIVATE-SECRETARY-NOTE'])assert.ok(!ctx.container.innerHTML.includes(privateValue));
    invite.click();assert.equal(destination,'/admin/accounts/?invite_member='+member.id);
  }finally{cleanup();}
});

test('executive invitation is unavailable for inactive, archived, merged or unauthorised member profiles',async()=>{
  const {ctx,cleanup}=setup();
  try{
    const member=ctx.data.members[0];ctx.detailId=member.id;
    for(const state of [
      {membership_status:'inactive',archived_at:null,merged_into_member_id:null},
      {membership_status:'active',archived_at:'2026-10-14T09:00:00Z',merged_into_member_id:null},
      {membership_status:'active',archived_at:null,merged_into_member_id:ctx.data.members[1].id}
    ]){
      Object.assign(member,state);ctx.can=permission=>['directory.read','accounts.write'].includes(permission);
      await renderMembers(ctx);assert.equal(document.querySelector('#invite-member-executive'),null);
    }
    Object.assign(member,{membership_status:'active',archived_at:null,merged_into_member_id:null});
    ctx.can=permission=>['directory.read','members.write'].includes(permission);await renderMembers(ctx);
    assert.equal(document.querySelector('#invite-member-executive'),null,'Membership editing must not confer account invitations.');
    ctx.can=permission=>permission==='directory.read';await renderMembers(ctx);
    assert.equal(document.querySelector('#invite-member-executive'),null);
  }finally{cleanup();}
});

test('member invitation context prefills the approved alumni identity without assigning an office or access role',async()=>{
  const {ctx,cleanup}=setup(),priorSearch=location.search;
  try{
    const member=ctx.data.members[1];location.search='?invite_member='+member.id;
    await renderAccounts(ctx);
    const form=document.querySelector('dialog form');assert.ok(form);
    assert.equal(form.querySelector('[name=display_name]').value,member.full_name);
    assert.equal(form.querySelector('[name=email]').value,member.email);
    assert.equal(form.querySelector('[name=member_id]').value,member.id);
    assert.equal(form.querySelectorAll('[name=roles][checked]').length,0);
    assert.equal(form.querySelectorAll('[name=office_codes][checked]').length,0);
  }finally{location.search=priorSearch;cleanup();}
});

test('an inactive member cannot open a prefilled executive invitation by navigating directly',async()=>{
  const {ctx,cleanup}=setup(),priorSearch=location.search;
  try{
    const member=ctx.data.members.find(record=>record.membership_status==='inactive');location.search='?invite_member='+member.id;
    await renderAccounts(ctx);
    assert.equal(document.querySelector('dialog [name=member_id]'),null);
    assert.ok(document.querySelector('#invitation-member-error'));
  }finally{location.search=priorSearch;cleanup();}
});
