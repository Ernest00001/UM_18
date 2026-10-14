import {service,branding,reviewMode,uiPreview} from './service.js';
import {icon} from './icons.js';
import {bindExecutiveDrawer,bindExecutiveFieldScrolling} from './responsive.js';
import {esc,initials,dialog,toast,empty} from './ui.js';
import {officeLabels,officeWorkspaces,ACCESS_ROLES} from './executive-offices.js';
import {renderAuth} from './modules/auth.js';
import {renderOverview} from './modules/overview.js';
import {renderOfficeReports} from './modules/office-reports.js';
import {renderMembers,renderRegistrations} from './modules/membership.js';
import {renderCollections} from './modules/collections.js';
import {renderPayments,renderExpenses} from './modules/finance.js';
import {renderEvents,renderWelfare,renderContacts,renderDocuments} from './modules/operations.js';
import {renderReports} from './modules/reports.js';
import {renderBranding,renderAccounts,renderAudit} from './modules/settings.js';
const pages=[
 ['overview','Overview','grid','directory.read','Workspace'],['office-reports','Office reports & minutes','file','directory.read'],['registrations','Pending registrations','inbox','registrations.review'],['members','Members','people','directory.read'],
 ['monthly','Monthly collections','calendar','finance.read','Finance'],['special','Special collections','layers','finance.read'],['payments','Payments & allocations','wallet','finance.read'],['expenses','Expenses','receipt','finance.read'],
 ['events','Events & attendance','calendar','directory.read','Community'],['welfare','Welfare','heart','welfare.read'],['contacts','Contact history','phone','contacts.read'],['documents','Documents','file','directory.read'],['reports','Reports','chart','directory.read'],
 ['branding','Branding & settings','settings','settings.write','Administration'],['accounts','Executive accounts','shield','accounts.write'],['audit','Audit history','history','audit.read']
];
const allowedPage=p=>ctx.can(p[3])||(p[0]==='welfare'&&ctx.can('welfare.assign'))||(p[0]==='contacts'&&ctx.can('contacts.write'));
const renders={overview:renderOverview,'office-reports':renderOfficeReports,registrations:renderRegistrations,members:renderMembers,monthly:c=>renderCollections(c,'monthly'),special:c=>renderCollections(c,'special'),payments:renderPayments,expenses:renderExpenses,events:renderEvents,welfare:renderWelfare,contacts:renderContacts,documents:renderDocuments,reports:renderReports,branding:renderBranding,accounts:renderAccounts,audit:renderAudit};
const root=document.querySelector('#app');let ctx,navigationRevision=0,drawerCleanup;
const loadingReady=root.querySelector('[data-app-loader]')?.minimumDisplayReady;
bindExecutiveFieldScrolling();
try{
 const svc=await service();const brand=await branding();const user=await svc.session();await loadingReady;ctx={svc,brand,user,data:null,review:reviewMode,preview:uiPreview,can:p=>ctx.user?.permissions?.includes(p),navigate:async(path)=>{history.pushState({},'',path);await route();},refresh:async()=>route(),act:async(action,payload,key)=>{let r;try{r=await svc.act(action,payload,key);}catch(error){if(error.code==='42501'){ctx.data=null;try{ctx.user=await svc.session();await route();}catch{ctx.user=null;await ctx.navigate('/admin/login/');}document.querySelectorAll('dialog').forEach(d=>d.close());}throw error;}toast(uiPreview?'Saved in the temporary UI preview.':reviewMode?'Fictional review record updated.':'Saved successfully.');return r;}};
 window.addEventListener('popstate',()=>route());document.addEventListener('click',e=>{const a=e.target.closest('a[data-route]');if(a&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey){e.preventDefault();ctx.navigate(a.getAttribute('href'));}});await route();if(svc.onSessionChange)svc.onSessionChange(async(event,session)=>{if(event==='SIGNED_OUT'||!session){ctx.user=null;ctx.data=null;await ctx.navigate('/admin/login/');}else if(ctx.user&&!ctx.user.needs_mfa){try{await ctx.refresh();}catch{ctx.user=null;ctx.data=null;await ctx.navigate('/admin/login/');}}});
}catch(e){await loadingReady;root.innerHTML=`<main id="main" class="public-content"><div class="error-panel"><span class="eyebrow">WORKSPACE UNAVAILABLE</span><h1>Setup is needed.</h1><p>${esc(e.message)}</p><a href="/" class="btn secondary">Return home</a><button class="btn primary" id="retry">Retry</button></div></main>`;document.querySelector('#retry').onclick=()=>location.reload();}
async function route(){
 const revision=++navigationRevision;
 document.querySelectorAll('dialog').forEach(dialog=>dialog.close());
 const previous=document.querySelector('#main');if(previous){previous.setAttribute('aria-busy','true');previous.inert=true;}
 try{await routeWorkspace(revision);}catch(error){
  if(revision!==navigationRevision)return;
  document.querySelector('#drawer-close')?.click();
  const holder=document.querySelector('#main')||root;holder.innerHTML=`<div class="error-panel"><h1>This workspace could not be loaded.</h1><p role="alert">${esc(error.message||'Check your connection and try again.')}</p><button class="btn secondary" id="route-retry" type="button">Retry page</button><a class="btn link" href="/">Public website</a></div>`;
  holder.inert=false;holder.removeAttribute('aria-busy');
  holder.querySelector('#route-retry').onclick=()=>route();
 }
}
async function routeWorkspace(revision){
 const path=location.pathname.split('/').filter(Boolean),params=new URLSearchParams(location.search),page=path[1]||'overview',detailId=params.get('id')||path[2]||null,target=detailId||params.get('replace')||null;
 ctx.page=page;ctx.detailId=detailId;
 const authenticated=async user=>{if(revision!==navigationRevision)return;ctx.user=user;await ctx.navigate('/admin/overview/');};
 const login=()=>{drawerCleanup?.();drawerCleanup=undefined;return renderAuth(root,pageContext(revision,root),authenticated);};
 if(!ctx.user||ctx.user.needs_mfa||page==='login')return login();
 let user;try{user=await ctx.svc.session();}catch{user=null;}
 if(revision!==navigationRevision)return;
 ctx.user=user;
 if(!user||user.needs_mfa){ctx.data=null;return login();}
 const data=await ctx.svc.load({area:page,target});if(revision!==navigationRevision)return;
 ctx.data=data;await renderPage(revision);
}
function pageContext(revision,container){
 const current=()=>revision===navigationRevision,obsolete=()=>Object.assign(new Error('This page has changed.'),{name:'AbortError'});
 const snapshot={page:ctx.page,detailId:ctx.detailId,data:ctx.data,user:ctx.user,container};
 const service=new Proxy(ctx.svc,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;return async(...args)=>{if(!current())throw obsolete();try{const result=await value.apply(target,args);if(!current())throw obsolete();return result;}catch(error){if(!current())throw obsolete();throw error;}};}});
 return new Proxy(ctx,{get(target,key){if(key==='svc')return service;if(key==='isCurrent')return current;if(key==='act')return async(...args)=>{if(!current())throw obsolete();const result=await target.act(...args);if(!current())throw obsolete();return result;};if(key==='refresh'||key==='navigate')return async(...args)=>{if(!current())throw obsolete();return target[key](...args);};return Object.hasOwn(snapshot,key)?snapshot[key]:Reflect.get(target,key);},set(target,key,value){if(current()){if(Object.hasOwn(snapshot,key))snapshot[key]=value;Reflect.set(target,key,value);}return true;}});
}
function logo(){return `<a class="logo" href="/admin/overview/" data-route>${ctx.brand.logo_url?`<img class="brand-img" src="${esc(ctx.brand.logo_url)}" alt="${esc(ctx.brand.short_name)}"><span class="logo-symbol hidden">18</span>`:'<span class="logo-symbol">18</span>'}<span class="logo-text">${esc(ctx.brand.short_name)}<small>ALUMNI WORKSPACE</small></span></a>`;}
function layout(){
 drawerCleanup?.();
 const workspaceNames=officeWorkspaces(ctx.user.office_codes).map(workspace=>workspace.label).join(', ');
 root.innerHTML=`<div class="app-shell"><aside class="sidebar" id="sidebar" aria-label="Executive navigation"><div class="sidebar-brand">${logo()}<button type="button" class="icon-button drawer-close" id="drawer-close" aria-label="Close navigation">${icon('close')}</button></div><nav class="sidebar-nav">${pages.filter(allowedPage).map(([id,label,i,permission,group])=>`${group?`<div class="nav-group-label">${group}</div>`:''}<a href="/admin/${id}/" data-route class="nav-item ${ctx.page===id?'active':''}" ${ctx.page===id?'aria-current="page"':''}>${icon(i,18)}<span>${label}</span>${id==='registrations'&&ctx.data.submissions.filter(s=>s.review_status==='pending').length?`<span class="badge">${ctx.data.submissions.filter(s=>s.review_status==='pending').length}</span>`:''}</a>`).join('')}</nav><div class="sidebar-bottom"><span>Set 2018</span><em>${esc(ctx.brand.slogan)}</em></div></aside><div class="drawer-overlay" id="drawer-overlay"></div><div class="workspace"><header class="topbar"><div class="topbar-search"><button class="icon-button mobile-menu" id="drawer-toggle" aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar">${icon('menu')}</button><span class="mobile-workspace-title">${esc(ctx.brand.short_name)}</span><span class="crumb">Workspace <span class="muted">/</span> <strong>${esc(pages.find(p=>p[0]===ctx.page)?.[1]||'Page')}</strong></span><form class="search" id="global-search">${icon('search',16)}<input type="search" placeholder="Find a member or page…" aria-label="Search workspace"><button class="workspace-search-submit" type="submit" aria-label="Search workspace">Search</button></form></div><div class="row">${ctx.can('registrations.review')?`<a href="/admin/registrations/" data-route class="icon-button" aria-label="Review pending registrations">${icon('inbox',19)}</a>`:''}<details class="account"><summary><span class="avatar">${esc(initials(ctx.user.display_name))}</span><span><strong>${esc(ctx.user.display_name||'Executive')}</strong><small>${ctx.review?'Fictional review account · ':''}${esc(officeLabels(ctx.user.office_codes).join(', ')||(ctx.user.roles||[]).map(code=>ACCESS_ROLES.find(([role])=>role===code)?.[1]||code).join(', ')||'Executive')}</small></span>${icon('down',14)}</summary><div class="account-dropdown">${workspaceNames?`<p class="small-text" data-shared-workspace style="padding:8px 10px;margin:0">${esc(workspaceNames)}<br><small class="muted">Shared office workspace</small></p>`:''}<a href="/">${icon('external',16)} Public website</a><button id="refresh-workspace">${icon('history',16)} Refresh records</button><button id="logout">${icon('logout',16)} Sign out</button></div></details></div></header>${ctx.review?`<div class="review-banner"><strong>Fictional review workspace</strong> · All people, collections, and amounts shown are examples. Changes reset on refresh.</div>`:''}<main class="main" id="main" tabindex="-1"></main><footer class="page-footer main"><span>© ${new Date().getFullYear()} ${esc(ctx.brand.organisation_name)} · Internal executive workspace</span><span>Times displayed in Africa/Lagos · <a href="/privacy/">Privacy</a></span></footer></div></div>`;
 root.querySelector('.brand-img')?.addEventListener('error',e=>{e.target.classList.add('hidden');e.target.nextElementSibling.classList.remove('hidden');});
 drawerCleanup=bindExecutiveDrawer({sidebar:document.querySelector('#sidebar'),toggle:document.querySelector('#drawer-toggle'),overlay:document.querySelector('#drawer-overlay'),closeButton:document.querySelector('#drawer-close')});
 document.querySelector('#logout').onclick=async()=>{await ctx.svc.logout();ctx.user=null;ctx.data=null;await ctx.navigate('/admin/login/');};document.querySelector('#refresh-workspace').onclick=async()=>{const revision=navigationRevision;try{const user=await ctx.svc.session();if(revision!==navigationRevision)return;ctx.user=user;if(!user||user.needs_mfa){ctx.data=null;return route();}await ctx.refresh();if(revision+1===navigationRevision)toast('Workspace refreshed.');}catch(e){if(revision!==navigationRevision)return;ctx.user=null;ctx.data=null;await ctx.navigate('/admin/login/');toast(e.message,true);}};
 document.querySelector('#global-search').onsubmit=e=>{e.preventDefault();const q=e.target.querySelector('input').value.trim().toLowerCase();const records=ctx.data.members.filter(m=>[m.full_name,m.member_no,m.phone_original,m.city,m.country,...(m.skills||[])].join(' ').toLowerCase().includes(q)).slice(0,12);const choices=pages.filter(p=>allowedPage(p)&&p[1].toLowerCase().includes(q));const el=dialog('Search workspace',`<div class="command-results">${records.map(m=>`<button type="button" data-member="${m.id}"><strong>${esc(m.full_name)}</strong> <small>${esc(m.member_no)} · ${esc(m.city)}</small></button>`).join('')}${choices.map(p=>`<button type="button" data-page="${p[0]}">${icon(p[2],16)} ${esc(p[1])}</button>`).join('')}${!records.length&&!choices.length?empty('No matches','Try a name, Member ID, skill, or page name.'):''}</div>`);el.querySelectorAll('[data-member]').forEach(b=>b.onclick=()=>{el.close();ctx.navigate('/admin/members/?id='+b.dataset.member);});el.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{el.close();ctx.navigate('/admin/'+b.dataset.page+'/');});};
}
async function renderPage(revision=navigationRevision){
 if(revision!==navigationRevision)return;
 layout();ctx.container=document.querySelector('#main');const p=pages.find(p=>p[0]===ctx.page);document.title=`${p?.[1]||'Page not found'} · ${ctx.brand.short_name}`;
 if(!p){ctx.container.innerHTML=`<div class="error-panel"><h1>Page not found</h1><a class="btn primary" data-route href="/admin/overview/">Go to overview</a></div>`;return;}
 if(!allowedPage(p)){ctx.container.innerHTML=`<div class="error-panel"><h1>Access restricted</h1><p>Your current account does not have permission to open this area.</p></div>`;return;}
 const view=pageContext(revision,ctx.container);
 try{await renders[ctx.page](view);}catch(e){if(revision!==navigationRevision)return;view.container.innerHTML=`<div class="error-panel"><h2>This page could not be loaded.</h2><p>${esc(e.message)}</p><button class="btn secondary" id="page-retry" type="button">Retry</button></div>`;document.querySelector('#page-retry').onclick=()=>ctx.refresh();}
}
