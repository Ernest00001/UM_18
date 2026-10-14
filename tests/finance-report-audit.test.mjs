import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './dom-harness.mjs';
import {renderPayments,renderExpenses} from '../public/assets/js/modules/finance.js';
import {renderReports} from '../public/assets/js/modules/reports.js';
import {remoteTable} from '../public/assets/js/remote-table.js';

const event=()=>({preventDefault(){}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const submit=form=>form.onsubmit({...event(),currentTarget:form});
const fill=(form,values)=>{for(const [name,value] of Object.entries(values))form.querySelector(`[name="${name}"]`).value=value;};

test('remote search blocks early and repeated paging, then filters and sorts populated results',async()=>{
 const {ctx,cleanup}=setup();const first=deferred(),calls=[];const records=Array.from({length:45},(_,i)=>({name:`Member ${String(i+1).padStart(2,'0')}`,status:i%2?'confirmed':'pending'}));
 try{
  let firstCall=true;const fetchRows=async p=>{calls.push(p);if(firstCall){firstCall=false;await first.promise;}let rows=records.filter(r=>(!p.query||r.name.includes(p.query))&&(!p.status||r.status===p.status));rows.sort((a,b)=>a[p.sort].localeCompare(b[p.sort])*(p.descending?-1:1));return {count:rows.length,rows:rows.slice(p.offset,p.offset+p.limit)};};
  const mounted=remoteTable(ctx.container,{fetchRows,columns:[{key:'name',label:'Name'},{key:'status',label:'Status'}],filters:[{key:'status',label:'Verification',options:['confirmed','pending']}],pageSize:20});
  assert.equal(ctx.container.querySelector('[data-prev]').disabled,true);assert.equal(ctx.container.querySelector('[data-next]').disabled,true);
  ctx.container.querySelector('[data-prev]').onclick();ctx.container.querySelector('[data-next]').onclick();assert.equal(calls.length,1);
  first.resolve();await mounted.ready;assert.match(ctx.container.querySelector('[data-range]').textContent,/1–20 of 45/);
  ctx.container.querySelector('[data-next]').onclick();ctx.container.querySelector('[data-next]').onclick();await tick();assert.equal(calls.at(-1).offset,20);assert.match(ctx.container.querySelector('[data-range]').textContent,/21–40 of 45/);
  const filter=ctx.container.querySelector('[data-remote-filter]');filter.value='pending';filter.onchange();await tick();assert.equal(calls.at(-1).offset,0);assert.equal(calls.at(-1).status,'pending');assert.match(ctx.container.querySelector('[data-range]').textContent,/of 23/);
  ctx.container.querySelector('[data-remote-sort=name]').onclick();await tick();assert.equal(calls.at(-1).descending,true);assert.match(ctx.container.querySelector('tbody tr').textContent,/Member 45/);
  const search=ctx.container.querySelector('input');search.value='Member 01';search.oninput({target:search});await new Promise(resolve=>setTimeout(resolve,250));assert.equal(calls.at(-1).query,'Member 01');assert.equal(ctx.container.querySelectorAll('tbody tr').length,1);assert.equal(ctx.container.querySelector('[data-next]').disabled,true);
 }finally{cleanup();}
});

test('a failed search has one working retry and stale failures cannot overwrite newer results',async()=>{
 const {ctx,cleanup}=setup(),old=deferred();let calls=0;
 try{
  const mounted=remoteTable(ctx.container,{columns:[{key:'name',label:'Name'}],filters:[{key:'status',label:'Status',options:['active']}],fetchRows:async()=>{calls++;if(calls===1)return old.promise;if(calls===2)throw new Error('Temporary connection failure');return {rows:[{name:'Recovered member'}],count:1};}});
  const filter=ctx.container.querySelector('select');filter.value='active';filter.onchange();await tick();assert.ok(ctx.container.querySelector('[data-retry]'));
  old.reject(new Error('Outdated failure'));await mounted.ready;assert.match(ctx.container.textContent,/Temporary connection failure/);assert.doesNotMatch(ctx.container.textContent,/Outdated failure/);
  ctx.container.querySelector('[data-retry]').click();await tick();assert.equal(calls,3);assert.match(ctx.container.textContent,/Recovered member/);assert.equal(ctx.container.querySelector('[data-retry]'),null);assert.equal(ctx.container.querySelector('[data-prev]').disabled,true);
 }finally{cleanup();}
});

test('remote exports hold one search and sort across every page even when on-screen filters change',async()=>{
 const {ctx,cleanup}=setup(),exportPage=deferred(),calls=[];
 try{
  const mounted=remoteTable(ctx.container,{columns:[{key:'name',label:'Name'}],filters:[{key:'status',label:'Status',options:['active']}],fetchRows:async p=>{calls.push(p);if(p.limit===100&&p.offset===0)await exportPage.promise;return {rows:Array.from({length:p.limit===100?(p.offset===0?100:25):20},(_,i)=>({name:`${p.status||'all'}-${p.offset+i}`})),count:125};}});await mounted.ready;
  const exportRows=mounted.getRows();const filter=ctx.container.querySelector('select');filter.value='active';filter.onchange();exportPage.resolve();const result=await exportRows;await tick();
  assert.equal(result.length,125);assert.ok(result.every(r=>r.name.startsWith('all-')));const requests=calls.filter(p=>p.limit===100);assert.equal(requests.length,2);assert.ok(requests.every(p=>p.status===undefined&&p.sort==='name'&&p.descending===false));
 }finally{cleanup();}
});

test('when the final remote page disappears, the table returns to page one with correct disabled controls',async()=>{
 const {ctx,cleanup}=setup();let empty=false;
 try{
  const mounted=remoteTable(ctx.container,{columns:[{key:'name',label:'Name'}],pageSize:1,fetchRows:async p=>empty?{rows:[],count:0}:{rows:[{name:`Page ${p.offset+1}`}],count:2}});await mounted.ready;empty=true;ctx.container.querySelector('[data-next]').onclick();await tick();assert.equal(ctx.container.querySelector('[data-page]').textContent,'1 / 1');assert.equal(ctx.container.querySelector('[data-range]').textContent,'0 records');assert.equal(ctx.container.querySelector('[data-prev]').disabled,true);assert.equal(ctx.container.querySelector('[data-next]').disabled,true);
 }finally{cleanup();}
});

test('payment recording saves verified receipt and several allocation periods, with a stable key on failed evidence retry',async()=>{
 const {ctx,cleanup}=setup();let uploaded=0,destination;const calls=[];
 try{
  const member=ctx.data.members[0];location.search='?new=1&member='+member.id;ctx.svc.memberAssessments=async id=>ctx.data.assessments.filter(a=>a.member_id===id);ctx.act=async(name,p,key)=>{calls.push({name,p,key});return {id:'saved-receipt'};};ctx.svc.upload=async()=>{if(++uploaded===1)throw new Error('Connection interrupted');};ctx.svc.load=async()=>ctx.data;ctx.navigate=async path=>destination=path;
  await renderPayments(ctx);const form=ctx.container.querySelector('form');fill(form,{amount:'4500',payment_date:'2026-10-14',reference:'TEST-AUDIT-TRANSFER',note:'Externally checked test receipt'});form.elements.verified.checked=true;form.elements.verified.onchange({target:form.elements.verified});form.elements.evidence.files=[{name:'receipt.png'}];
  for(const c of ctx.data.collections.slice(0,2)){ctx.container.querySelector('#add-allocation').click();const row=ctx.container.querySelector('#allocations').lastElementChild;row.querySelector('select').value=c.id;row.querySelector('input').value=(c.amount_kobo/100).toFixed(2);row.querySelector('input').oninput();}
  assert.match(ctx.container.querySelector('#allocation-total').textContent,/4,500/);await submit(form);assert.match(form.querySelector('.form-error').textContent,/record saved; evidence upload failed/);assert.equal(form.querySelector('[type=submit]').disabled,false);assert.equal(destination,undefined);
  await submit(form);assert.equal(destination,'/admin/payments/?id=saved-receipt');assert.equal(calls.length,2);assert.equal(calls[0].key,calls[1].key);assert.equal(calls[0].p.amount_kobo,450000);assert.deepEqual(calls[0].p.allocations.map(a=>a.amount_kobo),[200000,250000]);assert.equal(calls[0].p.verified,true);
 }finally{cleanup();}
});

test('changing the payment member quickly cannot restore another member’s obligations',async()=>{
 const {ctx,cleanup}=setup(),a=deferred(),b=deferred();
 try{
  const [one,two]=ctx.data.members,second=ctx.data.assessments.filter(row=>row.member_id===two.id);location.search='?new=1';ctx.svc.memberAssessments=id=>id===one.id?a.promise:b.promise;await renderPayments(ctx);const member=ctx.container.querySelector('[name=member_id]');member.value=one.id;const firstChange=member.onchange({target:member});assert.equal(ctx.container.querySelector('[type=submit]').disabled,true);member.value=two.id;const secondChange=member.onchange({target:member});b.resolve(second);await secondChange;a.resolve([]);await firstChange;assert.deepEqual(ctx.data.assessments,second);assert.equal(ctx.container.querySelector('[type=submit]').disabled,false);ctx.container.querySelector('#add-allocation').click();assert.ok([...ctx.container.querySelector('#allocations select').options].some(o=>o.value===second[0].collection_id));
 }finally{cleanup();}
});

test('an unavailable replacement link displays a return path rather than creating an unrelated receipt',async()=>{
 const {ctx,cleanup}=setup();try{location.search='?replace=missing-record';await renderPayments(ctx);assert.match(ctx.container.textContent,/Payment unavailable/);assert.equal(ctx.container.querySelector('[name=amount]'),null);assert.equal(ctx.container.querySelector('a').getAttribute('href'),'/admin/payments/');}finally{cleanup();}
});

test('record-payment navigation works while the remote payment search is still loading',async()=>{
 const {ctx,cleanup}=setup(),search=deferred();let destination;
 try{ctx.svc.searchPayments=()=>search.promise;ctx.navigate=async path=>destination=path;const rendering=renderPayments(ctx);ctx.container.querySelector('#new-payment').click();assert.equal(destination,'/admin/payments/?new=1');search.resolve({rows:[],count:0});await rendering;}finally{cleanup();}
});

test('failed member obligation loading blocks verified allocation submission with visible feedback',async()=>{
 const {ctx,cleanup}=setup(),timeout=globalThis.setTimeout;let saved=false;
 try{globalThis.setTimeout=()=>0;location.search='?new=1';ctx.svc.memberAssessments=async()=>{throw new Error('Obligations unavailable; choose the member again to retry.');};ctx.act=async()=>saved=true;await renderPayments(ctx);const form=ctx.container.querySelector('form');form.elements.member_id.value=ctx.data.members[0].id;await form.elements.member_id.onchange({target:form.elements.member_id});fill(form,{amount:'1000',note:'Verified test receipt'});form.elements.verified.checked=true;await submit(form);assert.equal(saved,false);assert.match(form.querySelector('.form-error').textContent,/Obligations unavailable/);assert.equal(form.querySelector('[type=submit]').disabled,false);}finally{globalThis.setTimeout=timeout;cleanup();}
});

test('payment confirmation, rejection and reversal buttons submit the selected transition, reason and revision',async()=>{
 const {ctx,cleanup}=setup(),calls=[];let refreshed=0;
 try{
  ctx.act=async(name,p)=>calls.push({name,p});ctx.refresh=async()=>refreshed++;const confirmed=ctx.data.payments[0],pending=ctx.data.payments.find(p=>p.status==='pending');
  for(const [payment,state] of [[pending,'confirmed'],[pending,'rejected'],[confirmed,'reversed']]){ctx.detailId=payment.id;await renderPayments(ctx);ctx.container.querySelector(`[data-transition=${state}]`).click();const form=document.querySelector('dialog form');fill(form,{reason:'Documented transition test'});if(state==='reversed')fill(form,{effective_date:'2026-10-14'});await submit(form);assert.equal(calls.at(-1).name,'transition_payment');assert.equal(calls.at(-1).p.status,state);assert.equal(calls.at(-1).p.expected_revision,1);assert.equal(calls.at(-1).p.reason,'Documented transition test');if(state==='reversed')assert.equal(calls.at(-1).p.effective_date,'2026-10-14');}
  assert.equal(refreshed,3);
 }finally{cleanup();}
});

test('allocation editing removes rows, validates excessive totals, and submits the remaining distribution',async()=>{
 const {ctx,cleanup}=setup();let saved;
 try{
  ctx.detailId=ctx.data.payments[0].id;ctx.act=async(name,p)=>saved={name,p};await renderPayments(ctx);ctx.container.querySelector('#reallocate').click();const form=document.querySelector('dialog form');fill(form,{reason:'Allocation audit test'});const row=form.querySelector('#allocations .allocation-row');row.querySelector('input').value='999999';await submit(form);assert.match(form.querySelector('.form-error').textContent,/Allocations exceed/);assert.equal(saved,undefined);row.querySelector('button').click();await submit(form);assert.equal(saved.name,'allocate_payment');assert.equal(saved.p.allocations.length,2);assert.equal(saved.p.expected_revision,1);
 }finally{cleanup();}
});

test('refund and receipt correction controls preserve effective date, signed amount and receipt details',async()=>{
 const {ctx,cleanup}=setup(),saved=[];
 try{
  ctx.detailId=ctx.data.payments[0].id;ctx.act=async(name,p)=>saved.push({name,p});await renderPayments(ctx);ctx.container.querySelector('#adjust-payment').click();let form=document.querySelector('dialog form');fill(form,{kind:'refund',amount:'500',effective_date:'2026-10-14',reason:'Documented refund'});await submit(form);assert.equal(saved.at(-1).name,'adjust_payment');assert.equal(saved.at(-1).p.delta_kobo,-50000);assert.equal(saved.at(-1).p.effective_date,'2026-10-14');
  await renderPayments(ctx);ctx.container.querySelector('#correct-payment').click();form=document.querySelector('dialog form');fill(form,{member_id:ctx.data.members[1].id,payment_date:'2026-10-13',reference:'CORRECTED-TEST-REFERENCE',reason:'Correct receipt identity'});await submit(form);assert.equal(saved.at(-1).name,'correct_payment');assert.equal(saved.at(-1).p.member_id,ctx.data.members[1].id);assert.equal(saved.at(-1).p.expected_revision,1);assert.equal(saved.at(-1).p.reference,'CORRECTED-TEST-REFERENCE');
 }finally{cleanup();}
});

test('expense recording, pending editing and approval/reversal controls reach their saved actions',async()=>{
 const {ctx,cleanup}=setup(),saved=[];let destination;
 try{
  ctx.act=async(name,p)=>{saved.push({name,p});return {...p,id:p.id||'saved-expense'};};ctx.svc.load=async()=>ctx.data;ctx.navigate=async path=>destination=path;await renderExpenses(ctx);ctx.container.querySelector('#new-expense').click();let form=document.querySelector('dialog form');fill(form,{collection_id:ctx.data.collections[2].id,description:'Detailed test expense',overview_summary:'Venue preparation',payee:'Test supplier',amount:'1500',expense_date:'2026-10-14',reason:'Documented spending'});form.elements.document.files=[];await submit(form);assert.equal(saved.at(-1).name,'save_expense');assert.equal(saved.at(-1).p.amount_kobo,150000);assert.equal(saved.at(-1).p.overview_summary,'Venue preparation');assert.equal(destination,'/admin/expenses/?id=saved-expense');
  const e=ctx.data.expenses[0];for(const [status,transition] of [['pending','approved'],['pending','rejected'],['approved','reversed']]){e.status=status;ctx.detailId=e.id;await renderExpenses(ctx);assert.equal(!!ctx.container.querySelector('#edit-expense'),status==='pending');ctx.container.querySelector(`[data-expense-state=${transition}]`).click();form=document.querySelector('dialog form');fill(form,{reason:'Expense transition test'});await submit(form);assert.equal(saved.at(-1).name,'transition_expense');assert.equal(saved.at(-1).p.status,transition);}
  e.status='pending';await renderExpenses(ctx);ctx.container.querySelector('#edit-expense').click();assert.ok(document.querySelector('dialog [name=overview_summary]'));document.querySelector('dialog').remove();
 }finally{cleanup();}
});

test('read-only finance pages retain working detail links without offering write controls',async()=>{
 const {ctx,cleanup}=setup();
 try{
  ctx.can=p=>['directory.read','finance.read'].includes(p);await renderPayments(ctx);assert.equal(ctx.container.querySelector('#new-payment'),null);assert.ok(ctx.container.querySelector('a[data-payment]'));ctx.detailId=ctx.data.payments[0].id;await renderPayments(ctx);for(const selector of ['#correct-payment','#reallocate','#adjust-payment','#acknowledgement','[data-transition]','[data-add-doc]'])assert.equal(ctx.container.querySelector(selector),null);assert.ok(ctx.container.querySelector('a[href^="/admin/members/"]'));
  ctx.detailId=null;await renderExpenses(ctx);assert.equal(ctx.container.querySelector('#new-expense'),null);assert.ok(ctx.container.querySelector('a[href^="/admin/expenses/?id="]'));ctx.detailId=ctx.data.expenses[0].id;await renderExpenses(ctx);assert.equal(ctx.container.querySelector('[data-expense-state]'),null);assert.ok(ctx.container.querySelector('a[href^="/admin/special/"]'));
 }finally{cleanup();}
});

test('report type/filter/search/sort/print controls use the displayed finance scope and reset filters',async()=>{
 const {ctx,cleanup}=setup();let audit,printed=0;const timeout=globalThis.setTimeout;
 try{
  window.print=()=>printed++;ctx.svc.act=async(name,p)=>audit={name,p};await renderReports(ctx);document.querySelector('[data-report=receipts]').click();const form=document.querySelector('#report-filters');fill(form,{from:'2026-10-03',to:'2026-10-08',status:'confirmed'});await submit(form);assert.equal(document.querySelector('#report-count').textContent,'6 rows');const search=document.querySelector('[type=search]');search.value='Tunde';search.oninput({target:search});document.querySelector('[data-sort=c3]').click();await document.querySelector('#report-print').onclick();assert.equal(printed,1);assert.equal(audit.name,'export_audit');assert.equal(audit.p.scope,'finance');assert.equal(audit.p.count,1);assert.equal(audit.p.filters.table_search,'tunde');assert.equal(audit.p.filters.sort,'c3');assert.match(document.querySelector('.print-document').textContent,/Tunde Adebayo/);assert.doesNotMatch(document.querySelector('.print-document').textContent,/Adaeze Okoro/);
  const before=document.querySelector('#report-count').textContent;fill(form,{from:'2026-10-09',to:'2026-10-01'});globalThis.setTimeout=()=>0;await submit(form);assert.equal(document.querySelector('#report-count').textContent,before);assert.match(document.querySelector('#toasts').textContent,/end date after the start/);globalThis.setTimeout=fn=>{fn();return 0;};fill(form,{from:'',to:'',status:''});form.onreset();assert.equal(document.querySelector('#report-count').textContent,'9 rows');
 }finally{globalThis.setTimeout=timeout;cleanup();}
});

test('report exports recheck permission and accounts without report access get a clear message',async()=>{
 const {ctx,cleanup}=setup(),timeout=globalThis.setTimeout;let exported=0;
 try{
  globalThis.setTimeout=()=>0;ctx.svc.act=async()=>exported++;await renderReports(ctx);ctx.can=()=>false;await document.querySelector('#report-print').onclick();assert.equal(exported,0);assert.match(document.querySelector('#toasts').textContent,/cannot export/);await renderReports(ctx);assert.match(ctx.container.textContent,/Reports unavailable/);assert.equal(ctx.container.querySelector('#report-csv'),null);
 }finally{globalThis.setTimeout=timeout;cleanup();}
});

test('finance form actions declare button types so removing allocations or changing expense status cannot submit an unintended record',async()=>{
 const {ctx,cleanup}=setup();
 try{
  location.search='?new=1';await renderPayments(ctx);ctx.container.querySelector('#add-allocation').click();let form=ctx.container.querySelector('form');assert.equal(form.querySelectorAll('button:not([type])').length,0);assert.equal(form.querySelector('[aria-label="Remove allocation"]').getAttribute('type'),'button');assert.equal(form.querySelector('#add-allocation').getAttribute('type'),'button');assert.equal(form.querySelectorAll('button[type=submit]').length,1);
  location.search='';ctx.detailId=ctx.data.payments[0].id;await renderPayments(ctx);for(const selector of ['#reallocate','#adjust-payment']){ctx.container.querySelector(selector).click();form=document.querySelector('dialog form');assert.equal(form.querySelectorAll('button:not([type])').length,0);assert.equal(form.querySelectorAll('button[type=submit]').length,1);document.querySelector('dialog').remove();}
  ctx.data.expenses[0].status='pending';ctx.detailId=ctx.data.expenses[0].id;await renderExpenses(ctx);ctx.container.querySelector('#edit-expense').click();form=document.querySelector('dialog form');assert.equal(form.querySelectorAll('button:not([type])').length,0);for(const selector of ['#approve-expense','#reject-expense'])assert.equal(form.querySelector(selector).getAttribute('type'),'button');assert.equal(form.querySelectorAll('button[type=submit]').length,1);
 }finally{cleanup();}
});

test('report navigation and remote-table tools cannot implicitly submit their surrounding forms',async()=>{
 const {ctx,cleanup}=setup();
 try{
  await renderReports(ctx);const form=document.querySelector('#report-filters');assert.deepEqual([...form.querySelectorAll('button')].map(b=>b.getAttribute('type')),['reset','submit']);for(const button of document.querySelectorAll('[data-report],#report-csv,#report-pdf,#report-print'))assert.equal(button.closest('form'),null);
  ctx.container.innerHTML='<form><div id="remote-holder"></div><button type="submit">Save</button></form>';const mounted=remoteTable(ctx.container.querySelector('#remote-holder'),{columns:[{key:'name',label:'Name'}],fetchRows:async()=>({rows:[{name:'Test row'}],count:1})});await mounted.ready;assert.ok(ctx.container.querySelector('[data-remote-sort]'));for(const button of ctx.container.querySelectorAll('#remote-holder button'))assert.equal(button.getAttribute('type'),'button');assert.equal(ctx.container.querySelectorAll('button[type=submit]').length,1);
 }finally{cleanup();}
});
