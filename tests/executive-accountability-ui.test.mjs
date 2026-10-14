import test from 'node:test';
import assert from 'node:assert/strict';
import {money} from '../public/assets/js/domain.js';
import {operationKey} from '../public/assets/js/ui.js';
import {renderOverview} from '../public/assets/js/modules/overview.js';
import {renderOfficeReports,reportOfficeCodes} from '../public/assets/js/modules/office-reports.js';
import {EXECUTIVE_OFFICES} from '../public/assets/js/executive-offices.js';
import {setup} from './dom-harness.mjs';

const report=(changes={})=>({id:'50000000-0000-4000-8000-000000000001',office_code:'secretary',report_type:'minutes',title:'October executive meeting',summary:'Membership and activity decisions recorded.',report_date:'2026-10-10',status:'published',revision:3,author_name:'Secretary <script>unsafe()</script>',published_at:'2026-10-12T09:00:00Z',updated_at:'2026-10-12T09:00:00Z',can_edit:false,...changes});
const accountability=()=>({from:'2026-10-01',to:'2026-10-14',totals:{receipts_kobo:100000,approved_expenses_kobo:30000,pending_expenses_kobo:10000,reversed_expenses_kobo:5000},expenses:[{id:'expense-approved',expense_date:'2026-10-10',description:'Community hall <img src=x onerror=bad()>',amount_kobo:30000,status:'approved',responsible_officer_name:'Treasurer <officer>',collection_title:'October association fund',payee:'PRIVATE PAYEE',reason:'PRIVATE APPROVAL NOTES'},{id:'expense-pending',expense_date:'2026-10-11',description:'Pending stationery purchase',amount_kobo:10000,status:'pending',responsible_officer_name:'Secretary',collection_title:'October association fund'}],reports:[report(),report({id:'board-report',report_type:'board_decision',title:'Board decision',author_name:'President'})]});
const submit=async form=>{await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(form.querySelector('.form-error').textContent,'');};
const writer=ctx=>{ctx.user={...ctx.user,office_codes:['assistant_secretary']};ctx.can=permission=>['directory.read','office_reports.write'].includes(permission);};

test('every executive sees safe shared expense accountability and published reports without finance access',async()=>{
 const {ctx,cleanup}=setup();let calls=0;
 try{
  ctx.can=permission=>permission==='directory.read';ctx.svc.accountabilityOverview=async()=>{calls++;return accountability();};ctx.svc.overviewMetrics=async()=>{throw new Error('Finance-only method must not be called.');};
  await renderOverview(ctx);assert.equal(calls,1);
  const shared=document.querySelector('#shared-accountability'),totals=shared.querySelectorAll('.accountability-total');
  assert.equal(totals.length,4);assert.equal(totals[0].querySelector('strong').textContent,money(100000));assert.equal(totals[1].querySelector('strong').textContent,money(30000));
  assert.ok(shared.textContent.includes('Pending expenses'));assert.ok(shared.textContent.includes('excluded from spending'));
  assert.ok(shared.textContent.includes('Treasurer <officer>'));assert.ok(shared.textContent.includes('Board decision'));assert.ok(shared.textContent.includes('Meeting minutes'));
  assert.equal(shared.querySelector('script'),null);assert.equal(shared.querySelector('img'),null);assert.equal(shared.querySelector('officer'),null);
  assert.ok(!shared.textContent.includes('PRIVATE PAYEE'));assert.ok(!shared.textContent.includes('PRIVATE APPROVAL NOTES'));
  assert.equal(shared.querySelector('a[href^="/admin/expenses/"]'),null);
  assert.ok(document.querySelector('#overview-range'),'The date range is available without finance.read.');
 }finally{cleanup();}
});

test('shared accountability dates apply for readers and invalid ranges do not fetch another summary',async()=>{
 const {ctx,cleanup}=setup(),calls=[];
 try{
  ctx.can=permission=>permission==='directory.read';ctx.svc.accountabilityOverview=async scope=>{calls.push({...scope});return accountability();};
  await renderOverview(ctx);let form=document.querySelector('#overview-range');form.querySelector('[name=from]').value='2026-09-01';form.querySelector('[name=to]').value='2026-10-14';await form.onsubmit({preventDefault(){},target:form});
  assert.deepEqual(calls.at(-1),{from:'2026-09-01',to:'2026-10-14'});
  form=document.querySelector('#overview-range');form.querySelector('[name=from]').value='2026-10-20';form.querySelector('[name=to]').value='2026-10-10';const count=calls.length;await form.onsubmit({preventDefault(){},target:form});
  assert.equal(calls.length,count);assert.ok(form.querySelector('.form-error').textContent.includes('ordered range'));
 }finally{cleanup();}
});

