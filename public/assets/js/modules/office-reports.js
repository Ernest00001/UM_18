import {EXECUTIVE_OFFICES,officeLabels,officeWorkspaces} from '../executive-offices.js';
import {dayISO} from '../domain.js';
import {icon} from '../icons.js';
import {esc,date,status,dialog,input,select,textarea,required,empty} from '../ui.js';

export const OFFICE_REPORT_TYPES=[['report','Office report'],['minutes','Meeting minutes'],['board_decision','Board decision']];
const typeLabel=code=>OFFICE_REPORT_TYPES.find(([value])=>value===code)?.[1]||code;
const officeLabel=code=>officeLabels([code]).join(', ')||code||'Office not recorded';

export function reportOfficeCodes(ctx){
 if(!ctx.can('office_reports.write'))return [];
 if(ctx.can('accounts.write'))return EXECUTIVE_OFFICES.map(office=>office.code);
 const codes=new Set([...(ctx.user.office_codes||[]),...officeWorkspaces(ctx.user.office_codes).flatMap(workspace=>workspace.office_codes)]);
 return EXECUTIVE_OFFICES.filter(office=>codes.has(office.code)).map(office=>office.code);
}

export function officeReportSummary(report){
 return `<div class="office-report-labels"><span class="tag">${esc(officeLabel(report.office_code))}</span><span class="tag">${esc(typeLabel(report.report_type))}</span>${status(report.status)}</div><h3>${esc(report.title)}</h3><p class="office-report-summary">${esc(report.summary||'No summary supplied.')}</p><p class="office-report-meta">${esc(report.author_name||'Author not recorded')} · ${esc(date(report.report_date))} · Revision ${esc(report.revision||1)}${report.published_at?' · Published '+esc(date(report.published_at)):''}</p>`;
}

const canManage=(ctx,report)=>report.can_edit===true&&reportOfficeCodes(ctx).includes(report.office_code);

function editOfficeReport(ctx,report={}){
 const offices=reportOfficeCodes(ctx);
 if(!offices.length||report.id&&(!canManage(ctx,report)||report.status!=='draft'))return;
 const options=EXECUTIVE_OFFICES.filter(office=>offices.includes(office.code)).map(office=>[office.code,office.label]);
 const selectedOffice=report.office_code||(ctx.user.office_codes||[]).find(code=>offices.includes(code))||options[0][0];
 const el=dialog(report.id?'Revise office report draft':'Write an office report draft',`<p class="note">Reports, meeting minutes and board decisions are shared with executives when published. Office holders and assistants work on their team's drafts. Publication here does not update the public website.</p><div class="grid">${select('office_code','Reporting office',options,selectedOffice,{required:true,full:true})}${select('report_type','Record type',OFFICE_REPORT_TYPES,report.report_type||'report',{required:true})}${input('report_date','Report or meeting date',report.report_date||dayISO(),{type:'date',required:true})}${input('title','Title',report.title||'',{required:true,full:true})}${textarea('summary','Report, minutes or decision summary',report.summary||'',{required:true,rows:7})}${report.id?textarea('reason','Revision reason','',{required:true}):''}</div>`,{wide:true,submitLabel:report.id?'Save revised draft':'Save draft',onSubmit:async form=>{
  const payload=required(form);
  if(report.id)payload.office_code=report.office_code;
  if(!reportOfficeCodes(ctx).includes(payload.office_code))throw new Error('Choose an office within your current report permissions.');
  if(report.id){payload.id=report.id;payload.expected_revision=report.revision||1;}else payload.id=null;
  await ctx.act('save_office_report',payload);await ctx.refresh();
 }});
 el.querySelector('[name=summary]').setAttribute('maxlength','6000');
 if(report.id)el.querySelector('[name=office_code]').disabled=true;
}

function changeReportPublication(ctx,report,publish){
 if(!canManage(ctx,report))return;
 dialog(publish?'Publish to the executive workspace':'Withdraw report to draft',`<p class="note">${esc(report.title)} · Revision ${esc(report.revision||1)}. ${publish?'All signed-in executives will be able to read this report.':'The report will return to the team draft area so it can be revised and republished. Its revision and publication history are preserved.'}</p>${textarea('reason',publish?'Publication approval reason':'Withdrawal and revision reason','',{required:true})}`,{submitLabel:publish?'Publish report':'Withdraw to draft',onSubmit:async form=>{
  await ctx.act(publish?'publish_office_report':'withdraw_office_report',{id:report.id,expected_revision:report.revision||1,...required(form)});await ctx.refresh();
 }});
}

function viewOfficeReport(report){
 dialog(typeLabel(report.report_type),`<article class="office-report-detail">${officeReportSummary(report)}</article>`,{wide:true});
}

