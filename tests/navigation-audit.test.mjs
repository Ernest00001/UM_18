import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {setup} from './dom-harness.mjs';
import {fixtures as emptyPreview} from '../fixtures/empty-preview.js';
import {renderOverview} from '../public/assets/js/modules/overview.js';
import {renderOfficeReports} from '../public/assets/js/modules/office-reports.js';
import {renderMembers,renderRegistrations} from '../public/assets/js/modules/membership.js';
import {renderCollections} from '../public/assets/js/modules/collections.js';
import {renderPayments,renderExpenses} from '../public/assets/js/modules/finance.js';
import {renderEvents,renderWelfare,renderContacts,renderDocuments} from '../public/assets/js/modules/operations.js';
import {renderReports} from '../public/assets/js/modules/reports.js';
import {renderBranding,renderAccounts,renderAudit} from '../public/assets/js/modules/settings.js';
import {renderAuth} from '../public/assets/js/modules/auth.js';
import {accountabilityOverview,officeReportList,collectionSummaries,monthlySchedule} from '../public/assets/js/review-accountability.js';
import {EXECUTIVE_OFFICES,ACCESS_ROLE_PERMISSIONS,suggestedAccess} from '../public/assets/js/executive-offices.js';

const publicPaths=['/','/register/','/confirmation/','/privacy/','/help/','/events/','/gallery/'];
const executivePages=[['overview',renderOverview],['office-reports',renderOfficeReports],['registrations',renderRegistrations],['members',renderMembers],['monthly',ctx=>renderCollections(ctx,'monthly')],['special',ctx=>renderCollections(ctx,'special')],['payments',renderPayments],['expenses',renderExpenses],['events',renderEvents],['welfare',renderWelfare],['contacts',renderContacts],['documents',renderDocuments],['reports',renderReports],['branding',renderBranding],['accounts',renderAccounts],['audit',renderAudit]];
const routePaths=new Set([...publicPaths,'/admin/','/admin/login/',...executivePages.map(([page])=>'/admin/'+page+'/')]);
const targetNames={members:'members',monthly:'collections',special:'collections',payments:'payments',expenses:'expenses',events:'events',welfare:'welfare',documents:'documents',accounts:'accounts',registrations:'submissions','office-reports':'office_reports'};
const inventory=new Set();let checkedAnchors=0;
async function auditLinks(root,{path='/',data,label=path}={}){
 for(const anchor of root.querySelectorAll('a')){
  const href=anchor.getAttribute('href');assert.ok(href&&href.trim(),label+' has an empty anchor');assert.notEqual(href,'#',label+' has a dead # link');assert.ok(!/^(?:javascript|data):/i.test(href),label+' has an unsafe protocol');
  const url=new URL(href,'https://fictional.example'+path);checkedAnchors++;inventory.add(url.pathname+url.search+url.hash);
  if(url.protocol==='mailto:'){assert.match(decodeURIComponent(url.pathname),/^[^\s@]+@[^\s@]+\.[^\s@]+$/,label+' has an invalid email link');continue;}
  if(url.protocol==='tel:'){assert.match(url.pathname,/^\+?[\d(). -]+$/,label+' has an invalid phone link');continue;}
  assert.ok(['http:','https:','blob:'].includes(url.protocol),label+' uses an unsupported anchor protocol');
  if(url.origin!=='https://fictional.example'||url.protocol==='blob:')continue;
  assert.ok(!/(?:undefined|null)/.test(url.pathname+url.search),label+' contains an unresolved link target');
  if(url.pathname.startsWith('/assets/')){await access('public'+url.pathname);continue;}
  if(url.pathname==='/api/events'){assert.ok(url.searchParams.get('media'));continue;}
  const normal=url.pathname.endsWith('/')?url.pathname:url.pathname+'/';assert.ok(routePaths.has(normal),label+' links to an unknown route: '+href);
  if(url.hash&&url.pathname===path){assert.ok(root.querySelector('#'+url.hash.slice(1)),label+' links to a missing fragment: '+href);}
  const page=url.pathname.split('/').filter(Boolean)[1],id=url.searchParams.get('id'),collection=targetNames[page];
  if(data&&id&&collection)assert.ok(data[collection]?.some(record=>record.id===id),label+' links to an unknown '+collection+' record: '+href);
 }
}
function services(ctx){
 const workspace={data:ctx.data,user:ctx.user};
 Object.assign(ctx.svc,{
  accountabilityOverview:async scope=>accountabilityOverview(workspace,scope),officeReports:async()=>officeReportList(workspace),collectionSummaries:async()=>collectionSummaries(workspace),monthlySchedule:async scope=>monthlySchedule(workspace,scope),
  eventDocuments:async id=>ctx.data.documents.filter(record=>record.scope==='event'&&record.target_id===id),eventMedia:async()=>[],eventMediaPreview:async()=>null,
  history:async(scope)=>['collection','payment'].includes(scope)?{allocations:[],metadata:[],assessments:[],movements:[]}:[],welfareAssignments:async()=>ctx.data.accounts,branding:async()=>ctx.brand,download:async()=>null
 });
}
function seedReport(ctx){ctx.data.office_reports=[{id:'50000000-0000-4000-8000-000000000001',office_code:'secretary',report_type:'minutes',title:'Test meeting summary',summary:'Test-only summary for link inventory.',report_date:'2026-10-14',status:'published',revision:1,created_by:ctx.user.id,updated_by:ctx.user.id,published_at:'2026-10-14T12:00:00Z',updated_at:'2026-10-14T12:00:00Z'}];}

