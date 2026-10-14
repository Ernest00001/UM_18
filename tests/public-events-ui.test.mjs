import test from 'node:test';
import assert from 'node:assert/strict';
import {eventMediaUrl,renderUpcomingEvents,renderEventGallery,mountUpcomingEvents,mountEventGallery} from '../public/assets/js/public-events.js';
import {renderEvents,mountEventMedia} from '../public/assets/js/modules/operations.js';
import {setup} from './dom-harness.mjs';

const event=()=>({id:'30000000-0000-4000-8000-000000000001',title:'Community gathering',event_date:'2026-11-21',status:'upcoming',is_public:true,location:'PRIVATE COORDINATION LOCATION',description:'PRIVATE COORDINATION NOTES',public_location:'Community hall',public_description:'Join the association gathering.',collection_id:null,media:[]});
const image=(changes={})=>({id:'40000000-0000-4000-8000-000000000001',kind:'poster',caption:'Event announcement',alt_text:'Maroon gathering poster',is_banner:true,show_in_gallery:true,url:'https://media.example/poster.webp',archived_at:null,...changes});
const submit=async form=>{await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(form.querySelector('.form-error').textContent,'');};

test('event image URLs support public API paths and same-origin local previews while rejecting unsafe protocols',()=>{
 const {cleanup}=setup();
 try{
  assert.equal(eventMediaUrl('/api/events?media=approved-image'),'https://fictional.example/api/events?media=approved-image');
  assert.equal(eventMediaUrl('blob:https://fictional.example/local-image'),'blob:https://fictional.example/local-image');
  for(const url of ['blob:https://other.example/image','javascript:alert(1)','data:text/html,<script>bad()</script>','/private-document.pdf','../private-document.pdf'])assert.equal(eventMediaUrl(url),null);
 }finally{cleanup();}
});

test('upcoming event announcements render only banner posters and public copy with safe escaping',()=>{
 const {ctx,cleanup}=setup();
 try{
  const upcoming={...event(),title:'Gathering <script>alert(1)</script>',public_description:'Bring <b>friends</b>',media:[image({alt_text:'Poster " onerror="alert(1)'}),image({id:'photo',kind:'photo',is_banner:false,url:'https://media.example/photo.jpg'})]};
  renderUpcomingEvents(ctx.container,[upcoming,{...event(),id:'closed',status:'closed',media:[image()]}]);
  assert.equal(ctx.container.querySelectorAll('[data-public-event]').length,1);
  assert.equal(ctx.container.querySelectorAll('img').length,1);
  assert.equal(ctx.container.querySelector('script'),null);assert.equal(ctx.container.querySelector('b'),null);
  assert.ok(ctx.container.textContent.includes(upcoming.title));assert.ok(ctx.container.textContent.includes(upcoming.public_description));
  assert.equal(ctx.container.querySelector('img').getAttribute('alt'),upcoming.media[0].alt_text);
  assert.equal(ctx.container.querySelector('img').getAttribute('onerror'),null);
  assert.ok(!ctx.container.textContent.includes('PRIVATE COORDINATION'));
  renderUpcomingEvents(ctx.container,[{...upcoming,media:[image({url:'javascript:alert(1)'})]}]);
  assert.equal(ctx.container.querySelector('img'),null,'Unsafe media URLs must not become image sources.');
  assert.ok(ctx.container.querySelector('[data-public-event]'),'An event without a poster still has real announcement details.');
 }finally{cleanup();}
});

