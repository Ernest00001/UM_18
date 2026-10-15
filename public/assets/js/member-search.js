import {esc,toast} from './ui.js';
import {fullMembershipRegister} from './membership-register.js';

// Bulk assessment/import workflows deliberately request the whole roster when opened.
export async function withFullDirectory(ctx,work){
 try{if(!ctx.review&&!ctx.preview&&ctx.svc.searchMembers)ctx.data.members=await fullMembershipRegister(ctx.svc,ctx.data.members);return await work();}
 catch(error){if(error.name!=='AbortError')toast(error.message,true);}
}

export function mountMemberSearch(select,ctx){
 if(!ctx.svc.searchMembers||select.disabled||select.dataset.remoteMembers)return;
 select.dataset.remoteMembers='true';const data=ctx.data,page=ctx.page,current=()=>select.isConnected&&ctx.data===data&&ctx.page===page;
 const controls=document.createElement('div');controls.className='member-remote-search full';
 controls.innerHTML='<label class="field"><span>Find a member</span><input type="search" maxlength="180" placeholder="Search name, Member ID or phone" aria-label="Search member choices"></label><div class="actions"><button type="button" class="btn secondary small" data-find>Search members</button><button type="button" class="btn secondary small" data-prev disabled>Previous</button><button type="button" class="btn secondary small" data-next disabled>Next</button></div><p class="scope-help" role="status" data-status>Search to load member choices.</p>';
 select.closest('label').before(controls);
 const input=controls.querySelector('input'),previous=controls.querySelector('[data-prev]'),next=controls.querySelector('[data-next]'),find=controls.querySelector('[data-find]'),status=controls.querySelector('[data-status]');
 let offset=0,revision=0,timer,query='',count=0;
 const load=async()=>{
  if(!current())return;
  const version=++revision;previous.disabled=next.disabled=true;find.disabled=true;status.textContent='Finding members…';
  try{
   const activeOnly=['accounts','profile'].includes(page),result=await ctx.svc.searchMembers({query,offset,limit:20,...(activeOnly?{status:'active'}:{})});
   if(version!==revision||!current())return;
   if(!Array.isArray(result?.rows))throw new Error('Member choices could not be loaded.');count=Number(result.count)||0;
   const selected=select.value,selectedOption=[...select.options].find(option=>option.value===selected),rows=result.rows.filter(m=>!m.archived_at&&!m.merged_into_member_id&&(!activeOnly||m.membership_status==='active')&&(page!=='accounts'||m.email&&m.email!==ctx.brand?.contact_email));
   for(const member of rows){const existing=data.members.find(m=>m.id===member.id);if(!existing)data.members.push(member);}
   select.innerHTML='<option value="">Choose a member</option>'+(selected&&!rows.some(m=>m.id===selected)?`<option value="${esc(selected)}">${esc(selectedOption?.textContent||selected)}</option>`:'')+rows.map(m=>`<option value="${esc(m.id)}">${esc(m.member_no+' · '+m.full_name)}</option>`).join('');select.value=selected;
   status.textContent=count?`${offset+1}–${Math.min(offset+20,count)} of ${count} matching records. Select an eligible member below.`:'No matching members. Try another search.';
  }catch(error){if(version===revision&&current())status.textContent=error.message+' Use Search members to retry.';}
  finally{if(version===revision&&current()){find.disabled=false;previous.disabled=offset===0;next.disabled=offset+20>=count;}}
 };
 const search=()=>{clearTimeout(timer);query=input.value.trim();offset=0;return load();};
 find.onclick=search;input.oninput=()=>{clearTimeout(timer);timer=setTimeout(search,250);};input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();search();}};
 previous.onclick=()=>{if(!previous.disabled){offset=Math.max(0,offset-20);load();}};next.onclick=()=>{if(!next.disabled){offset+=20;load();}};
 return {search};
}

export function observeMemberSearch(ctx){
 const scan=()=>{if(ctx.review||ctx.preview||!ctx.data||!ctx.svc.searchMembers||ctx.page==='reports')return;document.querySelectorAll('select[name=member_id],select[name=link_member_id],select[data-member-target]').forEach(select=>mountMemberSearch(select,ctx));};
 const Observer=globalThis.MutationObserver||globalThis.window?.MutationObserver;
 if(Observer){const observer=new Observer(scan);observer.observe(document.body,{childList:true,subtree:true});return ()=>observer.disconnect();}
 return ()=>{};
}
