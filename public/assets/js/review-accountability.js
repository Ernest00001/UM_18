import {collectionTotals,paidFor,netPayment,dayISO,uid} from './domain.js';
import {EXECUTIVE_OFFICES,officeWorkspaces} from './executive-offices.js';

const current=svc=>svc.data.accounts.find(a=>a.id===svc.user?.id)||svc.user;
export function requireExecutive(svc,permission='directory.read'){
 const user=current(svc);
 if(!user||user.active===false||user.needs_mfa||!user.permissions?.includes(permission))throw new Error('Your current executive access does not permit this action.');
 return user;
}
export function canEditOfficeReport(svc,office){
 const user=current(svc);
 return !!(user?.active!==false&&user?.permissions?.includes('office_reports.write')&&(user.permissions.includes('accounts.write')||officeWorkspaces(user.office_codes).some(team=>team.office_codes.includes(office))));
}
export function requireOfficeReportWrite(svc,p){
 requireExecutive(svc,'office_reports.write');
 const report=svc.data.office_reports.find(r=>r.id===p.id);
 if(p.id&&!report)throw new Error('Office report unavailable.');
 if(!canEditOfficeReport(svc,report?.office_code||p.office_code))throw new Error('You can only manage reports for your assigned office team.');
 return report;
}
const reportProjection=(svc,r)=>({id:r.id,office_code:r.office_code,report_type:r.report_type,title:r.title,summary:r.summary,report_date:r.report_date,status:r.status,revision:r.revision,author_name:svc.data.accounts.find(a=>a.id===r.created_by)?.display_name||'Executive',updated_by_name:svc.data.accounts.find(a=>a.id===r.updated_by)?.display_name||'Executive',published_at:r.published_at,updated_at:r.updated_at,can_edit:canEditOfficeReport(svc,r.office_code)});
export function officeReportList(svc){
 requireExecutive(svc);
 return svc.data.office_reports.filter(r=>r.status==='published'||canEditOfficeReport(svc,r.office_code)).sort((a,b)=>b.report_date.localeCompare(a.report_date)||b.updated_at.localeCompare(a.updated_at)).map(r=>reportProjection(svc,r));
}
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
export function mutateOfficeReport(svc,action,p){
 const user=requireExecutive(svc,'office_reports.write');let r=requireOfficeReportWrite(svc,p);
 if(r&&(!Number.isInteger(p.expected_revision)||p.expected_revision!==r.revision))throw new Error('This report changed. Refresh and review its latest version.');
 const reason=String(p.reason||'').trim();
 if(r&&(reason.length<2||reason.length>1500))throw new Error('Provide a change reason between 2 and 1500 characters.');
 const old=r?structuredClone(r):null,now=new Date().toISOString();
 if(action==='save_office_report'){
  if(r?.status==='published')throw new Error('Withdraw the published report before editing it.');
  if(!EXECUTIVE_OFFICES.some(o=>o.code===p.office_code)||r&&r.office_code!==p.office_code)throw new Error('Choose the original assigned office.');
  if(!['report','minutes','board_decision'].includes(p.report_type)||String(p.title||'').trim().length<2||String(p.title).length>180||String(p.summary||'').trim().length<2||String(p.summary).length>6000||!validDate(p.report_date))throw new Error('Provide the report type, title, summary and valid date.');
  if(!r){r={id:uid(),office_code:p.office_code,created_by:user.id,created_at:now,revision:0,published_at:null};svc.data.office_reports.push(r);}
  Object.assign(r,{report_type:p.report_type,title:p.title.trim(),summary:p.summary.trim(),report_date:p.report_date,status:'draft'});
 }else if(action==='publish_office_report'){
  if(r.status!=='draft')throw new Error('Only a draft report can be published.');r.status='published';r.published_at=now;
 }else if(action==='withdraw_office_report'){
  if(r.status!=='published')throw new Error('Only a published report can be withdrawn.');r.status='draft';r.published_at=null;
 }else throw new Error('Unknown report action.');
 r.revision++;r.updated_by=user.id;r.updated_at=now;
 svc.data.officeReportHistory.push({id:uid(),report_id:r.id,actor_id:user.id,action,old_record:old,new_record:structuredClone(r),reason:reason||'Draft created',created_at:now});
 return reportProjection(svc,r);
}
export function accountabilityOverview(svc,{from=dayISO().slice(0,7)+'-01',to=dayISO()}={}){
 requireExecutive(svc);
 if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>366*86400000)throw new Error('Choose an ordered date range of up to one year.');
 const d=svc.data,expenses=d.expenses.filter(e=>e.expense_date>=from&&e.expense_date<=to);
 const expenseTotal=state=>expenses.filter(e=>e.status===state).reduce((n,e)=>n+Number(e.amount_kobo),0);
 return {from,to,totals:{receipts_kobo:d.payments.filter(p=>p.payment_date>=from&&p.payment_date<=to).reduce((n,p)=>n+netPayment(p,d.adjustments),0),approved_expenses_kobo:expenseTotal('approved'),pending_expenses_kobo:expenseTotal('pending'),reversed_expenses_kobo:expenseTotal('reversed')},expenses:expenses.slice().sort((a,b)=>b.expense_date.localeCompare(a.expense_date)).slice(0,50).map(e=>({id:e.id,expense_date:e.expense_date,description:e.overview_summary||'Expense recorded',amount_kobo:e.amount_kobo,status:e.status,responsible_officer_name:d.accounts.find(a=>a.id===e.recorded_by)?.display_name||'Executive',collection_title:d.collections.find(c=>c.id===e.collection_id)?.title||'Association fund'})),reports:officeReportList(svc).filter(r=>r.status==='published'&&r.report_date>=from&&r.report_date<=to).slice(0,50)};
}
export function collectionSummaries(svc){requireExecutive(svc,'finance.read');return svc.data.collections.map(c=>({id:c.id,...collectionTotals(svc.data,c)}));}
export function monthlySchedule(svc,{year,memberId=null}={}){
 requireExecutive(svc,'finance.read');year=Number(year);
 if(!Number.isInteger(year)||year<1900||year>2100)throw new Error('Choose a year between 1900 and 2100.');
 if(memberId&&!svc.data.members.some(m=>m.id===memberId&&!m.archived_at&&!m.merged_into_member_id))throw new Error('Choose an available member.');
 const d=svc.data,credit=memberId?d.payments.filter(p=>p.member_id===memberId&&p.status==='confirmed').reduce((n,p)=>n+netPayment(p,d.adjustments)-d.allocations.filter(a=>a.payment_id===p.id).reduce((n,a)=>n+Number(a.amount_kobo),0),0):0;
 return {year,member_id:memberId,credit_kobo:credit,months:Array.from({length:12},(_,i)=>{
  const period=year+'-'+String(i+1).padStart(2,'0');
  return {period,collections:d.collections.filter(c=>c.category==='monthly'&&c.period===period).map(c=>{
   const totals=collectionTotals(d,c),a=memberId?d.assessments.find(a=>a.collection_id===c.id&&a.member_id===memberId&&!a.superseded_by):null;
   return {id:c.id,title:c.title,status:c.status,participation:c.participation,amount_kobo:c.amount_kobo,deadline:c.deadline||null,received_kobo:totals.received,spending_kobo:totals.spending,expected_kobo:totals.expected,outstanding_kobo:totals.outstanding,assessment_count:d.assessments.filter(a=>a.collection_id===c.id&&!a.superseded_by).length,member_expected_kobo:a?.expected_kobo??null,member_waiver_kobo:a?.waiver_kobo??null,member_paid_kobo:memberId?paidFor(d,memberId,c.id):null,member_assessed:!!a};
  })};
 })};
}
