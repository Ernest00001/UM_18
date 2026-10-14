import {esc,date,empty} from './ui.js';
import {safeUrl} from './domain.js';
import {icon} from './icons.js';

export function eventMediaUrl(value){
 const source=String(value||'').trim(),origin=globalThis.location?.origin;
 if(source.startsWith('/api/')&&origin){try{const url=new URL(source,origin);return ['http:','https:'].includes(url.protocol)&&url.origin===origin?url.href:null;}catch{return null;}}
 if(source.startsWith('blob:')&&origin){try{const url=new URL(source);return url.origin===origin?url.href:null;}catch{return null;}}
 return safeUrl(source);
}

const mediaImage=(media,{banner=false}={})=>{
 const url=eventMediaUrl(media.url);
 if(!url)return '';
 return `<figure class="event-image ${banner?'event-poster':''}" data-public-media="${esc(media.id)}"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" alt="${esc(media.alt_text||media.caption||(media.kind==='poster'?'Event poster':'Event photo'))}" loading="lazy"></a>${media.caption?`<figcaption>${esc(media.caption)}</figcaption>`:''}</figure>`;
};

export function renderUpcomingEvents(holder,events,{compact=false}={}){
 const upcoming=(events||[]).filter(event=>event.status==='upcoming'&&event.is_public!==false),heading=compact?'upcoming-banner-heading':'upcoming-events-heading';
 if(compact&&!upcoming.length){holder.innerHTML='';return;}
 holder.innerHTML=`<section class="upcoming-events ${compact?'compact':''}" aria-labelledby="${heading}"><div class="section-heading"><div><span class="eyebrow">OUR NEXT GATHERING</span><h2 id="${heading}">Upcoming events</h2></div>${compact?`<a class="btn link small" href="/events/">View events ${icon('arrow',15)}</a>`:''}</div>${upcoming.length?`<div class="public-event-grid">${(compact?upcoming.slice(0,3):upcoming).map(event=>{
  const poster=(event.media||[]).find(media=>media.kind==='poster'&&media.is_banner&&!media.archived_at&&eventMediaUrl(media.url));
  return `<article class="public-event-card" data-public-event="${esc(event.id)}">${poster?mediaImage(poster,{banner:true}):''}<div class="event-copy"><span class="eyebrow">${esc(date(event.event_date))}</span><h3>${esc(event.title)}</h3>${event.public_location?`<p class="event-location">${icon('location',15)} ${esc(event.public_location)}</p>`:''}${event.public_description?`<p class="event-description">${esc(event.public_description)}</p>`:''}</div></article>`;
 }).join('')}</div>`:empty('No upcoming events announced','New event details and posters will appear here when published.')}</section>`;
}

export function renderEventGallery(holder,events){
 const closed=(events||[]).filter(event=>event.status==='closed'&&event.is_public!==false);
 const sections=[['poster','Posters'],['photo','Photos']].map(([kind,label])=>{
  const groups=closed.map(event=>({...event,media:(event.media||[]).filter(media=>media.kind===kind&&!media.archived_at&&(media.is_banner||media.show_in_gallery!==false)&&eventMediaUrl(media.url))})).filter(event=>event.media.length);
  return `<section class="gallery-section" data-gallery-kind="${kind}"><div class="section-heading"><h2>${label}</h2></div>${groups.length?groups.map(event=>`<article class="event-gallery-group" data-gallery-event="${esc(event.id)}"><div class="gallery-event-heading"><h3>${esc(event.title)}</h3><p>${esc(date(event.event_date))}${event.public_location?' · '+esc(event.public_location):''}</p></div><div class="gallery-grid">${event.media.map(media=>mediaImage(media,{banner:kind==='poster'})).join('')}</div></article>`).join(''):empty(`No ${label.toLowerCase()} published yet`,'Published media from completed events will appear here.')}</section>`;
 }).join('');
 holder.innerHTML=`<div class="public-event-heading"><span class="eyebrow">OUR SHARED MEMORIES</span><h1>Community gallery</h1><p>Posters and photographs from completed association events.</p></div>${sections}`;
}

export async function mountUpcomingEvents(holder,{getService,compact=false}={}){
 holder.innerHTML='<p class="public-event-loading" role="status">Loading upcoming events…</p>';
 try{const response=await (await getService()).publicEvents('upcoming');renderUpcomingEvents(holder,response.events,{compact});return response.events;}
 catch(error){holder.innerHTML=`<div class="event-feed-error"><p role="status">Event announcements are currently unavailable.</p><button class="btn secondary small" type="button" data-retry-events>Try again</button></div>`;holder.querySelector('[data-retry-events]').onclick=()=>mountUpcomingEvents(holder,{getService,compact});return null;}
}

export async function mountEventGallery(holder,{getService}={}){
 holder.innerHTML='<p class="public-event-loading" role="status">Loading the community gallery…</p>';
 try{const response=await (await getService()).publicEvents('gallery');renderEventGallery(holder,response.events);}
 catch(error){holder.innerHTML=`<div class="public-event-heading"><h1>Community gallery</h1><p role="status">The gallery is currently unavailable.</p><button class="btn secondary" type="button" data-retry-gallery>Try again</button></div>`;holder.querySelector('[data-retry-gallery]').onclick=()=>mountEventGallery(holder,{getService});}
}