test('expense management shortcuts require finance read and write while shared summaries remain visible',async()=>{
 const {ctx,cleanup}=setup();
 try{
  ctx.svc.accountabilityOverview=async()=>accountability();ctx.can=permission=>['directory.read','finance.read'].includes(permission);await renderOverview(ctx);
  assert.equal(document.querySelector('#accountability-expenses a[href^="/admin/expenses/"]'),null);
  ctx.can=permission=>['directory.read','finance.read','finance.write'].includes(permission);await renderOverview(ctx);
  assert.ok(document.querySelector('#accountability-expenses a[href="/admin/expenses/?id=expense-approved"]'));
 }finally{cleanup();}
});

test('deadline fund figures use authoritative collection summaries when the overview has no ledger rows',async()=>{
 const {ctx,cleanup}=setup();let calls=0;
 try{
  ctx.can=permission=>['directory.read','finance.read'].includes(permission);ctx.svc.accountabilityOverview=async()=>accountability();
  const collection=ctx.data.collections.find(record=>record.status==='open'&&record.category==='monthly');
  for(const key of ['payments','allocations','adjustments','assessments','expenses'])ctx.data[key]=[];
  ctx.svc.collectionSummaries=async()=>{calls++;return [{id:collection.id,received:123000,expected:500000,spending:40000,outstanding:377000,remaining:83000}];};
  await renderOverview(ctx);assert.equal(calls,1);
  const row=document.querySelector(`.collection-row[href="/admin/monthly/?id=${collection.id}"]`);
  assert.equal(row.querySelector('strong').textContent,money(123000));assert.ok(row.querySelector('.progress span').getAttribute('style').includes('24.6%'));
  assert.ok(ctx.container.textContent.includes('All published compulsory obligations, including future months'));
  ctx.svc.collectionSummaries=async()=>{throw new Error('Summary temporarily unavailable');};await renderOverview(ctx);
  assert.ok(document.querySelector('#retry-collection-summaries'));assert.ok(document.querySelector('.collection-list').textContent.includes('currently unavailable'));assert.equal(document.querySelector('.collection-list .collection-row strong'),null);
 }finally{cleanup();}
});

test('office report readers see published summaries but no drafts or writing controls',async()=>{
 const {ctx,cleanup}=setup();
 try{
  ctx.can=permission=>permission==='directory.read';ctx.svc.officeReports=async()=>[report({can_edit:true}),report({id:'team-secret',status:'draft',can_edit:true,title:'PRIVATE TEAM DRAFT'})];
  await renderOfficeReports(ctx);assert.ok(ctx.container.textContent.includes('October executive meeting'));assert.ok(!ctx.container.textContent.includes('PRIVATE TEAM DRAFT'));
  for(const selector of ['#new-office-report','[data-edit-office-report]','[data-publish-office-report]','[data-withdraw-office-report]'])assert.equal(document.querySelector(selector),null);
  document.querySelector('[data-view-office-report]').click();assert.ok(document.querySelector('dialog').textContent.includes('Secretary <script>unsafe()</script>'));assert.equal(document.querySelector('dialog script'),null);
 }finally{cleanup();}
});

test('assistant report authoring is confined to the shared office pair and system administrators can select all offices',async()=>{
 const {ctx,cleanup}=setup();
 try{
  writer(ctx);assert.deepEqual(reportOfficeCodes(ctx),['secretary','assistant_secretary']);
  ctx.svc.officeReports=async()=>[report({status:'draft',can_edit:true}),report({id:'other-draft',office_code:'treasurer',status:'draft',can_edit:true,title:'OTHER OFFICE DRAFT'}),report({id:'other-published',office_code:'treasurer',can_edit:false})];
  await renderOfficeReports(ctx);assert.ok(document.querySelector('[data-edit-office-report]'));assert.ok(!ctx.container.textContent.includes('OTHER OFFICE DRAFT'));
  document.querySelector('#new-office-report').click();const form=document.querySelector('dialog form'),office=form.querySelector('[name=office_code]');
  assert.deepEqual([...office.querySelectorAll('option')].map(option=>option.value),['secretary','assistant_secretary']);assert.equal(office.value,'assistant_secretary');assert.equal(form.querySelector('[name=summary]').getAttribute('maxlength'),'6000');
  document.querySelector('dialog').close();ctx.can=permission=>['directory.read','office_reports.write','accounts.write'].includes(permission);
  assert.deepEqual(reportOfficeCodes(ctx),EXECUTIVE_OFFICES.map(office=>office.code));
 }finally{cleanup();}
});

