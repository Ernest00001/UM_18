import test from 'node:test';
import assert from 'node:assert/strict';
import {database,role,action,OWNER,READER} from './database-harness.mjs';

const feed=async(db,view='upcoming')=>(await db.query('select public.public_events($1) d',[view])).rows[0].d;
const mediaList=async(db,event)=>(await db.query('select public.event_media_list($1) d',[event])).rows[0].d;
const saveEvent=(db,extra={})=>action(db,'save_event',{title:'Public reunion announcement',event_date:'2099-10-20',location:'PRIVATE-INTERNAL-VENUE',description:'PRIVATE-PLANNING-NOTES',public_location:'Uyo, Nigeria',public_description:'Join the association reunion.',...extra});
const mediaMeta=(event,n,extra={})=>({event_id:event,path:OWNER+'/event/'+event+'/'+n.toString(16).padStart(64,'0')+'.png',mime_type:'image/png',byte_size:100,kind:'poster',caption:'Reunion poster',alt_text:'Announcement for the reunion',is_banner:true,show_in_gallery:false,...extra});
async function store(db,meta,key=crypto.randomUUID(),actor=OWNER){
 await db.exec('reset role');await db.query("insert into storage.objects(bucket_id,name) values('event-media',$1) on conflict do nothing",[meta.path]);await role(db,'service_role',null);
 try{return (await db.query('select public.commit_event_media($1,$2::jsonb,$3) d',[actor,JSON.stringify(meta),key])).rows[0].d;}finally{await role(db,'authenticated',OWNER);}
}

