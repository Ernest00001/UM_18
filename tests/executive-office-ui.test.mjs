import test from 'node:test';
import assert from 'node:assert/strict';
import {ALL_PERMISSIONS} from '../public/assets/js/domain.js';
import {EXECUTIVE_OFFICES,ACCESS_ROLES,ACCESS_ROLE_PERMISSIONS,OFFICE_WORKSPACES,officeLabels,officeWorkspaces,suggestedAccess,validOfficeCodes} from '../public/assets/js/executive-offices.js';
import {renderAccounts} from '../public/assets/js/modules/settings.js';
import {renderMembers} from '../public/assets/js/modules/membership.js';
import {renderContacts} from '../public/assets/js/modules/operations.js';
import {renderOverview} from '../public/assets/js/modules/overview.js';
import {setup} from './dom-harness.mjs';

const offices = [
  ['president','President'],
  ['vice_president','Vice President'],
  ['secretary','Secretary'],
  ['assistant_secretary','Assistant Secretary'],
  ['treasurer','Treasurer'],
  ['assistant_treasurer','Assistant Treasurer'],
  ['pro','PRO'],
  ['financial_secretary','Financial Secretary'],
  ['assistant_financial_secretary','Assistant Financial Secretary'],
  ['community_event_manager','Community / Event Manager'],
  ['auditor_general','Auditor General']
];
const checked = (form,name) => Array.from(form.querySelectorAll(`[name="${name}"]`)).filter(field=>field.checked).map(field=>field.value);
const field = (form,name,value) => form.querySelector(`[name="${name}"][value="${value}"]`);
const submit = async form => {
  await form.onsubmit({preventDefault(){},currentTarget:form});
  assert.equal(form.querySelector('.form-error').textContent,'');
};

test('office catalog retains the eleven requested offices and one combined community/event office',()=>{
  assert.deepEqual(EXECUTIVE_OFFICES.map(office=>[office.code,office.label]),offices);
  assert.equal(validOfficeCodes(offices.map(([code])=>code)),true);
  assert.equal(validOfficeCodes(['pro','pro']),false);
  assert.equal(validOfficeCodes(['community_manager']),false);
  assert.equal(validOfficeCodes('president'),false);
  assert.deepEqual(officeLabels(['auditor_general','pro']),['PRO','Auditor General']);
  assert.ok(ACCESS_ROLES.some(([code])=>code==='owner'),'Owner access remains separately assignable.');
});

test('responsibility suggestions combine approved duties without granting owner or member edits to the PRO',()=>{
  for(const office of EXECUTIVE_OFFICES){
    const suggested=suggestedAccess([office.code]);
    assert.ok(!suggested.roles.includes('owner'));
    assert.ok(suggested.permissions.every(permission=>ALL_PERMISSIONS.includes(permission)));
    for(const permission of ['accounts.write','accounts.mfa_reset','settings.write','welfare.read','welfare.assign'])assert.ok(!suggested.permissions.includes(permission));
  }
  const pro=suggestedAccess(['pro']),effective=new Set([...pro.permissions,...pro.roles.flatMap(role=>ACCESS_ROLE_PERMISSIONS[role]||[])]);
  for(const permission of ['directory.read','contacts.read','contacts.write','events.write','documents.write'])assert.ok(effective.has(permission));
  assert.equal(effective.has('members.write'),false);
  assert.equal(effective.has('finance.write'),false);
  const auditor=suggestedAccess(['auditor_general']);
  assert.ok(auditor.permissions.includes('finance.read'));
  assert.ok(auditor.permissions.includes('finance.export'));
  assert.ok(!auditor.permissions.includes('finance.write'));
  const combined=suggestedAccess(['pro','auditor_general','pro']);
  assert.deepEqual(combined.roles,['read_only']);
  assert.equal(new Set(combined.permissions).size,combined.permissions.length);
  assert.deepEqual(suggestedAccess(['unrecognised']),{roles:[],permissions:[]});
});

