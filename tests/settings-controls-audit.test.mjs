import test from 'node:test';
import assert from 'node:assert/strict';
import {renderBranding,renderAccounts,renderAudit} from '../public/assets/js/modules/settings.js';
import {renderOfficeReports} from '../public/assets/js/modules/office-reports.js';
import {renderOverview} from '../public/assets/js/modules/overview.js';
import {operationKey} from '../public/assets/js/ui.js';
import {setup} from './dom-harness.mjs';

test('logo selection resets Save and its preview when an invalid or empty choice replaces a valid file',async()=>{
 const {ctx,cleanup}=setup(),create=URL.createObjectURL,revoke=URL.revokeObjectURL,timer=globalThis.setTimeout;let revoked=[];
 try{
  URL.createObjectURL=()=> 'blob:https://fictional.example/selected-logo';URL.revokeObjectURL=value=>revoked.push(value);globalThis.setTimeout=()=>0;
  await renderBranding(ctx);const picker=document.querySelector('#brand-logo'),save=document.querySelector('#save-logo');
  picker.onchange({target:{files:[{size:100,type:'image/png'}]}});assert.equal(save.disabled,false);assert.ok(document.querySelector('#brand-preview img'));
  picker.onchange({target:{files:[{size:100,type:'application/pdf'}]}});assert.equal(save.disabled,true);assert.deepEqual(revoked,['blob:https://fictional.example/selected-logo']);assert.equal(document.querySelector('#brand-preview img'),null);assert.equal(document.querySelector('#brand-preview .logo-symbol').textContent,'18');
  picker.onchange({target:{files:[{size:100,type:'image/png'}]}});assert.equal(save.disabled,false);
  picker.onchange({target:{files:[]}});assert.equal(save.disabled,true);assert.equal(document.querySelector('#brand-preview img'),null);
 }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;globalThis.setTimeout=timer;cleanup();}
});

test('Use text fallback clears the temporary preview logo and production storage path respectively',async()=>{
 for(const preview of [true,false]){
  const {ctx,cleanup}=setup();let payload,refreshes=0;
  try{
   ctx.review=false;ctx.preview=preview;ctx.brand.logo_url='https://fictional.example/logo.webp';
   ctx.act=async(action,data)=>{assert.equal(action,'save_branding');payload=data;};ctx.svc.branding=async()=>({...ctx.brand,logo_url:null});ctx.refresh=async()=>refreshes++;
   await renderBranding(ctx);await document.querySelector('#fallback-logo').onclick();
   assert.deepEqual(payload,preview?{logo_url:null}:{logo_path:null});assert.equal(ctx.brand.logo_url,null);assert.equal(refreshes,1);
  }finally{cleanup();}
 }
});

test('audit Open record targets the actual monthly fund, assessment parent, office report and welfare case',async()=>{
 const {ctx,cleanup}=setup();
 try{
  const monthly=ctx.data.collections.find(record=>record.category==='monthly'),assessment=ctx.data.assessments.find(record=>record.collection_id===monthly.id),welfare=ctx.data.welfare[0];
  ctx.data.audit=[
   {id:'monthly',action:'save_collection',target_type:'collection',target_id:monthly.id},
   {id:'assessment',action:'adjust_assessment',target_type:'assessment',target_id:assessment.id},
   {id:'report',action:'publish_office_report',target_type:'office_report',target_id:'report-reference'},
   {id:'welfare',action:'save_welfare',target_type:'welfare',target_id:welfare.id},
   {id:'no-target',action:'export_audit',target_type:'collection',target_id:null}
  ].map(record=>({...record,created_at:'2026-10-14T10:00:00Z',actor_id:ctx.user.id,changes:{reason:'Reviewed'}}));
  await renderAudit(ctx);const paths=[...ctx.container.querySelectorAll('a[data-route]')].map(anchor=>anchor.getAttribute('href'));
  assert.ok(paths.includes('/admin/monthly/?id='+monthly.id));assert.ok(paths.includes('/admin/office-reports/?id=report-reference'));assert.ok(paths.includes('/admin/welfare/?id='+welfare.id));assert.ok(!paths.some(path=>path.includes('null')||path.includes('undefined')));assert.ok(!paths.includes('/admin/special/'));
  ctx.can=permission=>['directory.read','audit.read'].includes(permission);await renderAudit(ctx);
  assert.deepEqual([...ctx.container.querySelectorAll('a[data-route]')].map(anchor=>anchor.getAttribute('href')),['/admin/office-reports/?id=report-reference']);
 }finally{cleanup();}
});

