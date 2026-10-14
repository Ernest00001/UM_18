import {collectionTotals,paidFor,netPayment,dayISO} from './domain.js';

export const MONTH_NAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];
export function monthEnd(period){const [year,month]=period.split('-').map(Number);return new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);}

// Used by complete local fixtures. Production supplies canonical scoped RPC data.
export function localMonthlySchedule(data,{year,memberId=null}){
 const activeData={...data,assessments:data.assessments.filter(assessment=>!assessment.superseded_by)};
 const months=MONTH_NAMES.map((label,index)=>{
  const period=year+'-'+String(index+1).padStart(2,'0');
  return {period,collections:data.collections.filter(c=>c.category==='monthly'&&c.period===period).map(c=>{
   const totals=collectionTotals(activeData,c),assessment=activeData.assessments.find(a=>a.collection_id===c.id&&a.member_id===memberId),assessmentCount=activeData.assessments.filter(a=>a.collection_id===c.id).length;
   return {...c,received_kobo:totals.received,spending_kobo:totals.spending,expected_kobo:totals.expected,outstanding_kobo:totals.outstanding,assessment_count:assessmentCount,member_expected_kobo:assessment?.expected_kobo??null,member_waiver_kobo:assessment?.waiver_kobo??null,member_paid_kobo:memberId?paidFor(data,memberId,c.id):null,member_assessed:Boolean(assessment)};
  })};
 });
 const credit=memberId?data.payments.filter(p=>p.member_id===memberId).reduce((total,p)=>total+netPayment(p,data.adjustments)-(p.status==='confirmed'?data.allocations.filter(a=>a.payment_id===p.id).reduce((sum,a)=>sum+Number(a.amount_kobo),0):0),0):0;
 return {year,member_id:memberId,credit_kobo:credit,months};
}

export function collectionCoverage(collection,{memberId=null,today=dayISO()}={}){
 const member=Boolean(memberId),assessed=collection.status!=='draft'&&collection.participation==='compulsory'&&(member?collection.member_assessed:collection.assessment_count!==undefined?Number(collection.assessment_count)>0:Number(collection.expected_kobo)>0);
 const expected=member?Number(collection.member_expected_kobo||0):Number(collection.expected_kobo||0),waived=member?Number(collection.member_waiver_kobo||0):0;
 const due=assessed?Math.max(0,expected-waived):0,paid=member?Number(collection.member_paid_kobo||0):Number(collection.received_kobo||0);
 const outstanding=assessed?(member?Math.max(0,due-paid):Number(collection.outstanding_kobo||0)):0;
 const deadline=collection.deadline||monthEnd(collection.period),future=collection.period>today.slice(0,7),overdue=assessed&&!future&&outstanding>0&&deadline<today;
 const coverage=!assessed?'unset':due===0?'waived':outstanding===0?'paid':paid>0?'partial':'due';
 const state=!assessed?'unset':future?'future':coverage==='due'&&overdue?'overdue':coverage;
 return {...collection,assessed,expected,waived,due,paid,outstanding,deadline,future,overdue,coverage,state};
}

export function monthlyScheduleModel(schedule,{today=dayISO()}={}){
 const year=Number(schedule.year),memberId=schedule.member_id||null,provided=new Map((schedule.months||[]).map(month=>[month.period,month]));
 return MONTH_NAMES.map((label,index)=>{
  const period=year+'-'+String(index+1).padStart(2,'0'),collections=(provided.get(period)?.collections||[]).map(c=>collectionCoverage({...c,period},{memberId,today}));
  const assessed=collections.filter(c=>c.assessed),due=assessed.reduce((sum,c)=>sum+c.due,0),paid=collections.reduce((sum,c)=>sum+c.paid,0),outstanding=assessed.reduce((sum,c)=>sum+c.outstanding,0),overdue=assessed.reduce((sum,c)=>sum+(c.overdue?c.outstanding:0),0),future=period>today.slice(0,7);
  const covered=assessed.reduce((sum,c)=>sum+c.paid,0);
  const coverage=!assessed.length?'unset':assessed.every(c=>c.coverage==='waived')?'waived':outstanding===0?'paid':covered>0?'partial':'due';
  const state=coverage==='unset'?'unset':future?'future':coverage==='due'&&overdue>0?'overdue':coverage;
  return {period,label,collections,assessed:assessed.length>0,due,paid,outstanding,overdue,future,coverage,state};
 });
}
