import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtures} from '../fixtures/review.js';
import {money,dayISO} from '../public/assets/js/domain.js';
import {MONTH_NAMES,monthEnd,localMonthlySchedule,collectionCoverage,monthlyScheduleModel} from '../public/assets/js/monthly-schedule.js';
import {renderCollections} from '../public/assets/js/modules/collections.js';
import {setup} from './dom-harness.mjs';

const collection={id:'20000000-0000-4000-8000-000000000001',title:'Approved dues',period:'2026-09',status:'open',participation:'compulsory',amount_kobo:200000,deadline:null,received_kobo:0,spending_kobo:0,expected_kobo:200000,outstanding_kobo:200000,member_expected_kobo:200000,member_waiver_kobo:0,member_paid_kobo:0,member_assessed:true};
const memberId='20000000-0000-4000-8000-000000000002';

test('the year has January through December without creating obligations for unset rates or drafts',()=>{
  const data=fixtures(),schedule=localMonthlySchedule(data,{year:2026,memberId:data.members[0].id}),months=monthlyScheduleModel(schedule,{today:'2026-10-14'});
  assert.equal(months.length,12);assert.deepEqual(months.map(month=>month.label),MONTH_NAMES);
  assert.equal(months[0].state,'unset');assert.equal(months[0].outstanding,0);
  assert.equal(months[8].due,200000);assert.equal(months[8].state,'paid');
  assert.equal(months[9].due,250000);assert.equal(months[9].state,'paid');
  assert.equal(months[10].collections[0].status,'draft');assert.equal(months[10].state,'unset');assert.equal(months[10].due,0);
  assert.equal(months[11].state,'unset');
  data.collections[0].amount_kobo=999000;
  assert.equal(monthlyScheduleModel(localMonthlySchedule(data,{year:2026,memberId:data.members[0].id}),{today:'2026-10-14'})[8].due,200000,'A configured rate change must not rewrite approved snapshots.');
});

test('future coverage never becomes overdue and approved snapshot, waiver and deadline rules determine current dues',()=>{
  assert.equal(monthEnd('2028-02'),'2028-02-29');
  const future=collectionCoverage({...collection,period:'2026-12',deadline:'2026-01-01',member_paid_kobo:50000},{memberId,today:'2026-10-14'});
  assert.equal(future.state,'future');assert.equal(future.coverage,'partial');assert.equal(future.overdue,false);assert.equal(future.outstanding,150000);
  const paidAhead=collectionCoverage({...collection,period:'2026-12',member_paid_kobo:200000},{memberId,today:'2026-10-14'});
  assert.equal(paidAhead.state,'future');assert.equal(paidAhead.coverage,'paid');
  assert.equal(collectionCoverage(collection,{memberId,today:'2026-09-30'}).state,'due');
  assert.equal(collectionCoverage(collection,{memberId,today:'2026-10-01'}).state,'overdue');
  assert.equal(collectionCoverage({...collection,deadline:'2026-10-20'},{memberId,today:'2026-10-14'}).state,'due');
  assert.equal(collectionCoverage({...collection,member_waiver_kobo:200000},{memberId,today:'2026-10-14'}).state,'waived');
  assert.equal(collectionCoverage({...collection,amount_kobo:null},{memberId,today:'2026-10-14'}).due,200000);
  assert.equal(collectionCoverage({...collection,member_assessed:false},{memberId,today:'2026-10-14'}).state,'unset');
  assert.equal(collectionCoverage({...collection,status:'draft'},{memberId,today:'2026-10-14'}).outstanding,0);
});

test('multiple collections in one month remain independent and aggregate overpayment cannot hide another member balance',()=>{
  const schedule={year:2026,member_id:memberId,months:[{period:'2026-09',collections:[collection,{...collection,id:'waived',title:'Independent waived collection',member_expected_kobo:100000,member_waiver_kobo:100000},{...collection,id:'draft',title:'Draft extra collection',status:'draft',amount_kobo:null}]}]};
  const month=monthlyScheduleModel(schedule,{today:'2026-10-14'})[8];
  assert.equal(month.collections.length,3);assert.equal(month.due,200000);assert.equal(month.outstanding,200000);assert.equal(month.state,'overdue');
  const aggregate=monthlyScheduleModel({year:2026,member_id:null,months:[{period:'2026-09',collections:[{...collection,expected_kobo:200000,received_kobo:200000,outstanding_kobo:100000}]}]},{today:'2026-10-14'})[8];
  assert.equal(aggregate.state,'partial');assert.equal(aggregate.outstanding,100000);assert.equal(aggregate.overdue,100000);
});

test('fully waived published dues remain waived in the association overview and superseded assessments are excluded',()=>{
  const data=fixtures(),target=data.collections[1];
  for(const assessment of data.assessments.filter(row=>row.collection_id===target.id))assessment.waiver_kobo=assessment.expected_kobo;
  data.assessments.push({id:'old-snapshot',collection_id:target.id,member_id:data.members[0].id,expected_kobo:999000,waiver_kobo:0,superseded_by:data.assessments.find(row=>row.collection_id===target.id).id});
  const schedule=localMonthlySchedule(data,{year:2026}),month=monthlyScheduleModel(schedule,{today:'2026-10-14'})[9];
  assert.equal(month.collections[0].assessment_count,11);assert.equal(month.assessed,true);assert.equal(month.state,'waived');assert.equal(month.due,0);assert.equal(month.outstanding,0);
  assert.equal(collectionCoverage({...collection,assessment_count:0,expected_kobo:999000},{today:'2026-10-14'}).state,'unset','The canonical count overrides an obsolete total.');
});