test('accounts and office reports explain unavailable record links instead of silently showing an unrelated list',async()=>{
 const {ctx,cleanup}=setup();
 try{
  ctx.detailId='missing-account';await renderAccounts(ctx);assert.equal(document.querySelector('dialog'),null);assert.ok(ctx.container.querySelector('[role=alert]').textContent.includes('account is unavailable'));
  ctx.detailId='private-draft';ctx.can=permission=>permission==='directory.read';ctx.svc.officeReports=async()=>[{id:'private-draft',office_code:'secretary',status:'draft',can_edit:true,title:'Restricted draft'}];
  await renderOfficeReports(ctx);assert.equal(document.querySelector('dialog'),null);assert.ok(ctx.container.querySelector('[role=alert]').textContent.includes('current access'));assert.ok(!ctx.container.textContent.includes('Restricted draft'));
 }finally{cleanup();}
});

test('account authenticator reset opens its reviewed confirmation, while self recovery stays disabled',async()=>{
 const {ctx,cleanup}=setup();let request;
 try{
  const other={...ctx.data.accounts[0],id:'other-owner',display_name:'Other administrator',email:'other@example.invalid'};ctx.data.accounts.push(other);ctx.detailId=other.id;ctx.svc.resetMfa=async payload=>request=payload;
  await renderAccounts(ctx);const button=document.querySelector('#reset-account-mfa');assert.equal(button.disabled,false);assert.equal(button.getAttribute('type'),'button');assert.ok(button.closest('form'));button.click();
  const form=document.querySelector('dialog form');assert.ok(form.querySelector('[name=identity_verified]'));form.querySelector('[name=identity_verified]').checked=true;form.querySelector('[name=reason]').value='Association-controlled identity and recovery review';await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(request.id,other.id);assert.ok(request.reason.includes('identity'));
  ctx.detailId=ctx.user.id;await renderAccounts(ctx);assert.equal(document.querySelector('#reset-account-mfa').disabled,true);
 }finally{cleanup();}
});

test('owned page and dialog actions declare native button semantics so only Save or Apply dates submits',async()=>{
 const {ctx,cleanup}=setup();
 const audit=()=>{for(const button of document.querySelectorAll('button')){if(!button.closest('form')&&button.closest('.data-table'))continue;const type=button.getAttribute('type');assert.ok(['button','submit','reset'].includes(type),'Missing native button type: '+button.textContent);if(button.closest('form')&&type==='submit')assert.ok(/Save|Invite executive|Publish report|Withdraw to draft|Apply dates|Reset authenticator/.test(button.textContent),'Unexpected form submission: '+button.textContent);}};
 try{
  await renderBranding(ctx);audit();await renderAccounts(ctx);audit();document.querySelector('#invite-executive').click();audit();document.querySelector('dialog').close();
  ctx.svc.officeReports=async()=>[{id:'draft',office_code:'secretary',report_type:'report',title:'Draft summary',summary:'Review-only report summary',report_date:'2026-10-14',status:'draft',can_edit:true}];await renderOfficeReports(ctx);audit();document.querySelector('#new-office-report').click();audit();document.querySelector('dialog').close();document.querySelector('[data-publish-office-report]').click();audit();document.querySelector('dialog').close();
  ctx.svc.accountabilityOverview=async()=>({totals:{},expenses:[],reports:[]});await renderOverview(ctx);audit();
 }finally{cleanup();}
});