test('all public and executive route families have build entries and valid static assets/fragments',async()=>{
 const build=await readFile('scripts/build.mjs','utf8');assert.equal(executivePages.length,16);
 for(const path of routePaths){const page=path.split('/').filter(Boolean).at(-1);if(page&&page!=='admin')assert.ok(build.includes("'"+page+"'"),path+' is missing from the build');}
 for(const file of ['public/index.html','public/admin/index.html']){
  const {document}=parseHTML(await readFile(file,'utf8'));await auditLinks(document,{path:file.includes('/admin/')?'/admin/overview/':'/',label:file});
  for(const asset of document.querySelectorAll('link[href],script[src]')){const url=asset.getAttribute('href')||asset.getAttribute('src');assert.ok(url.startsWith('/assets/'));await access('public'+url);}
 }
});

test('rendered links across sixteen executive pages resolve in empty and populated states',async t=>{
 for(const empty of [false,true])for(const [page,render] of executivePages)await t.test(page+(empty?' empty':' populated'),async()=>{
  const {ctx,cleanup}=setup();
  try{
   if(empty){ctx.data=emptyPreview();ctx.user=ctx.data.accounts[0];ctx.brand=ctx.data.branding;}else seedReport(ctx);
   location.pathname='/admin/'+page+'/';services(ctx);await render(ctx);assert.ok(ctx.container.querySelector('h1'),page+' failed to render');await auditLinks(document,{path:location.pathname,data:ctx.data,label:page+(empty?' empty':' populated')});
  }finally{cleanup();}
 });
 t.diagnostic('Executive link inventory: '+checkedAnchors+' anchors checked so far; '+inventory.size+' distinct targets.');
});

test('populated record detail links and member/collection tabs target existing records',async t=>{
 for(const [page,render,dataName] of [['members',renderMembers,'members'],['monthly',ctx=>renderCollections(ctx,'monthly'),'collections'],['special',ctx=>renderCollections(ctx,'special'),'collections'],['payments',renderPayments,'payments'],['expenses',renderExpenses,'expenses'],['events',renderEvents,'events'],['welfare',renderWelfare,'welfare'],['documents',renderDocuments,'documents'],['registrations',renderRegistrations,'submissions'],['accounts',renderAccounts,'accounts'],['office-reports',renderOfficeReports,'office_reports']])await t.test(page+' detail',async()=>{
  const {ctx,cleanup}=setup();
  try{
   seedReport(ctx);if(page==='documents')ctx.data.documents.push({id:'60000000-0000-4000-8000-000000000001',title:'Test-only minutes attachment',scope:'general',target_id:null,category:'minutes',version:1,mime_type:'application/pdf',byte_size:128,created_at:'2026-10-14T12:00:00Z',uploaded_by:ctx.user.id});services(ctx);location.pathname='/admin/'+page+'/';const record=ctx.data[dataName].find(record=>page==='monthly'?record.category==='monthly':page==='special'?record.category!=='monthly':true);ctx.detailId=record.id;await render(ctx);await auditLinks(document,{path:location.pathname,data:ctx.data,label:page+' detail'});
   for(const selector of ['[data-profile-tab]','[data-tab]'])for(const control of [...ctx.container.querySelectorAll(selector)]){control.click();await auditLinks(document,{path:location.pathname,data:ctx.data,label:page+' tab '+(control.dataset.profileTab||control.dataset.tab)});}
  }finally{cleanup();}
 });
});

test('every requested office overview exposes only reachable permitted shortcuts',async()=>{
 for(const office of EXECUTIVE_OFFICES){
  const {ctx,cleanup}=setup();
  try{
   const suggestions=suggestedAccess([office.code]),permissions=new Set([...suggestions.permissions,...suggestions.roles.flatMap(role=>ACCESS_ROLE_PERMISSIONS[role]||[])]);ctx.user={...ctx.user,office_codes:[office.code],permissions:[...permissions]};ctx.data.accounts[0]=ctx.user;ctx.can=permission=>permissions.has(permission);services(ctx);await renderOverview(ctx);
   await auditLinks(document,{path:'/admin/overview/',data:ctx.data,label:office.label+' overview'});
   const expected={monthly:'finance.read',special:'finance.read',payments:'finance.read',expenses:'finance.read',registrations:'registrations.review',accounts:'accounts.write',audit:'audit.read',contacts:'contacts.read',welfare:'welfare.read'};
   for(const anchor of ctx.container.querySelectorAll('a[data-route]')){const page=new URL(anchor.getAttribute('href'),'https://fictional.example').pathname.split('/')[2];if(expected[page])assert.ok(permissions.has(expected[page])||page==='contacts'&&permissions.has('contacts.write'),office.label+' has an unauthorised '+page+' shortcut');}
  }finally{cleanup();}
 }
});

test('login and all seven public page links resolve including actual homepage fragments',async t=>{
 const priorFetch=globalThis.fetch;
 try{
  for(const path of publicPaths){
   const {ctx,cleanup}=setup();
   try{
    location.pathname=path;document.body.innerHTML='<div id="public-app"></div>';globalThis.fetch=async input=>({ok:true,json:async()=>String(input)==='/api/branding'?ctx.brand:String(input)==='/api/config'?{mode:'production'}:{events:[]}});
    await import('../public/assets/js/public.js?navigation-audit='+encodeURIComponent(path));await auditLinks(document,{path,label:'Public '+path});assert.ok(document.querySelector('h1'),'Public '+path+' failed to render');
   }finally{cleanup();}
  }
  const {ctx,cleanup}=setup();try{ctx.review=false;await renderAuth(ctx.container,ctx,async()=>{});await auditLinks(document,{path:'/admin/login/',label:'Executive login'});}finally{cleanup();}
 }finally{globalThis.fetch=priorFetch;}
 t.diagnostic('Complete rendered inventory: '+checkedAnchors+' anchors checked; '+inventory.size+' distinct targets. Covers 16 executive pages, 11 detail page types and 7 public pages plus sign-in.');
});