test('gallery separates posters and photos for closed events without fabricating empty media',()=>{
 const {ctx,cleanup}=setup();
 try{
  const closed={...event(),status:'closed',title:'Completed <meeting>',media:[image(),image({id:'photo',kind:'photo',is_banner:false,caption:'Members <together>',url:'https://media.example/photo.jpg'})]};
  closed.media.push(image({id:'archived',archived_at:'2026-10-14T12:00:00Z'}),image({id:'unselected-photo',kind:'photo',is_banner:false,show_in_gallery:false}));
  renderEventGallery(ctx.container,[closed,{...event(),id:'future',media:[image({id:'future-poster'})]},{...closed,id:'private',is_public:false}]);
  const posters=ctx.container.querySelector('[data-gallery-kind=poster]'),photos=ctx.container.querySelector('[data-gallery-kind=photo]');
  assert.equal(posters.querySelectorAll('img').length,1);assert.equal(photos.querySelectorAll('img').length,1);
  assert.equal(ctx.container.querySelector('[data-gallery-event=future]'),null);
  assert.equal(ctx.container.querySelector('[data-gallery-event=private]'),null);
  assert.ok(photos.textContent.includes('Members <together>'));assert.equal(photos.querySelector('together'),null);
  renderEventGallery(ctx.container,[]);assert.equal(ctx.container.querySelector('img'),null);
  assert.ok(ctx.container.textContent.includes('No posters published yet'));assert.ok(ctx.container.textContent.includes('No photos published yet'));
  renderUpcomingEvents(ctx.container,[],{compact:true});assert.equal(ctx.container.innerHTML,'','The homepage should not display an empty announcement banner.');
  renderUpcomingEvents(ctx.container,[]);assert.ok(ctx.container.textContent.includes('No upcoming events announced'));
 }finally{cleanup();}
});

test('public feeds recover from request failures and request only the intended event view',async()=>{
 const {ctx,cleanup}=setup();let fail=true;const calls=[];
 const getService=async()=>({publicEvents:async view=>{calls.push(view);if(fail)throw new Error('private backend details');return {events:[{...event(),status:view==='gallery'?'closed':'upcoming',media:[image()]}]};}});
 try{
  assert.equal(await mountUpcomingEvents(ctx.container,{getService,compact:true}),null);
  assert.ok(!ctx.container.textContent.includes('private backend details'));
  fail=false;await ctx.container.querySelector('[data-retry-events]').onclick();
  assert.ok(ctx.container.querySelector('[data-public-event]'));
  await mountEventGallery(ctx.container,{getService});assert.ok(ctx.container.querySelector('[data-gallery-event]'));
  assert.deepEqual(calls,['upcoming','upcoming','gallery']);
 }finally{cleanup();}
});

test('event creation keeps public copy separate and publication is an explicit checkbox value',async()=>{
 const {ctx,cleanup}=setup();let action,payload;
 try{
  ctx.act=async(name,data)=>{action=name;payload=data;};await renderEvents(ctx);document.querySelector('#new-event').click();
  const form=document.querySelector('dialog form');
  assert.equal(form.querySelector('[name=is_public]').checked,true);
  for(const [name,value] of Object.entries({title:'New gathering',event_date:'2026-11-21',location:'Private directions',description:'Internal planning',public_location:'Public hall',public_description:'Public invitation'}))form.querySelector(`[name=${name}]`).value=value;
  form.querySelector('[name=is_public]').checked=false;await submit(form);
  assert.equal(action,'save_event');assert.equal(payload.is_public,false);
  assert.equal(payload.location,'Private directions');assert.equal(payload.public_location,'Public hall');
  assert.equal(payload.description,'Internal planning');assert.equal(payload.public_description,'Public invitation');
 }finally{cleanup();}
});