test('public identity, restricted settings and logo Save call their service actions with retry-safe keys',async()=>{
 const {ctx,cleanup}=setup(),create=URL.createObjectURL,revoke=URL.revokeObjectURL,actions=[];let uploaded,refreshes=0;
 try{
  URL.createObjectURL=()=> 'blob:https://fictional.example/new-logo';URL.revokeObjectURL=()=>{};ctx.preview=true;ctx.review=false;
  ctx.act=async(name,payload,key)=>actions.push({name,payload,key});ctx.svc.branding=async()=>ctx.brand;ctx.refresh=async()=>refreshes++;ctx.svc.upload=async(file,scope,target)=>{uploaded={file,scope,target,key:operationKey()};return {applied:true,logo_url:'https://fictional.example/new-logo.webp'};};
  await renderBranding(ctx);const identity=document.querySelector('#brand-form');identity.querySelector('[name=short_name]').value='UM18 updated';await identity.onsubmit({preventDefault(){},target:identity});
  assert.equal(actions[0].name,'save_branding');assert.equal(actions[0].payload.short_name,'UM18 updated');assert.ok(actions[0].key);
  const settings=document.querySelector('#settings-form');settings.querySelector('[name=document_limit_mb]').value='2';settings.querySelector('[name=retention_review_months]').value='30';settings.querySelector('[name=reason]').value='Approved storage and retention review';await settings.onsubmit({preventDefault(){},target:settings});
  assert.equal(actions[1].name,'save_settings');assert.equal(actions[1].payload.document_limit_mb,2);assert.equal(actions[1].payload.retention_review_months,30);assert.ok(actions[1].key);
  const file={size:100,type:'image/png'};document.querySelector('#brand-logo').onchange({target:{files:[file]}});await document.querySelector('#save-logo').onclick({target:document.querySelector('#save-logo')});assert.equal(uploaded.file,file);assert.equal(uploaded.scope,'branding');assert.equal(uploaded.target,null);assert.ok(uploaded.key);assert.equal(refreshes,3);
 }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;cleanup();}
});

test('office report search, office/type/publication filters and retry update the visible results',async()=>{
 const {ctx,cleanup}=setup();let fails=true;
 try{
  const reports=[{id:'minutes',office_code:'secretary',report_type:'minutes',title:'Meeting minutes',summary:'Membership decisions',author_name:'Secretary',report_date:'2026-10-14',status:'published',can_edit:false},{id:'finance',office_code:'treasurer',report_type:'report',title:'Treasury figures',summary:'Receipts and expenses',author_name:'Treasurer',report_date:'2026-10-13',status:'published',can_edit:false},{id:'draft',office_code:'secretary',report_type:'board_decision',title:'Draft decision',summary:'Office draft',author_name:'Secretary',report_date:'2026-10-14',status:'draft',can_edit:true}];
  ctx.svc.officeReports=async()=>{if(fails)throw new Error('Temporary reports outage');return reports;};await renderOfficeReports(ctx);assert.ok(document.querySelector('#retry-office-reports'));fails=false;await document.querySelector('#retry-office-reports').onclick();assert.equal(document.querySelectorAll('[data-office-report]').length,3);
  const search=document.querySelector('#office-report-search');search.value='treasury';search.oninput();assert.equal(document.querySelectorAll('[data-office-report]').length,1);assert.equal(document.querySelector('[data-office-report]').dataset.officeReport,'finance');search.value='';search.oninput();
  const office=document.querySelector('[name=office_filter]');office.value='secretary';office.onchange();assert.equal(document.querySelectorAll('[data-office-report]').length,2);
  const type=document.querySelector('[name=type_filter]');type.value='minutes';type.onchange();assert.equal(document.querySelectorAll('[data-office-report]').length,1);type.value='';type.onchange();
  const publication=document.querySelector('[name=status_filter]');publication.value='draft';publication.onchange();assert.equal(document.querySelector('[data-office-report]').dataset.officeReport,'draft');publication.value='published';publication.onchange();assert.equal(document.querySelector('[data-office-report]').dataset.officeReport,'minutes');
 }finally{cleanup();}
});

test('shared overview retry reloads accountability for a reader rather than leaving a dead error control',async()=>{
 const {ctx,cleanup}=setup();let fails=true,calls=0;
 try{
  ctx.can=permission=>permission==='directory.read';ctx.svc.accountabilityOverview=async()=>{calls++;if(fails)throw new Error('Temporary summary outage');return {totals:{},expenses:[],reports:[]};};await renderOverview(ctx);const retry=document.querySelector('#retry-accountability');assert.ok(retry);fails=false;retry.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);assert.equal(document.querySelector('#retry-accountability'),null);assert.ok(document.querySelector('#shared-accountability .accountability-total'));
 }finally{cleanup();}
});
