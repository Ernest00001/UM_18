import {netPayment} from './domain.js';
export function localMemberContributions(d,memberId){
 const payments=d.payments.filter(p=>p.member_id===memberId&&p.status==='confirmed');
 const allocations=d.allocations.filter(a=>a.member_id===memberId&&payments.some(p=>p.id===a.payment_id));
 const received=payments.reduce((n,p)=>n+netPayment(p,d.adjustments),0),allocated=allocations.reduce((n,a)=>n+a.amount_kobo,0);
 const coverage=d.collections.filter(c=>c.status!=='draft').flatMap(c=>{const a=d.assessments.find(a=>a.member_id===memberId&&a.collection_id===c.id&&!a.superseded_by),paid=allocations.filter(x=>x.collection_id===c.id).reduce((n,x)=>n+x.amount_kobo,0);if(!a&&!paid)return [];const due=a?Math.max(0,a.expected_kobo-(a.waiver_kobo||0)):0;return [{id:c.id,title:c.title,category:c.category,period:c.period,due_kobo:due,paid_kobo:paid,outstanding_kobo:Math.max(0,due-paid)}];});
 return {member_id:memberId,total_confirmed_kobo:received,credit_kobo:Math.max(0,received-allocated),monthly_kobo:coverage.filter(c=>c.category==='monthly').reduce((n,c)=>n+c.paid_kobo,0),special_kobo:coverage.filter(c=>c.category!=='monthly').reduce((n,c)=>n+c.paid_kobo,0),outstanding_kobo:coverage.reduce((n,c)=>n+c.outstanding_kobo,0),coverage,payments:payments.map(p=>({id:p.id,payment_date:p.payment_date,net_kobo:netPayment(p,d.adjustments),status:p.status})).sort((a,b)=>b.payment_date.localeCompare(a.payment_date))};
}