test('event manager can unpublish and close events while read-only executives receive no lifecycle controls',async()=>{
 const {ctx,cleanup}=setup(),record=event();let action,payload;
 try{
  ctx.data.events=[record];ctx.detailId=record.id;ctx.svc.eventMedia=async()=>[];ctx.act=async(name,data)=>{action=name;payload=data;};
  await renderEvents(ctx);assert.ok(document.querySelector('#event-publication'));assert.ok(document.querySelector('#upload-event-media'));
  assert.ok(ctx.container.textContent.includes('Private event documents & meeting notes'));
  document.querySelector('#toggle-event-publication').click();let form=document.querySelector('dialog form');form.querySelector('[name=reason]').value='Remove outdated announcement';await submit(form);
  assert.equal(action,'set_event_publication');assert.equal(payload.is_public,false);assert.equal(payload.id,record.id);
  assert.equal(payload.location,undefined);assert.equal(payload.description,undefined);
  document.querySelector('#close-event').click();form=document.querySelector('dialog form');form.querySelector('[name=reason]').value='Gathering completed';await submit(form);
  assert.equal(action,'close_event');assert.equal(payload.reason,'Gathering completed');assert.equal(payload.id,record.id);
  record.status='closed';await renderEvents(ctx);assert.equal(document.querySelector('#close-event'),null);
  ctx.can=permission=>permission==='directory.read';await renderEvents(ctx);
  for(const selector of ['#close-event','#toggle-event-publication','#upload-event-media','#edit-event'])assert.equal(document.querySelector(selector),null);
 }finally{cleanup();}
});

test('photo uploads cannot act as banners and retain the chosen gallery publication',async()=>{
 const {ctx,cleanup}=setup();let uploaded,metadata;const priorTimeout=globalThis.setTimeout;
 try{
  globalThis.setTimeout=()=>0;ctx.svc.eventMedia=async()=>[];ctx.svc.uploadEventMedia=async(file,data)=>{uploaded=file;metadata=data;};
  await mountEventMedia(ctx.container,ctx,event());document.querySelector('#upload-event-media').click();const form=document.querySelector('dialog form');
  form.querySelector('[name=kind]').value='photo';form.querySelector('[name=kind]').dispatchEvent(new window.Event('change'));
  assert.equal(form.querySelector('[name=is_banner]').disabled,true);assert.equal(form.querySelector('[name=is_banner]').checked,false);
  form.querySelector('[name=alt_text]').value='Members gathered at the community hall';form.querySelector('[name=caption]').value='Our completed gathering';form.querySelector('[name=show_in_gallery]').checked=true;
  const file={name:'gathering.jpg',type:'image/jpeg',size:150000};Object.defineProperty(form.querySelector('[name=file]'),'files',{value:[file]});
  await submit(form);assert.equal(uploaded,file);assert.equal(metadata.kind,'photo');assert.equal(metadata.is_banner,false);assert.equal(metadata.show_in_gallery,true);assert.equal(metadata.event_id,event().id);
 }finally{globalThis.setTimeout=priorTimeout;cleanup();}
});

test('event media can be archived and restored with an audited reason and escaped previews',async()=>{
 const {ctx,cleanup}=setup();let action,payload;const media=image({caption:'Poster <script>bad()</script>',alt_text:'Poster " description'});
 try{
  ctx.svc.eventMedia=async()=>[media];ctx.svc.eventMediaPreview=async()=>media.url;ctx.act=async(name,data)=>{action=name;payload=data;};
  await mountEventMedia(ctx.container,ctx,event());assert.equal(ctx.container.querySelector('script'),null);assert.equal(ctx.container.querySelector('img').getAttribute('alt'),media.alt_text);
  document.querySelector('[data-archive-event-media]').click();let form=document.querySelector('dialog form');form.querySelector('[name=reason]').value='Image withdrawn';await submit(form);
  assert.equal(action,'update_event_media');assert.equal(payload.archive,true);assert.equal(payload.reason,'Image withdrawn');
  media.archived_at='2026-10-14T12:00:00Z';await mountEventMedia(ctx.container,ctx,event());document.querySelector('[data-archive-event-media]').click();form=document.querySelector('dialog form');form.querySelector('[name=reason]').value='Image approved again';await submit(form);assert.equal(payload.archive,false);
  document.querySelector('[data-edit-event-media]').click();form=document.querySelector('dialog form');form.querySelector('[name=reason]').value='Update public caption';form.querySelector('[name=show_in_gallery]').checked=false;await submit(form);
  assert.equal(payload.show_in_gallery,false);assert.equal(payload.is_banner,true);
 }finally{cleanup();}
});