test('public event lifecycle exposes only approved announcements and gallery media',async t=>{
 const db=await database();t.after(()=>db.close());let event,banner,photo,hiddenPhoto;
 await t.test('existing event defaults remain private and new public copy never exposes planning data',async()=>{
  await db.exec('reset role');await db.query("insert into public.events(title,event_date,location,description) values('Existing private gathering','2099-10-21','PRIVATE-LEGACY-VENUE','PRIVATE-LEGACY-NOTES')");
  const bucket=(await db.query("select * from storage.buckets where id='event-media'")).rows[0];assert.equal(bucket.public,false);assert.equal(bucket.file_size_limit,3145728);assert.ok(!bucket.allowed_mime_types.includes('application/pdf'));
  await role(db,'authenticated',OWNER);
  event=await saveEvent(db);assert.equal(event.status,'upcoming');assert.equal(event.is_public,true);assert.equal(event.closed_at,null);
  await saveEvent(db,{title:'Private future meeting',is_public:false});
  await saveEvent(db,{title:'Past announcement not closed',event_date:'2020-01-01'});
  const noCopy=await saveEvent(db,{title:'Title and date only',public_location:undefined,public_description:undefined});
  const out=await feed(db);assert.equal(out.events.length,2);assert.deepEqual(out.events.find(e=>e.id===noCopy.id).media,[]);assert.equal(out.events.find(e=>e.id===noCopy.id).public_location,null);
  assert.ok(!JSON.stringify(out).includes('PRIVATE-'));assert.ok(out.events.every(e=>!('collection_id' in e)&&!('created_by' in e)&&!('location' in e)&&!('description' in e)));
  await role(db,'anon',null);assert.equal((await feed(db)).events.length,2);await assert.rejects(feed(db,'private'));
  await assert.rejects(db.query('select * from public.events'));await assert.rejects(db.query('select * from public.event_media'));await assert.rejects(db.query('select * from storage.objects'));await assert.rejects(db.query('select public.event_media_is_public($1)',[event.id]));
  await role(db,'authenticated',OWNER);
 });
 await t.test('private image uploads are scope-bound, idempotent and independent of confidential documents',async()=>{
  const meta=mediaMeta(event.id,1),key=crypto.randomUUID();banner=await store(db,meta,key);
  assert.equal((await store(db,meta,key)).id,banner.id);
  await assert.rejects(store(db,{...meta,caption:'Changed retry'},key),/Retry key reused/);
  await assert.rejects(store(db,{...meta,is_banner:false,show_in_gallery:true,caption:'Different publication choices'}),/already attached; update the existing media/);
  assert.equal((await mediaList(db,event.id)).find(m=>m.id===banner.id).is_banner,true);
  assert.equal((await mediaList(db,event.id)).find(m=>m.id===banner.id).caption,meta.caption);
  await action(db,'update_event_media',{id:banner.id,archive:true,reason:'Preserve the earlier poster as an archived image'});
  await assert.rejects(store(db,meta),/already attached; update the existing media/);
  assert.equal((await store(db,meta,key)).id,banner.id);
  assert.ok((await mediaList(db,event.id)).find(m=>m.id===banner.id).archived_at);
  await action(db,'update_event_media',{id:banner.id,archive:false,reason:'Explicitly restore the existing poster'});
  await assert.rejects(store(db,mediaMeta(event.id,2,{kind:'photo'})),/Only a poster/);
  await assert.rejects(store(db,mediaMeta(event.id,3,{path:READER+'/event/'+event.id+'/'+'a'.repeat(64)+'.png'})),/path does not match/);
  await assert.rejects(store(db,mediaMeta(event.id,4,{mime_type:'application/pdf'})),/permitted event/);
  await assert.rejects(db.query('select public.commit_event_media($1,$2::jsonb,$3)',[OWNER,JSON.stringify(meta),crypto.randomUUID()]),/permission denied/);
  const member=await action(db,'save_member',{full_name:'Private Event Attendee',phone_original:'08012345678',city:'Uyo',country:'Nigeria',skills:[],reason:'Approved fictional association member'});
  await action(db,'record_attendance',{event_id:event.id,rows:[{member_id:member.id,status:'present'}]});
  await db.exec('reset role');const privatePath=OWNER+'/event/'+event.id+'/confidential.pdf';await db.query("insert into storage.objects(bucket_id,name) values('private-documents',$1)",[privatePath]);await role(db,'authenticated',OWNER);
  await db.query('select public.commit_document_v2($1::jsonb)',[JSON.stringify({title:'PRIVATE-EVENT-MINUTES',scope:'event',target_id:event.id,path:privatePath,mime_type:'application/pdf',byte_size:100})]);
  photo=await store(db,mediaMeta(event.id,5,{kind:'photo',is_banner:false,show_in_gallery:true,caption:'Reunion participants',alt_text:'A group photo'}));
  hiddenPhoto=await store(db,mediaMeta(event.id,6,{kind:'photo',is_banner:false,caption:'PRIVATE-UNAPPROVED-PHOTO',alt_text:'Private draft image'}));
  const out=await feed(db);assert.deepEqual(out.events.find(e=>e.id===event.id).media.map(m=>m.id),[banner.id]);assert.ok(!JSON.stringify(out).includes('PRIVATE-'));assert.ok(!JSON.stringify(out).includes('object_path'));assert.ok(!JSON.stringify(out).includes('uploaded_by'));assert.ok(!JSON.stringify(out).includes(member.id));
  assert.deepEqual((await feed(db,'gallery')).events,[]);
 });
 await t.test('a current banner replaces its predecessor without stale upload retries restoring it',async()=>{
  const oldMeta=mediaMeta(event.id,7),oldKey=crypto.randomUUID(),old=await store(db,oldMeta,oldKey);banner=await store(db,mediaMeta(event.id,8));
  assert.equal((await store(db,oldMeta,oldKey)).id,old.id);
  assert.equal((await mediaList(db,event.id)).find(m=>m.id===old.id).is_banner,false);
  assert.deepEqual((await feed(db)).events.find(e=>e.id===event.id).media.map(m=>m.id),[banner.id]);
  assert.equal((await mediaList(db,event.id)).filter(m=>m.is_banner&&!m.archived_at).length,1);
 });
 await t.test('public image lookup rechecks visibility and authenticated previews remain scoped',async()=>{
  await role(db,'anon',null);await assert.rejects(db.query('select public.public_event_media($1)',[banner.id]),/permission denied/);await assert.rejects(db.query('select public.event_media_access($1)',[banner.id]),/permission denied/);await assert.rejects(db.query('select public.event_media_list($1)',[event.id]),/permission denied/);
  await role(db,'service_role',null);assert.equal((await db.query('select public.public_event_media($1) d',[banner.id])).rows[0].d.object_path,banner.object_path);await assert.rejects(db.query('select public.public_event_media($1)',[photo.id]),/unavailable/);await assert.rejects(db.query('select public.public_event_media($1)',[hiddenPhoto.id]),/unavailable/);
  await role(db,'authenticated',READER);assert.equal((await db.query('select public.event_media_access($1) d',[photo.id])).rows[0].d.id,photo.id);await assert.rejects(db.query("update public.event_media set show_in_gallery=true where id=$1",[hiddenPhoto.id]));
  const payload={id:READER,display_name:'Event manager',active:true,roles:['read_only'],permissions:[],office_codes:['community_event_manager'],reason:'Office title without access grant'};
  await assert.rejects(action(db,'close_event',{id:event.id,reason:'Office alone is insufficient'}));
  await role(db,'authenticated',OWNER);await action(db,'save_account',payload);await role(db,'authenticated',READER);await assert.rejects(action(db,'close_event',{id:event.id,reason:'Office alone is insufficient'}));
  await role(db,'authenticated',OWNER);await action(db,'save_account',{...payload,permissions:['events.write']});
 });
 await t.test('closing moves the poster and selected photos into the public gallery once without ledger changes',async()=>{
  const before=(await db.query('select public.workspace_data($1,$2) d',['reports',null])).rows[0].d;
  await role(db,'authenticated',READER);const key=crypto.randomUUID(),payload={id:event.id,reason:'Event finished and gallery publication reviewed'};
  const closed=await action(db,'close_event',payload,key);assert.equal(closed.status,'closed');assert.ok(closed.closed_at);assert.equal((await action(db,'close_event',payload,key)).closed_at,closed.closed_at);await assert.rejects(action(db,'close_event',payload),/Only an upcoming/);
  const gallery=await feed(db,'gallery');assert.deepEqual(gallery.events.find(e=>e.id===event.id).media.map(m=>m.id).toSorted(),[banner.id,photo.id].toSorted());assert.ok(!JSON.stringify(gallery).includes('PRIVATE-'));assert.ok(!(await feed(db)).events.some(e=>e.id===event.id));
  await assert.rejects(store(db,mediaMeta(event.id,5,{kind:'photo',is_banner:false,show_in_gallery:false,caption:'Reunion participants',alt_text:'A group photo'})),/already attached; update the existing media/);
  assert.ok((await feed(db,'gallery')).events.find(e=>e.id===event.id).media.some(m=>m.id===photo.id));
  await role(db,'service_role',null);assert.equal((await db.query('select public.public_event_media($1) d',[photo.id])).rows[0].d.id,photo.id);await assert.rejects(db.query('select public.public_event_media($1)',[hiddenPhoto.id]),/unavailable/);
  await role(db,'authenticated',OWNER);const after=(await db.query('select public.workspace_data($1,$2) d',['reports',null])).rows[0].d;for(const field of ['payments','allocations','expenses','assessments'])assert.deepEqual(after[field],before[field]);assert.equal(after.attendance.length,before.attendance.length);
 });
 await t.test('publication withdrawal, media archival and edits keep original receipts and newer decisions',async()=>{
  await role(db,'authenticated',READER);
  const key=crypto.randomUUID(),payload={id:photo.id,caption:'Reviewed gallery photo',alt_text:'The reunion group',show_in_gallery:true,reason:'Reviewed gallery caption'};
  const first=await action(db,'update_event_media',payload,key);assert.equal(first.caption,payload.caption);
  await action(db,'update_event_media',{...payload,caption:'Latest corrected caption'});assert.equal((await action(db,'update_event_media',payload,key)).caption,payload.caption);assert.equal((await mediaList(db,event.id)).find(m=>m.id===photo.id).caption,'Latest corrected caption');
  await action(db,'update_event_media',{id:photo.id,archive:true,reason:'Withdraw this photo from the gallery'});assert.ok(!(await feed(db,'gallery')).events.find(e=>e.id===event.id).media.some(m=>m.id===photo.id));
  await action(db,'update_event_media',{id:photo.id,archive:false,reason:'Restore the approved photo'});assert.ok((await feed(db,'gallery')).events.find(e=>e.id===event.id).media.some(m=>m.id===photo.id));
  await assert.rejects(action(db,'update_event_media',{id:photo.id,is_banner:true,reason:'Try a photo announcement banner'}),/Only a poster/);
  await action(db,'set_event_publication',{id:event.id,is_public:false,reason:'Withdraw event publication'});assert.ok(!(await feed(db,'gallery')).events.some(e=>e.id===event.id));
  await role(db,'service_role',null);await assert.rejects(db.query('select public.public_event_media($1)',[banner.id]),/unavailable/);
  await role(db,'authenticated',READER);await action(db,'set_event_publication',{id:event.id,is_public:true,public_description:'Reviewed public recap',reason:'Publish approved recap'});assert.equal((await feed(db,'gallery')).events.find(e=>e.id===event.id).public_description,'Reviewed public recap');
  await action(db,'update_event_media',{id:photo.id,archive:true,reason:'Archive photo for executive review'});
  await role(db,'authenticated',OWNER);await action(db,'save_account',{id:READER,display_name:'Event manager',active:true,roles:['read_only'],permissions:[],reason:'Revoke event editing access'});
  await role(db,'authenticated',READER);assert.ok(!(await mediaList(db,event.id)).some(m=>m.id===photo.id));await assert.rejects(db.query('select public.event_media_access($1)',[photo.id]),/unavailable/);await assert.rejects(action(db,'update_event_media',payload,key),/Access denied/);
  await role(db,'service_role',null);await assert.rejects(db.query('select public.commit_event_media($1,$2::jsonb,$3)',[READER,JSON.stringify(mediaMeta(event.id,9)),crypto.randomUUID()]),/upload denied/);
  await role(db,'authenticated',OWNER);const audit=(await db.query("select action from public.audit_events where target_id=$1 and action like 'event.%'",[event.id])).rows;assert.ok(audit.some(a=>a.action==='event.closed'));assert.ok(audit.some(a=>a.action==='event.media_updated'));assert.ok(audit.some(a=>a.action==='event.publication_changed'));
 });
});