test('collection cards use remote aggregate totals even when the page has no loaded payment ledger',async()=>{
  const {ctx,cleanup}=setup();let summariesCalled=0;
  try{
    ctx.monthlyYear=2026;ctx.data.payments=[];ctx.data.allocations=[];ctx.data.assessments=[];ctx.data.expenses=[];
    ctx.svc.collectionSummaries=async()=>{summariesCalled++;return ctx.data.collections.map(c=>({id:c.id,received:123400,spending:10000,expected:300000,outstanding:176600,remaining:113400}));};
    ctx.svc.monthlySchedule=async({year,memberId})=>localMonthlySchedule(ctx.data,{year,memberId});
    await renderCollections(ctx,'monthly');
    assert.equal(summariesCalled,1);
    assert.equal(document.querySelector(`[data-collection-card="${ctx.data.collections[0].id}"] .card-total`).textContent,money(123400));
    assert.equal(document.querySelectorAll('[data-month]').length,12);
    assert.deepEqual(Array.from(document.querySelectorAll('[data-collection-card]')).map(card=>card.dataset.collectionCard),ctx.data.collections.filter(c=>c.category==='monthly').map(c=>c.id));
  }finally{cleanup();}
});

test('member lookup loads scoped coverage and advance payment links without recording income or fabricated future debt',async()=>{
  const {ctx,cleanup}=setup();let lookup,requests=[],writes=0;
  try{
    const year=Number(dayISO().slice(0,4)),month=dayISO().slice(5,7);ctx.monthlyYear=year;
    ctx.svc.searchMembers=async request=>{lookup=request;return {count:1,rows:[{id:memberId,full_name:'Scoped member outside the loaded list',member_no:'SET2018-999'}]};};
    ctx.svc.monthlySchedule=async request=>{
      requests.push(request);return {year:request.year,member_id:request.memberId||null,credit_kobo:150000,months:[{period:request.year+'-'+month,collections:[{...collection,period:request.year+'-'+month,member_waiver_kobo:200000}]}]};
    };
    ctx.act=async()=>{writes++;};await renderCollections(ctx,'monthly');
    const search=document.querySelector('#monthly-member-form');search.querySelector('[name=query]').value='SET2018-999';await search.onsubmit({preventDefault(){},currentTarget:search});
    assert.equal(lookup.query,'SET2018-999');assert.equal(lookup.limit,10);
    await document.querySelector('[data-monthly-member]').onclick();
    assert.equal(requests.at(-1).memberId,memberId);assert.equal(document.querySelector(`[data-month="${year+'-'+month}"]`).dataset.monthState,'waived');
    assert.ok(document.querySelector('#monthly-selected-member').textContent.includes('Scoped member outside the loaded list'));
    assert.equal(document.querySelector('#monthly-advance-hint a').getAttribute('href'),'/admin/payments/?new=1&member='+memberId);
    assert.ok(document.querySelector('#monthly-advance-hint').textContent.includes(money(150000)));
    assert.equal(writes,0);
    document.querySelector('#monthly-year').value=String(year+1);const yearForm=document.querySelector('#monthly-year-form');await yearForm.onsubmit({preventDefault(){},currentTarget:yearForm});
    assert.equal(requests.at(-1).year,year+1);assert.equal(document.querySelectorAll('[data-month]').length,12);
    assert.equal(document.querySelector(`[data-month="${year+1+'-'+month}"]`).dataset.monthState,'future');
    assert.equal(document.querySelector('[data-month-state=overdue]'),null);
    await document.querySelector('#monthly-clear-member').onclick();assert.equal(requests.at(-1).memberId,null);
  }finally{cleanup();}
});

test('an unavailable canonical schedule or totals shows an error instead of presenting an empty ledger as zero',async()=>{
  const {ctx,cleanup}=setup();
  try{
    ctx.monthlyYear=2026;ctx.svc.collectionSummaries=async()=>{throw new Error('Canonical totals unavailable');};ctx.svc.monthlySchedule=async()=>{throw new Error('Canonical schedule unavailable');};
    await renderCollections(ctx,'monthly');
    assert.equal(document.querySelector('.card-total').textContent,'Unavailable');
    assert.equal(document.querySelectorAll('[data-month]').length,0);
    assert.equal(document.querySelector('#monthly-schedule-error').textContent,'Canonical schedule unavailable');
    assert.equal(document.querySelector('#monthly-schedule-summary').textContent,'');
  }finally{cleanup();}
});

test('configuring an unset month only opens an unpriced draft form and read-only accounts have no payment controls',async()=>{
  const {ctx,cleanup}=setup();let writes=0;
  try{
    ctx.monthlyYear=2026;ctx.act=async()=>{writes++;};await renderCollections(ctx,'monthly');
    document.querySelector('[data-configure-month="2026-01"]').click();
    const form=document.querySelector('dialog form');assert.equal(form.querySelector('[name=period]').value,'2026-01');assert.equal(form.querySelector('[name=amount]').value,'');assert.equal(writes,0);
    document.querySelector('dialog').remove();ctx.can=permission=>permission==='finance.read';await renderCollections(ctx,'monthly');
    assert.equal(document.querySelector('[data-configure-month]'),null);assert.equal(document.querySelector('#monthly-advance-hint a'),null);assert.equal(document.querySelector('#create-collection'),null);
  }finally{cleanup();}
});