test('invitation office selection requires deliberate suggestions and retains approved offices, denials and dates',async()=>{
  const {ctx,cleanup}=setup(),priorTimeout=globalThis.setTimeout;let invitation,refreshes=0;
  try{
    globalThis.setTimeout=()=>0;
    ctx.svc.invite=async payload=>{invitation=payload;};ctx.refresh=async()=>{refreshes++;};
    await renderAccounts(ctx);document.querySelector('#invite-executive').click();
    const form=document.querySelector('dialog form');form.elements.member_id.value=ctx.data.members.find(m=>m.membership_status==='active').id;
    form.querySelector('[name=display_name]').value='Fictional PRO';
    form.querySelector('[name=email]').value='pro@example.invalid';
    form.querySelector('[name=reason]').value='Approved outreach responsibilities';
    field(form,'office_codes','pro').checked=true;
    field(form,'office_codes','community_event_manager').checked=true;
    assert.deepEqual(checked(form,'roles'),[],'An office selection alone must not grant access.');
    field(form,'denied_permissions','finance.export').checked=true;
    form.querySelector('[name=start_read_only]').value='2026-10-14T09:00';
    form.querySelector('[name=expiry_read_only]').value='2027-10-14T09:00';
    form.querySelector('#apply-suggested-access').click();
    assert.deepEqual(checked(form,'roles'),['read_only']);
    assert.deepEqual(checked(form,'denied_permissions'),['finance.export']);
    assert.equal(form.querySelector('[name=start_read_only]').value,'2026-10-14T09:00');
    assert.equal(form.querySelector('[name=expiry_read_only]').value,'2027-10-14T09:00');
    await submit(form);
    assert.deepEqual(invitation.office_codes,['pro','community_event_manager']);
    assert.deepEqual(invitation.roles,['read_only']);
    assert.deepEqual(new Set(invitation.permissions),new Set(suggestedAccess(invitation.office_codes).permissions));
    assert.deepEqual(invitation.denied_permissions,['finance.export']);
    assert.equal(invitation.role_schedule[0].starts_at,new Date('2026-10-14T09:00').toISOString());
    assert.equal(invitation.role_schedule[0].expires_at,new Date('2027-10-14T09:00').toISOString());
    assert.equal(invitation.op,'invite');assert.equal(refreshes,1);
  }finally{globalThis.setTimeout=priorTimeout;cleanup();}
});

test('managing office titles preserves existing access unless the administrator applies a new suggestion',async()=>{
  const {ctx,cleanup}=setup();let action,payload;
  try{
    const account={id:'20000000-0000-4000-8000-000000000001',display_name:'Fictional finance officer',email:'officer@example.invalid',office_codes:['treasurer','financial_secretary'],roles:['treasurer'],extra_permissions:['documents.write'],denied_permissions:['finance.export'],active:true,role_history:[{role_code:'treasurer',starts_at:'2026-10-01T09:00:00Z',expires_at:null,revoked_at:null}]};
    ctx.data.accounts.push(account);ctx.detailId=account.id;ctx.act=async(name,data)=>{action=name;payload=data;};
    await renderAccounts(ctx);
    assert.ok(ctx.container.textContent.includes('Financial Secretary'));
    const form=document.querySelector('dialog form');
    assert.deepEqual(checked(form,'office_codes'),['treasurer','financial_secretary']);
    field(form,'office_codes','treasurer').checked=false;
    field(form,'office_codes','financial_secretary').checked=false;
    field(form,'office_codes','auditor_general').checked=true;
    form.querySelector('[name=reason]').value='Record new association office while reviewing access separately';
    await submit(form);
    assert.equal(action,'save_account');assert.equal(payload.id,account.id);
    assert.deepEqual(payload.office_codes,['auditor_general']);
    assert.deepEqual(payload.roles,['treasurer']);
    assert.deepEqual(payload.permissions,['documents.write']);
    assert.deepEqual(payload.denied_permissions,['finance.export']);
    assert.equal(payload.active,true);
    assert.equal(payload.role_schedule[0].starts_at,new Date(account.role_history[0].starts_at).toISOString());
  }finally{cleanup();}
});

test('PRO contact work is available without member editing and contact readers receive no write controls',async()=>{
  const {ctx,cleanup}=setup();let action,payload;
  try{
    const suggestion=suggestedAccess(['pro']),permissions=new Set([...suggestion.permissions,...suggestion.roles.flatMap(role=>ACCESS_ROLE_PERMISSIONS[role]||[])]);
    ctx.can=permission=>permissions.has(permission);ctx.act=async(name,data)=>{action=name;payload=data;};
    assert.equal(ctx.can('members.write'),false);
    ctx.detailId=ctx.data.members[2].id;await renderMembers(ctx);
    assert.equal(document.querySelector('#edit-member'),null);
    document.querySelector('[data-profile-tab=contacts]').click();
    assert.ok(document.querySelector('#profile-section').textContent.includes('Fictional membership details confirmed.'));
    assert.ok(document.querySelector('#profile-section a[href^="/admin/contacts/"]'));
    ctx.detailId=null;await renderContacts(ctx);document.querySelector('#new-contact').click();
    const form=document.querySelector('dialog form');
    form.querySelector('[name=member_id]').value=ctx.data.members[2].id;
    form.querySelector('[name=notes]').value='Fictional outreach completed';
    await submit(form);assert.equal(action,'save_contact');assert.equal(payload.member_id,ctx.data.members[2].id);
    permissions.delete('contacts.write');await renderContacts(ctx);
    assert.equal(document.querySelector('#new-contact'),null);
    assert.equal(document.querySelector('[data-edit-contact]'),null);
    await renderOverview(ctx);
    assert.ok(document.querySelector('a[href="/admin/contacts/?followup=1"]'));
    permissions.delete('contacts.read');ctx.detailId=ctx.data.members[2].id;await renderMembers(ctx);
    assert.equal(document.querySelector('[data-profile-tab=contacts]'),null);
  }finally{cleanup();}
});