test('draft creation saves internal report fields without automatically publishing or assigning a revision',async()=>{
 const {ctx,cleanup}=setup();let action,payload;
 try{
  writer(ctx);ctx.svc.officeReports=async()=>[];ctx.act=async(name,data)=>{action=name;payload=data;};await renderOfficeReports(ctx);document.querySelector('#new-office-report').click();const form=document.querySelector('dialog form');
  form.querySelector('[name=report_type]').value='board_decision';form.querySelector('[name=report_date]').value='2026-10-14';form.querySelector('[name=title]').value='Membership follow-up decision';form.querySelector('[name=summary]').value='The executive team agreed to review pending member contacts.';
  await submit(form);assert.equal(action,'save_office_report');assert.equal(payload.id,null);assert.equal(payload.office_code,'assistant_secretary');assert.equal(payload.report_type,'board_decision');assert.equal(payload.status,undefined);assert.equal(payload.expected_revision,undefined);
 }finally{cleanup();}
});

test('published reports require withdrawal before revisions and lifecycle actions carry revision and reason',async()=>{
 const {ctx,cleanup}=setup(),record=report({can_edit:true});const actions=[];
 try{
  writer(ctx);ctx.svc.officeReports=async()=>[record];ctx.act=async(name,data)=>{actions.push({name,data});};await renderOfficeReports(ctx);
  assert.equal(document.querySelector('[data-edit-office-report]'),null);document.querySelector('[data-withdraw-office-report]').click();let form=document.querySelector('dialog form');form.querySelector('[name=reason]').value='Correct meeting decisions before republication';await submit(form);
  assert.equal(actions[0].name,'withdraw_office_report');assert.equal(actions[0].data.expected_revision,3);assert.ok(actions[0].data.reason);
  record.status='draft';record.revision=4;await renderOfficeReports(ctx);document.querySelector('[data-edit-office-report]').click();form=document.querySelector('dialog form');
  assert.equal(form.querySelector('[name=office_code]').disabled,true);form.querySelector('[name=office_code]').value='assistant_secretary';form.querySelector('[name=summary]').value='Revised decisions';form.querySelector('[name=reason]').value='Corrected the decision wording';await submit(form);
  assert.equal(actions[1].name,'save_office_report');assert.equal(actions[1].data.office_code,'secretary');assert.equal(actions[1].data.expected_revision,4);
  document.querySelector('[data-publish-office-report]').click();form=document.querySelector('dialog form');form.querySelector('[name=reason]').value='Revised minutes approved for executive reading';await submit(form);
  assert.equal(actions[2].name,'publish_office_report');assert.equal(actions[2].data.expected_revision,4);assert.ok(actions[2].data.reason);
 }finally{cleanup();}
});

test('report publication retry retains the operation key and latest record revision without discarding the approval reason',async()=>{
 const {ctx,cleanup}=setup(),keys=[],payloads=[];let first=true;
 try{
  writer(ctx);ctx.svc.officeReports=async()=>[report({status:'draft',revision:7,can_edit:true})];ctx.act=async(name,payload)=>{keys.push(operationKey());payloads.push({...payload});if(first){first=false;throw new Error('Temporary save failure');}};
  await renderOfficeReports(ctx);document.querySelector('[data-publish-office-report]').click();const form=document.querySelector('dialog form');form.querySelector('[name=reason]').value='Approved by the office team';await form.onsubmit({preventDefault(){},currentTarget:form});
  assert.equal(form.querySelector('.form-error').textContent,'Temporary save failure');assert.equal(form.querySelector('[name=reason]').value,'Approved by the office team');await submit(form);
  assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.deepEqual(payloads[0],payloads[1]);assert.equal(payloads[0].expected_revision,7);
 }finally{cleanup();}
});
