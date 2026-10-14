import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtures} from '../fixtures/empty-preview.js';
import {mutateOfficeReport,officeReportList,accountabilityOverview,monthlySchedule,collectionSummaries,requireOfficeReportWrite} from '../public/assets/js/review-accountability.js';

const setup=()=>{const data=fixtures();return {data,user:data.accounts[0]};};
test('preview accountability shares approved summaries without leaking private expense details',()=>{
 const svc=setup(),actor=svc.user.id;
 svc.data.accounts.push({id:'reader',display_name:'Executive reader',active:true,office_codes:['pro'],permissions:['directory.read']});
 svc.data.collections.push({id:'fund',title:'Association meeting',category:'event'});
 svc.data.payments.push({id:'receipt',payment_date:'2026-10-14',status:'confirmed',amount_kobo:1000000,member_id:'private-member',reference:'PRIVATE-REFERENCE'});
 svc.data.adjustments.push({payment_id:'receipt',delta_kobo:-100000});
 for(const [status,amount] of [['approved',200000],['pending',300000],['reversed',400000]])svc.data.expenses.push({id:status,expense_date:'2026-10-14',status,amount_kobo:amount,collection_id:'fund',recorded_by:actor,description:'PRIVATE-WELFARE-DETAILS',payee:'PRIVATE-PAYEE',reason:'PRIVATE-NOTE',overview_summary:status==='approved'?'Meeting equipment':null});
 svc.user=svc.data.accounts[1];const result=accountabilityOverview(svc,{from:'2026-10-01',to:'2026-10-31'});
 assert.deepEqual(result.totals,{receipts_kobo:900000,approved_expenses_kobo:200000,pending_expenses_kobo:300000,reversed_expenses_kobo:400000});
 assert.ok(result.expenses.some(e=>e.description==='Meeting equipment'));assert.ok(result.expenses.some(e=>e.description==='Expense recorded'));
 assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.throws(()=>collectionSummaries(svc),/access/);
 svc.user.active=false;assert.throws(()=>accountabilityOverview(svc),/access/);
});

test('preview office report drafts require permission and share only within an assigned team',()=>{
 const svc=setup();const writer={id:'secretary',active:true,display_name:'Secretary',office_codes:['secretary'],permissions:['directory.read','office_reports.write']};svc.data.accounts.push(writer);svc.user=writer;
 const draft=mutateOfficeReport(svc,'save_office_report',{office_code:'secretary',report_type:'minutes',title:'Meeting decisions',summary:'A brief approved account of the meeting.',report_date:'2026-10-14'});
 assert.equal(draft.status,'draft');assert.equal(draft.revision,1);
 svc.data.accounts.push({id:'assistant',active:true,display_name:'Assistant',office_codes:['assistant_secretary'],permissions:['directory.read','office_reports.write']});svc.user=svc.data.accounts.at(-1);
 assert.equal(officeReportList(svc).length,1);assert.equal(officeReportList(svc)[0].can_edit,true);
 assert.throws(()=>mutateOfficeReport(svc,'publish_office_report',{id:draft.id,expected_revision:9,reason:'Reviewed'}),/changed/);
 const published=mutateOfficeReport(svc,'publish_office_report',{id:draft.id,expected_revision:1,reason:'Reviewed meeting decisions'});assert.equal(published.revision,2);
 svc.user={id:'pro',active:true,display_name:'PRO',office_codes:['pro'],permissions:['directory.read','office_reports.write']};
 assert.equal(officeReportList(svc)[0].can_edit,false);assert.throws(()=>requireOfficeReportWrite(svc,{id:draft.id}),/assigned office team/);
 svc.user=writer;const withdrawn=mutateOfficeReport(svc,'withdraw_office_report',{id:draft.id,expected_revision:2,reason:'Correct one decision before republishing'});assert.equal(withdrawn.status,'draft');
 writer.permissions=['directory.read'];assert.equal(officeReportList(svc).length,0);assert.throws(()=>requireOfficeReportWrite(svc,{id:draft.id}),/access/);
 assert.equal(svc.data.officeReportHistory.length,3);assert.equal(svc.data.officeReportHistory[1].actor_id,'assistant');
});

test('preview monthly schedule preserves published future coverage and unallocated credit',()=>{
 const svc=setup();svc.data.members.push({id:'member',archived_at:null});
 svc.data.collections.push({id:'nov',title:'November dues',category:'monthly',period:'2026-11',status:'open',participation:'compulsory',amount_kobo:100000},{id:'dec',title:'December draft',category:'monthly',period:'2026-12',status:'draft',participation:'compulsory',amount_kobo:null});
 svc.data.assessments.push({member_id:'member',collection_id:'nov',expected_kobo:100000,waiver_kobo:0});svc.data.payments.push({id:'payment',member_id:'member',status:'confirmed',amount_kobo:300000});svc.data.allocations.push({payment_id:'payment',member_id:'member',collection_id:'nov',amount_kobo:100000});
 const schedule=monthlySchedule(svc,{year:2026,memberId:'member'});assert.equal(schedule.months.length,12);assert.equal(schedule.credit_kobo,200000);assert.equal(schedule.months[10].collections[0].member_paid_kobo,100000);assert.equal(schedule.months[11].collections[0].member_assessed,false);assert.equal(schedule.months[11].collections[0].member_expected_kobo,null);
 assert.equal(collectionSummaries(svc).find(c=>c.id==='nov').received,100000);
 assert.throws(()=>monthlySchedule(svc,{year:2026,memberId:'missing'}),/available member/);
});
