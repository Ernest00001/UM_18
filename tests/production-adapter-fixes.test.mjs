import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {readFile} from 'node:fs/promises';
import {setup} from './dom-harness.mjs';import {renderOverview} from '../public/assets/js/modules/overview.js';import {renderAudit} from '../public/assets/js/modules/settings.js';import {renderPayments} from '../public/assets/js/modules/finance.js';
async function service(){const result=await build({entryPoints:['public/assets/js/production-service.js'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'isolated-client',setup(builder){builder.onResolve({filter:/vendor\/supabase\.js$/},()=>({path:'isolated-client',namespace:'test'}));builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export function createClient(){throw new Error("No live client in tests");}',loader:'js'}));}}]});const {ProductionService}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));return new ProductionService();}

test('production session completes only its own confirmed executive membership before opening the workspace',async()=>{
 const svc=await service(),calls=[];const pending={id:'invited',invitation_pending:true,needs_mfa:true,permissions:[]};svc.client={auth:{getSession:async()=>({data:{session:{user:{id:'invited'}}}})},rpc:async name=>{calls.push(name);return {data:pending};}};assert.deepEqual(await svc.session(),pending);assert.deepEqual(calls,['complete_executive_membership']);
 svc.client.rpc=async()=>({error:{message:'The invitation requires a new approval from the President'}});await assert.rejects(svc.session(),/new approval/);svc.client.auth.getSession=async()=>({data:{session:null}});assert.equal(await svc.session(),null);
});

test('shared expense pagination forwards the approved dates, search, status and sorting to its guarded RPC',async()=>{
 const svc=await service(),calls=[];svc.client={rpc:async(name,args)=>{calls.push({name,args});return {data:{count:51,rows:[]},error:null};}};
 await svc.accountabilityExpenses({from:'2026-10-01',to:'2026-10-15',query:'hall',status:'approved',offset:40,limit:20,sort:'amount_kobo',descending:false});
 assert.deepEqual(calls[0],{name:'accountability_expenses',args:{p_from:'2026-10-01',p_to:'2026-10-15',p_query:'hall',p_status:'approved',p_offset:40,p_limit:20,p_sort:'amount_kobo',p_desc:false}});
});
test('production loader preserves query, replacement and every rewritten record path, including a captured navigation scope',async()=>{
 const saved=globalThis.location;try{const svc=await service(),calls=[];svc.client={rpc:async(name,args)=>{calls.push({name,args});return {data:{},error:null};}};const id='50000000-0000-4000-8000-000000000001';
  for(const rewrite of JSON.parse(await readFile('vercel.json','utf8')).rewrites){globalThis.location={pathname:rewrite.source.replace(':id',id),search:''};await svc.load();assert.equal(calls.at(-1).args.p_target,id);assert.equal(calls.at(-1).args.p_area,rewrite.source.split('/')[2]);}
  globalThis.location={pathname:'/admin/payments/',search:'?replace='+id};await svc.load();assert.equal(calls.at(-1).args.p_target,id);location={pathname:'/admin/expenses/',search:''};await svc.load({area:'members',target:id});assert.deepEqual(calls.at(-1).args,{p_area:'members',p_target:id});
 }finally{globalThis.location=saved;}
});
test('member status filters and export requests reach the SQL status argument while retaining other scope',async()=>{
 const svc=await service(),calls=[];svc.client={rpc:async(name,args)=>{calls.push({name,args});return {data:{rows:[],count:0},error:null};}};await svc.searchMembers({membership_status:'inactive',country:'Nigeria',query:'test',offset:100,limit:100,sort:'member_no',descending:true});assert.deepEqual(calls[0],{name:'search_members',args:{p_query:'test',p_status:'inactive',p_country:'Nigeria',p_offset:100,p_limit:100,p_sort:'member_no',p_desc:true}});await svc.searchMembers({status:'',membership_status:'inactive'});assert.equal(calls[1].args.p_status,'');
});
test('failed production finance metrics display unavailable balances and recover through Retry',async()=>{
 const {ctx,cleanup}=setup();try{ctx.review=false;ctx.preview=false;ctx.data.payments=[];ctx.data.allocations=[];ctx.data.adjustments=[];ctx.data.assessments=[];ctx.svc.accountabilityOverview=async()=>({totals:{receipts_kobo:500000},expenses:[],reports:[]});ctx.svc.overviewMetrics=async()=>{throw new Error('Interrupted metrics');};await renderOverview(ctx);
  assert.ok(document.querySelector('#finance-metrics-error'));const cards=[...document.querySelectorAll('.stat-card')];assert.equal(cards.find(card=>card.textContent.includes('Outstanding assessments')).querySelector('.value').textContent,'Unavailable');assert.equal(cards.find(card=>card.textContent.includes('Unallocated member credit')).querySelector('.value').textContent,'Unavailable');assert.ok(document.querySelector('#cash-chart').textContent.includes('unavailable'));assert.equal(document.querySelector('#cash-chart .chart-bars'),null);
  ctx.svc.overviewMetrics=async()=>({outstanding:120000,credit:30000,pending_payments:2,credit_count:1,chart:[{key:'2026-10',value:500000}]});document.querySelector('#retry-finance-metrics').click();for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(document.querySelector('#finance-metrics-error'),null);assert.ok(document.querySelector('#cash-chart .chart-bars'));assert.ok(document.querySelector('.summary-grid').textContent.includes('1,200'));assert.ok(document.querySelector('.task-grid').textContent.includes('2Payments awaiting verification'));
 }finally{cleanup();}
});
test('assessment audit entries open the authorised parent collection without unscoped assessment rows',async()=>{
 const {ctx,cleanup}=setup();try{const fund=ctx.data.collections.find(c=>c.category==='monthly');ctx.data.assessments=[];ctx.data.audit=[{id:crypto.randomUUID(),action:'assessment.changed',target_type:'assessment',target_id:crypto.randomUUID(),actor_id:ctx.user.id,created_at:'2026-10-14T10:00:00Z',assessment_collection_id:fund.id,changes:{reason:'Approved assessed amount'}}];await renderAudit(ctx);assert.equal(document.querySelector('a[data-route]').getAttribute('href'),'/admin/monthly/?id='+fund.id);ctx.can=p=>p!=='finance.read';await renderAudit(ctx);assert.equal(document.querySelector('a[data-route]'),null);
 }finally{cleanup();}
});
test('preserved receipts with successors do not offer another replacement and direct stale replacement links explain the latest-receipt requirement',async()=>{
 const {ctx,cleanup}=setup();try{const old=ctx.data.payments[0];old.status='reversed';old.replacement_available=false;old.replacement_id=crypto.randomUUID();ctx.detailId=old.id;ctx.svc.history=async()=>({allocations:[],metadata:[],statuses:[]});await renderPayments(ctx);assert.equal(document.querySelector('a[href*="?replace="]'),null);ctx.detailId=null;location.search='?replace='+old.id;await renderPayments(ctx);assert.ok(ctx.container.textContent.includes('latest reversed or rejected receipt'));assert.equal(document.querySelector('#payment-form'),null);
 }finally{cleanup();}
});
