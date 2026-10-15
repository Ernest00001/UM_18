import test from 'node:test';
import assert from 'node:assert/strict';
import {database,role,action,OWNER,READER,FINANCE,WELFARE} from './database-harness.mjs';

const account=(id,name,offices,permissions=[],extra={})=>({id,display_name:name,active:true,roles:['read_only'],office_codes:offices,permissions,reason:'Reviewed office workspace and individual access',...extra});
const reports=async db=>(await db.query('select public.office_report_list() d')).rows[0].d;
const accountability=async(db,from='2026-10-01',to='2026-10-31')=>(await db.query('select public.executive_accountability($1,$2) d',[from,to])).rows[0].d;
const schedule=async(db,year,member=null)=>(await db.query('select public.monthly_schedule($1,$2) d',[year,member])).rows[0].d;
const reportPayload=(extra={})=>({office_code:'secretary',report_type:'minutes',title:'Secretary meeting minutes',summary:'Reviewed association meeting summary.',report_date:'2026-10-14',...extra});
const createMember=(db,name)=>action(db,'save_member',{full_name:name,phone_original:'08012345678',city:'Uyo',country:'Nigeria',skills:[],details:{address:'PRIVATE-MEMBER-ADDRESS'},reason:'Reviewed fictional finance member'});

test('executive accountability, office reports and monthly schedules preserve private boundaries',async t=>{
 const db=await database();t.after(()=>db.close());let report,member,other,jan,future,fund,receipt,approved,privateDraft;const createKey=crypto.randomUUID();
 await t.test('report permission and office membership are both required; paired offices share their workspace',async()=>{
  await action(db,'save_account',account(READER,'Secretary officer',['secretary']));
  await role(db,'authenticated',READER);await assert.rejects(action(db,'save_office_report',reportPayload()),/Access denied/);
  await role(db,'authenticated',OWNER);await action(db,'save_account',account(READER,'Secretary officer',['secretary'],['office_reports.write']));await action(db,'save_account',account(FINANCE,'Assistant secretary',['assistant_secretary'],['office_reports.write']));await action(db,'save_account',account(WELFARE,'Officer without office',[],['office_reports.write']));
  privateDraft=await action(db,'save_office_report',reportPayload({office_code:'pro',title:'PRIVATE-PRO-DRAFT',summary:'PRIVATE unpublished planning text.'}));
  await role(db,'authenticated',WELFARE);await assert.rejects(action(db,'save_office_report',reportPayload()),/outside your current workspace/);
  await role(db,'authenticated',READER);report=await action(db,'save_office_report',reportPayload(),createKey);assert.equal(report.status,'draft');assert.equal(report.revision,1);
  assert.equal((await reports(db)).length,1);assert.equal((await reports(db))[0].can_edit,true);assert.ok(!(await reports(db)).some(r=>r.id===privateDraft.id));
  await assert.rejects(action(db,'save_office_report',reportPayload({office_code:'treasurer'})),/outside your current workspace/);
  await role(db,'authenticated',FINANCE);const list=await reports(db);assert.ok(list.some(r=>r.id===report.id&&r.can_edit));
  report=await action(db,'save_office_report',reportPayload({id:report.id,expected_revision:1,title:'Joint secretary minutes',reason:'Assistant reviewed the principal officer draft'}));assert.equal(report.revision,2);assert.equal(report.updated_by,FINANCE);
  await assert.rejects(action(db,'save_office_report',reportPayload({id:report.id,expected_revision:1,reason:'Stale colleague edit'})),/Report changed/);
  await assert.rejects(action(db,'save_office_report',reportPayload({id:report.id,expected_revision:2,office_code:'pro',reason:'Try changing the reporting office'})),/report office cannot change/);
 });
 await t.test('publication requires a reviewed draft and preserves revisions, retries and history',async()=>{
  const key=crypto.randomUUID(),p={id:report.id,expected_revision:report.revision,reason:'Reviewed minutes approved for all executives'};
  report=await action(db,'publish_office_report',p,key);assert.equal(report.status,'published');assert.equal(report.revision,3);assert.ok(report.published_at);
  assert.equal((await action(db,'publish_office_report',p,key)).revision,3);await assert.rejects(action(db,'publish_office_report',{...p,reason:'Changed retry'},key),/Retry key reused/);
  await assert.rejects(action(db,'save_office_report',reportPayload({id:report.id,expected_revision:3,reason:'Try overwriting published minutes'})),/Withdraw the published report/);
  await role(db,'authenticated',READER);assert.equal((await action(db,'save_office_report',reportPayload(),createKey)).revision,1);assert.equal((await reports(db)).find(r=>r.id===report.id).revision,3);
  await role(db,'authenticated',WELFARE);const visible=await reports(db);assert.equal(visible.length,1);assert.equal(visible[0].can_edit,false);assert.equal(visible[0].author_name,'Secretary officer');assert.equal(visible[0].updated_by_name,'Assistant secretary');assert.ok(!('created_by' in visible[0]));assert.ok(!('updated_by' in visible[0]));
  await assert.rejects(action(db,'withdraw_office_report',{id:report.id,expected_revision:3,reason:'Other office attempts withdrawal'}),/outside your current workspace/);await assert.rejects(db.query('select public.office_report_history($1)',[report.id]),/outside your current workspace/);
  await role(db,'authenticated',FINANCE);report=await action(db,'withdraw_office_report',{id:report.id,expected_revision:3,reason:'Withdraw for a reviewed correction'});assert.equal(report.status,'draft');assert.equal(report.revision,4);
  await role(db,'authenticated',WELFARE);assert.deepEqual(await reports(db),[]);assert.equal((await db.query('select * from public.office_reports')).rows.length,0);
  await role(db,'authenticated',FINANCE);report=await action(db,'save_office_report',reportPayload({id:report.id,expected_revision:4,summary:'Corrected shared minutes, approved for executive review.',reason:'Correct the earlier draft'}));report=await action(db,'publish_office_report',{id:report.id,expected_revision:5,reason:'Approve the corrected minutes'});assert.equal(report.revision,6);
  const history=(await db.query('select public.office_report_history($1) d',[report.id])).rows[0].d;assert.equal(history.length,6);assert.ok(history.some(h=>h.old_record?.status==='published'&&h.new_record.status==='draft'));
  await assert.rejects(db.query("update public.office_reports set summary='Unrecorded change' where id=$1",[report.id]));
  await role(db,'authenticated',OWNER);await assert.rejects(action(db,'save_office_report',reportPayload({status:'published'})),/Save a draft/);
  for(const offices of [['vice_president'],['treasurer'],['financial_secretary']]){await action(db,'save_account',account(READER,'Paired officer',offices,['office_reports.write']));await role(db,'authenticated',READER);const peer={vice_president:'president',treasurer:'assistant_treasurer',financial_secretary:'assistant_financial_secretary'}[offices[0]];assert.equal((await db.query('select public.can_write_office_report($1) allowed',[peer])).rows[0].allowed,true);assert.equal((await db.query("select public.can_write_office_report('auditor_general') allowed")).rows[0].allowed,false);await role(db,'authenticated',OWNER);}
  await action(db,'save_account',account(READER,'Secretary officer',['secretary'],['office_reports.write']));
 });
 await t.test('financial setup includes advance allocations, preserved month rates and private expense descriptions',async()=>{
  member=await createMember(db,'Accountability member');other=await createMember(db,'Unpaid future member');
  jan=await action(db,'save_collection',{title:'January approved dues',purpose:'Known independent month rate',category:'monthly',period:'2026-01',participation:'compulsory',amount_kobo:200000,deadline:'2026-01-31'});await action(db,'publish_collection',{id:jan.id,member_ids:[member.id],reason:'Approved January members and rate'});
  await action(db,'save_collection',{...jan,amount_kobo:250000,reason:'Change configured rate without rewriting the approved assessment'});
  const a=(await db.query('select id from public.member_assessments where collection_id=$1',[jan.id])).rows[0];await action(db,'adjust_assessment',{id:a.id,expected_kobo:200000,waiver_kobo:50000,reason:'Approved individual waiver'});
  const waived=await action(db,'save_collection',{title:'February fully waived dues',purpose:'Approved month with a full waiver',category:'monthly',period:'2026-02',participation:'compulsory',amount_kobo:150000});await action(db,'publish_collection',{id:waived.id,member_ids:[other.id],reason:'Approved February obligation'});const waivedAssessment=(await db.query('select id from public.member_assessments where collection_id=$1',[waived.id])).rows[0];await action(db,'adjust_assessment',{id:waivedAssessment.id,expected_kobo:150000,waiver_kobo:150000,reason:'Approved full February waiver'});
  future=await action(db,'save_collection',{title:'Future December dues',purpose:'Advance contribution coverage',category:'monthly',period:'2027-12',participation:'compulsory',amount_kobo:300000,deadline:'2027-12-31'});await action(db,'publish_collection',{id:future.id,member_ids:[member.id,other.id],reason:'Approved future monthly obligations'});
  await action(db,'save_collection',{title:'Unknown November rate',purpose:'No approved amount or obligation yet',category:'monthly',period:'2026-11',participation:'compulsory',amount_kobo:null});
  fund=await action(db,'save_collection',{title:'Association reunion fund',purpose:'Independent voluntary special collection',category:'event',participation:'voluntary',target_kobo:1000000});await action(db,'publish_collection',{id:fund.id,reason:'Approved voluntary reunion fund'});
  const allocations=[{collection_id:jan.id,amount_kobo:200000},{collection_id:future.id,amount_kobo:300000},{collection_id:fund.id,amount_kobo:100000}];
  receipt=await action(db,'record_payment',{member_id:member.id,amount_kobo:900000,payment_date:'2026-10-10',method:'bank_transfer',reference:'PRIVATE-TRANSFER-REFERENCE',verified:true,reason:'PRIVATE verification note',allocations});
  await action(db,'adjust_payment',{id:receipt.id,kind:'refund',delta_kobo:-100000,effective_date:'2026-11-02',reason:'External refund from unallocated credit',allocations});
  await action(db,'record_payment',{member_id:other.id,amount_kobo:400000,payment_date:'2026-10-11',method:'cash',verified:false,reason:'Pending external verification'});
  const reversed=await action(db,'record_payment',{member_id:other.id,amount_kobo:500000,payment_date:'2026-10-11',method:'cash',verified:true,reason:'Confirmed separate receipt'});await action(db,'transition_payment',{id:reversed.id,status:'reversed',reason:'Documented duplicate receipt reversal'});
  approved=await action(db,'save_expense',{collection_id:fund.id,expense_date:'2026-10-12',description:'PRIVATE-WELFARE-CONTEXT',payee:'PRIVATE-PAYEE',amount_kobo:120000,overview_summary:'Venue reservation',reason:'PRIVATE-FINANCE-NOTE'});await action(db,'transition_expense',{id:approved.id,status:'approved',reason:'Approve documented spending'});
  await action(db,'save_expense',{collection_id:fund.id,expense_date:'2026-10-15',description:'PRIVATE-PENDING-DESCRIPTION',payee:'PRIVATE-PENDING-PAYEE',amount_kobo:30000,reason:'Pending spending review'});
  const reversedExpense=await action(db,'save_expense',{collection_id:fund.id,expense_date:'2026-10-16',description:'PRIVATE-REVERSED-DESCRIPTION',payee:'PRIVATE-REVERSED-PAYEE',amount_kobo:50000,overview_summary:'Reservation reversed',reason:'Recorded spending'});await action(db,'transition_expense',{id:reversedExpense.id,status:'approved',reason:'Approved spending'});await action(db,'transition_expense',{id:reversedExpense.id,status:'reversed',reason:'Documented spending reversal'});
  const rejected=await action(db,'save_expense',{collection_id:fund.id,expense_date:'2026-10-18',description:'PRIVATE-REJECTED-DESCRIPTION',payee:'PRIVATE-REJECTED-PAYEE',amount_kobo:20000,overview_summary:'Proposed refreshments',reason:'Recorded spending'});await action(db,'transition_expense',{id:rejected.id,status:'rejected',reason:'Rejected proposal'});
  const oldExpense=await action(db,'save_expense',{collection_id:jan.id,expense_date:'2026-09-01',description:'PRIVATE-OUTSIDE-RANGE',payee:'Other payee',amount_kobo:10000,reason:'Prior period spending'});await action(db,'transition_expense',{id:oldExpense.id,status:'approved',reason:'Prior approved spending'});
 });
 await t.test('all AAL2 executives receive safe accountability without direct private ledger access',async()=>{
  await role(db,'authenticated',READER);assert.equal((await db.query("select public.has_permission('finance.read') allowed")).rows[0].allowed,false);
  const d=await accountability(db);assert.deepEqual(d.totals,{receipts_kobo:800000,approved_expenses_kobo:120000,pending_expenses_kobo:30000,reversed_expenses_kobo:50000});assert.equal(d.expenses.length,4);assert.equal(d.expenses.find(e=>e.id===approved.id).description,'Venue reservation');assert.ok(d.expenses.some(e=>e.description==='Expense recorded'));
  const allowedFields=['amount_kobo','collection_title','description','expense_date','id','responsible_officer_name','status'];for(const e of d.expenses)assert.deepEqual(Object.keys(e).toSorted(),allowedFields.toSorted());
  assert.equal(d.reports.length,1);assert.equal(d.reports[0].id,report.id);assert.equal(d.reports[0].author_name,'Secretary officer');assert.ok(!JSON.stringify(d).includes('PRIVATE-'));assert.ok(!JSON.stringify(d).includes(member.id));assert.ok(!JSON.stringify(d).includes(receipt.id));assert.ok(!JSON.stringify(d).includes('payee'));assert.ok(!JSON.stringify(d).includes('object_path'));assert.ok(!JSON.stringify(d).includes('created_by'));
  assert.equal((await db.query('select * from public.payments')).rows.length,0);assert.equal((await db.query('select * from public.expenses')).rows.length,0);await assert.rejects(db.query('select public.collection_summaries()'));await assert.rejects(db.query('select public.monthly_schedule(2026)'));await assert.rejects(db.query('select public.collection_summary_data()'));
  await assert.rejects(accountability(db,'2026-11-01','2026-10-01'),/date range/);await assert.rejects(accountability(db,'2020-01-01','2026-10-01'),/date range/);
  await role(db,'authenticated',OWNER);
 });
 await t.test('shared expense copy is atomic, bounded and does not leak private text on retries',async()=>{
  const key=crypto.randomUUID(),p={collection_id:fund.id,expense_date:'2026-12-01',description:'PRIVATE-EDITABLE-DESCRIPTION',payee:'PRIVATE-EDITABLE-PAYEE',amount_kobo:40000,overview_summary:'Shared initial summary',reason:'Record controlled shared summary'};
  const first=await action(db,'save_expense',p,key);assert.equal(first.overview_summary,p.overview_summary);assert.equal((await action(db,'save_expense',p,key)).overview_summary,p.overview_summary);
  await action(db,'save_expense',{...p,id:first.id,overview_summary:'Latest shared summary',reason:'Review the shared copy'});
  assert.equal((await action(db,'save_expense',p,key)).overview_summary,p.overview_summary);assert.equal((await db.query('select overview_summary from public.expenses where id=$1',[first.id])).rows[0].overview_summary,'Latest shared summary');
  const {overview_summary:_,...withoutSummary}=p;await action(db,'save_expense',{...withoutSummary,id:first.id,reason:'Edit private details without changing shared copy'});assert.equal((await db.query('select overview_summary from public.expenses where id=$1',[first.id])).rows[0].overview_summary,'Latest shared summary');
  await assert.rejects(action(db,'save_expense',{...p,overview_summary:'x'.repeat(1501)}),/1500 characters/);
 });
 await t.test('the monthly schedule returns twelve actual months, approved coverage and unallocated credit',async()=>{
  const before=(await db.query('select count(*) n from public.member_assessments')).rows[0].n;
  const d=await schedule(db,2026,member.id);assert.equal(d.months.length,12);assert.equal(d.credit_kobo,200000);assert.equal(d.member_id,member.id);
  const january=d.months.find(m=>m.period==='2026-01').collections[0];assert.equal(january.amount_kobo,250000);assert.equal(january.member_expected_kobo,200000);assert.equal(january.member_waiver_kobo,50000);assert.equal(january.member_paid_kobo,200000);assert.equal(january.member_assessed,true);assert.equal(january.expected_kobo,150000);assert.equal(january.outstanding_kobo,0);assert.equal(january.received_kobo,200000);assert.equal(january.spending_kobo,10000);
  assert.equal(january.assessment_count,1);
  const unknown=d.months.find(m=>m.period==='2026-11').collections[0];assert.equal(unknown.amount_kobo,null);assert.equal(unknown.status,'draft');assert.equal(unknown.member_assessed,false);assert.equal(unknown.member_expected_kobo,null);assert.equal(unknown.outstanding_kobo,0);assert.equal(unknown.assessment_count,0);assert.equal(d.months.find(m=>m.period==='2026-03').collections.length,0);
  const waived=(await schedule(db,2026,other.id)).months.find(m=>m.period==='2026-02').collections[0];assert.equal(waived.assessment_count,1);assert.equal(waived.expected_kobo,0);assert.equal(waived.member_expected_kobo,150000);assert.equal(waived.member_waiver_kobo,150000);assert.equal(waived.member_assessed,true);
  const futureSchedule=await schedule(db,2027,other.id),december=futureSchedule.months.find(m=>m.period==='2027-12').collections[0];assert.equal(december.deadline,'2027-12-31');assert.equal(december.member_expected_kobo,300000);assert.equal(december.member_paid_kobo,0);assert.equal(december.expected_kobo,600000);assert.equal(december.outstanding_kobo,300000);assert.equal('overdue' in december,false);assert.equal('member_status' in december,false);
  const all=await schedule(db,2026);assert.equal(all.member_id,null);assert.equal(all.credit_kobo,0);assert.equal(all.months[0].collections[0].member_expected_kobo,null);assert.equal(all.months[0].collections[0].member_paid_kobo,null);
  assert.equal((await db.query('select count(*) n from public.member_assessments')).rows[0].n,before);await assert.rejects(schedule(db,2101),/valid schedule year/);await assert.rejects(schedule(db,9999),/valid schedule year/);await assert.rejects(schedule(db,2026,crypto.randomUUID()),/Member unavailable/);
  const summaries=(await db.query('select public.collection_summaries() d')).rows[0].d;assert.deepEqual(summaries.find(s=>s.id===jan.id),{id:jan.id,received:200000,spending:10000,expected:150000,outstanding:0,remaining:190000});assert.deepEqual(summaries.find(s=>s.id===fund.id),{id:fund.id,received:100000,spending:120000,expected:0,outstanding:0,remaining:-20000});
 });
 await t.test('permission denials, office changes and live session revocation apply before command receipt replay',async()=>{
  await action(db,'save_account',account(READER,'Secretary officer',['secretary'],['office_reports.write'],{denied_permissions:['office_reports.write']}));await role(db,'authenticated',READER);await assert.rejects(action(db,'save_office_report',reportPayload(),createKey),/Access denied/);assert.equal((await reports(db))[0].can_edit,false);
  await role(db,'authenticated',OWNER);await action(db,'save_account',account(READER,'Changed office',['pro'],['office_reports.write']));await role(db,'authenticated',READER);await assert.rejects(action(db,'save_office_report',reportPayload(),createKey),/outside your current workspace/);assert.ok((await reports(db)).some(r=>r.id===privateDraft.id));
  await db.exec('reset role');await db.query('delete from auth.sessions where user_id=$1',[READER]);await db.exec('set role authenticated');await assert.rejects(accountability(db),/Access denied/);await assert.rejects(db.query('select public.office_report_list()'),/Access denied/);await assert.rejects(action(db,'save_office_report',reportPayload({office_code:'pro'})),/Access denied/);await role(db,'authenticated',OWNER);
 });
 await t.test('anonymous, service-only identities and AAL1 executives cannot use the new private RPCs',async()=>{
  await role(db,'authenticated',OWNER,'aal1');for(const query of ['select public.executive_accountability()','select public.office_report_list()','select public.collection_summaries()','select public.monthly_schedule(2026)'])await assert.rejects(db.query(query),/Access denied/);
  await role(db,'anon',null);for(const query of ['select public.executive_accountability()','select public.office_report_list()','select public.collection_summaries()','select public.monthly_schedule(2026)','select * from public.office_reports','select * from public.office_report_history'])await assert.rejects(db.query(query),/permission denied/);
  await role(db,'service_role',null);await assert.rejects(db.query('select public.executive_accountability()'),/permission denied/);
 });
});