test('shared office workspaces pair each officeholder with the correct assistant and keep the other offices distinct',()=>{
  const groups=[
    ['leadership',['president','vice_president']],
    ['secretariat',['secretary','assistant_secretary']],
    ['treasury',['treasurer','assistant_treasurer']],
    ['financial_secretariat',['financial_secretary','assistant_financial_secretary']],
    ['public_relations',['pro']],
    ['community_events',['community_event_manager']],
    ['audit',['auditor_general']]
  ];
  assert.deepEqual(OFFICE_WORKSPACES.map(workspace=>[workspace.code,workspace.office_codes]),groups);
  for(const [code,codes] of groups){
    for(const office of codes)assert.deepEqual(officeWorkspaces([office]).map(workspace=>workspace.code),[code]);
    assert.deepEqual(officeWorkspaces(codes).map(workspace=>workspace.code),[code]);
  }
  assert.deepEqual(officeWorkspaces(['assistant_secretary','assistant_treasurer']).map(workspace=>workspace.code),['secretariat','treasury']);
  assert.deepEqual(officeWorkspaces([]),[]);
  assert.deepEqual(officeWorkspaces(['owner']),[],'An access role is not an office team.');
});

test('officeholder and assistant see the same active team and links remain scoped to each signed-in account',async()=>{
  const {ctx,cleanup}=setup();
  try{
    for(const workspace of OFFICE_WORKSPACES.filter(group=>group.office_codes.length===2)){
      const [officeholder,assistant]=workspace.office_codes;
      const lead={id:'lead-'+workspace.code,display_name:'Fictional Officeholder',office_codes:[officeholder],active:true,email:'PRIVATE-EMAIL',internal_remarks:'PRIVATE-ACCOUNT-NOTES'};
      const deputy={id:'assistant-'+workspace.code,display_name:'Fictional Assistant',office_codes:[assistant],active:true};
      const inactive={id:'inactive-'+workspace.code,display_name:'Revoked Colleague',office_codes:[assistant],active:false};
      ctx.data.officers=[lead,deputy,inactive,{id:'unrelated',display_name:'Other Office',office_codes:['pro'],active:true}];
      ctx.user={...lead};ctx.can=permission=>ALL_PERMISSIONS.includes(permission);
      await renderOverview(ctx);
      let card=document.querySelector(`[data-office-workspace="${workspace.code}"]`);
      assert.ok(card);
      assert.deepEqual(Array.from(card.querySelectorAll('[data-office-teammate]')).map(item=>item.dataset.officeTeammate).sort(),[lead.id,deputy.id].sort());
      assert.ok(card.textContent.includes(officeLabels([assistant])[0]));
      assert.ok(!card.textContent.includes('Revoked Colleague'));
      assert.ok(!card.textContent.includes('Other Office'));
      assert.ok(!card.innerHTML.includes('PRIVATE-EMAIL'));
      assert.ok(!card.innerHTML.includes('PRIVATE-ACCOUNT-NOTES'));
      for(const area of workspace.areas)assert.equal(card.querySelector(`[data-workspace-area="${area.page}"]`)?.getAttribute('href'),`/admin/${area.page}/`);

      ctx.user={...deputy};ctx.can=permission=>permission==='directory.read';
      await renderOverview(ctx);
      card=document.querySelector(`[data-office-workspace="${workspace.code}"]`);
      assert.ok(card,'The assistant belongs to the same workspace.');
      assert.deepEqual(Array.from(card.querySelectorAll('[data-office-teammate]')).map(item=>item.dataset.officeTeammate).sort(),[lead.id,deputy.id].sort());
      for(const area of workspace.areas){
        const link=card.querySelector(`[data-workspace-area="${area.page}"]`);
        assert.equal(Boolean(link),area.permission==='directory.read',`Assistant's restricted access controls ${area.page}.`);
      }
    }
    ctx.user={...ctx.user,office_codes:[]};await renderOverview(ctx);
    assert.equal(document.querySelector('#office-workspaces'),null);
  }finally{cleanup();}
});

test('shared PRO workspace accepts contact-write access and fills a missing current teammate from safe identity fields',async()=>{
  const {ctx,cleanup}=setup();
  try{
    ctx.user={id:'current-pro',display_name:'Current PRO',office_codes:['pro'],active:true,email:'PRIVATE-SELF-EMAIL'};
    ctx.data.officers=[{id:'other-pro',display_name:'Other Active PRO',office_codes:['pro'],active:true}];
    ctx.can=permission=>['directory.read','contacts.write'].includes(permission);
    await renderOverview(ctx);
    const card=document.querySelector('[data-office-workspace="public_relations"]');
    assert.ok(card.querySelector('[data-workspace-area="contacts"]'));
    assert.deepEqual(Array.from(card.querySelectorAll('[data-office-teammate]')).map(item=>item.dataset.officeTeammate).sort(),['current-pro','other-pro']);
    assert.ok(!card.innerHTML.includes('PRIVATE-SELF-EMAIL'));
  }finally{cleanup();}
});