export async function renderOfficeReports(ctx){
 const offices=reportOfficeCodes(ctx);
 ctx.container.innerHTML=`<div class="page-heading"><div><h1>Office reports & decisions</h1><p>Shared office reports, meeting minutes and board decisions for executive accountability.</p></div>${offices.length?`<button type="button" class="btn primary" id="new-office-report">${icon('plus',16)} Write report</button>`:''}</div><p class="action-note">Published summaries are visible to all executives. Drafts stay with the responsible office and its assistant. Records published here remain internal.</p><div id="office-report-content"><p class="scope-help" role="status">Loading permitted office reports…</p></div>`;
 document.querySelector('#new-office-report')?.addEventListener('click',()=>editOfficeReport(ctx));
 try{
  const response=await ctx.svc.officeReports(),reports=(Array.isArray(response)?response:response.reports||[]).filter(report=>report.status==='published'||report.status==='draft'&&canManage(ctx,report));
  const holder=document.querySelector('#office-report-content');
  holder.innerHTML=`<div class="toolbar office-report-filters"><label class="search">${icon('search',16)}<input type="search" id="office-report-search" placeholder="Search reports and authors" aria-label="Search office reports"></label>${select('office_filter','Office',[['','All offices'],...EXECUTIVE_OFFICES.map(office=>[office.code,office.label])])}${select('type_filter','Record type',[['','All record types'],...OFFICE_REPORT_TYPES])}${select('status_filter','Publication',[['','All permitted records'],['published','Published'],['draft','Team drafts']])}</div><div id="office-report-list" class="office-report-grid"></div>`;
  const draw=()=>{
   const query=holder.querySelector('#office-report-search').value.toLowerCase(),office=holder.querySelector('[name=office_filter]').value,type=holder.querySelector('[name=type_filter]').value,publication=holder.querySelector('[name=status_filter]').value;
   const visible=reports.filter(report=>(!office||report.office_code===office)&&(!type||report.report_type===type)&&(!publication||report.status===publication)&&[report.title,report.summary,report.author_name,officeLabel(report.office_code)].join(' ').toLowerCase().includes(query)).sort((a,b)=>(b.report_date||'').localeCompare(a.report_date||''));
   holder.querySelector('#office-report-list').innerHTML=visible.length?visible.map(report=>`<article class="office-report-card" data-office-report="${esc(report.id)}">${officeReportSummary(report)}<div class="actions"><button type="button" class="btn secondary small" data-view-office-report="${esc(report.id)}">Read summary</button>${canManage(ctx,report)?report.status==='draft'?`<button type="button" class="btn secondary small" data-edit-office-report="${esc(report.id)}">Revise draft</button><button type="button" class="btn primary small" data-publish-office-report="${esc(report.id)}">Publish</button>`:`<button type="button" class="btn secondary small" data-withdraw-office-report="${esc(report.id)}">Withdraw to revise</button>`:''}</div></article>`).join(''):empty('No office reports in this view','Published reports and permitted team drafts will appear here.');
   holder.querySelectorAll('[data-view-office-report]').forEach(button=>button.onclick=()=>viewOfficeReport(reports.find(report=>report.id===button.dataset.viewOfficeReport)));
   holder.querySelectorAll('[data-edit-office-report]').forEach(button=>button.onclick=()=>editOfficeReport(ctx,reports.find(report=>report.id===button.dataset.editOfficeReport)));
   holder.querySelectorAll('[data-publish-office-report]').forEach(button=>button.onclick=()=>changeReportPublication(ctx,reports.find(report=>report.id===button.dataset.publishOfficeReport),true));
   holder.querySelectorAll('[data-withdraw-office-report]').forEach(button=>button.onclick=()=>changeReportPublication(ctx,reports.find(report=>report.id===button.dataset.withdrawOfficeReport),false));
  };
  holder.querySelector('#office-report-search').oninput=draw;holder.querySelectorAll('select').forEach(control=>control.onchange=draw);draw();
  if(ctx.detailId){const report=reports.find(record=>record.id===ctx.detailId);if(report)viewOfficeReport(report);else{const unavailable=document.createElement('p');unavailable.className='form-error';unavailable.setAttribute('role','alert');unavailable.textContent='This office report is unavailable with your current access. Choose a report from the permitted list.';holder.prepend(unavailable);}}
 }catch(error){document.querySelector('#office-report-content').innerHTML=`<div class="error-panel"><p role="alert">${esc(error.message)}</p><button type="button" class="btn secondary" id="retry-office-reports">Retry reports</button></div>`;document.querySelector('#retry-office-reports').onclick=()=>renderOfficeReports(ctx);}
}
