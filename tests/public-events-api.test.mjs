import test from 'node:test';
import assert from 'node:assert/strict';
import {eventsHandler} from '../api/events.js';
import {HttpError} from '../server/http.js';

const EVENT='30000000-0000-4000-8000-000000000001',MEDIA='40000000-0000-4000-8000-000000000001',ACTOR='10000000-0000-4000-8000-000000000001',KEY='50000000-0000-4000-8000-000000000001';
const environment=()=>({url:'https://fixture.supabase.co',key:'sb_publishable_fixture',origin:'https://association.example'});
const capture=()=>({headers:{},setHeader(key,value){this.headers[key]=value;},end(value){this.output=value||'';},payload(){return JSON.parse(this.output);}});
const upload=()=>({method:'POST',headers:{origin:'https://association.example','idempotency-key':KEY},body:{op:'upload',event_id:EVENT,kind:'poster',caption:'Association gathering',alt_text:'Gathering announcement poster',is_banner:true,show_in_gallery:true,mime:'image/png',name:'poster.png',base64:'aW1hZ2U='}});

function dependencies(changes={}){
 const calls=[],removed=[];
 const storage={upload:async()=>({error:null}),createSignedUrl:async()=>({data:{signedUrl:'https://fixture.supabase.co/signed-image'},error:null}),remove:async paths=>{removed.push(...paths);return {error:null};}};
 const admin={storage:{from:bucket=>{assert.equal(bucket,'event-media');return storage;}}};
 return {calls,removed,storage,values:{environment,createClient:()=>({public:true}),privileged:()=>admin,executive:async()=>({client:{executive:true},user:{id:ACTOR}}),validateFile:async()=>({bytes:Buffer.from('decoded image bytes'),mime:'image/png',extension:'png'}),rpc:async(client,name,args)=>{calls.push({client,name,args});if(name==='public_events')return {events:[]};if(['public_event_media','event_media_access'].includes(name))return {object_path:'private-path.png'};if(name==='commit_event_media')return {id:MEDIA};return [];},...changes}};
}

test('public event response contains approved copy and stable media URLs without private fields',async()=>{
 const deps=dependencies({rpc:async(client,name,args)=>{assert.equal(client.public,true);assert.equal(name,'public_events');assert.equal(args.p_view,'upcoming');return {events:[{id:EVENT,title:'Gathering',event_date:'2026-12-01',status:'upcoming',public_location:'Public hall',public_description:'Join us',location:'PRIVATE LOCATION',description:'PRIVATE NOTES',collection_id:'PRIVATE FUND',media:[{id:MEDIA,kind:'poster',caption:'Poster',alt_text:'Gathering poster',is_banner:true,object_path:'PRIVATE PATH',uploaded_by:'PRIVATE ACTOR'}]}]};}});
 const res=capture();await eventsHandler(deps.values)({method:'GET',url:'/api/events?view=upcoming',headers:{}},res);
 assert.equal(res.statusCode,200);assert.ok(!res.output.includes('PRIVATE'));
 assert.equal(res.payload().events[0].media[0].url,'/api/events?media='+MEDIA);
 assert.equal(res.headers['Cache-Control'],'no-store');
});

test('public media is reauthorised before redirect and withdrawn images return no signed URL',async()=>{
 let checks=0;const deps=dependencies({rpc:async(client,name)=>{assert.equal(name,'public_event_media');if(++checks===2)throw new HttpError(404,'Event image unavailable');return {object_path:'private-path.png'};}});
 const res=capture();await eventsHandler(deps.values)({method:'GET',url:'/api/events?media='+MEDIA,headers:{}},res);
 assert.equal(checks,2);assert.equal(res.statusCode,404);assert.equal(res.headers.Location,undefined);
 assert.ok(!res.output.includes('signed-image'));
});

test('public image redirects use short-lived storage links and no public bucket',async()=>{
 const deps=dependencies();let expiry;
 deps.storage.createSignedUrl=async(path,seconds)=>{expiry=seconds;return {data:{signedUrl:'https://fixture.supabase.co/signed-image'},error:null};};
 const res=capture();await eventsHandler(deps.values)({method:'GET',url:'/api/events?media='+MEDIA,headers:{}},res);
 assert.equal(res.statusCode,302);assert.equal(expiry,60);assert.equal(res.headers.Location,'https://fixture.supabase.co/signed-image');
 assert.equal(deps.calls.filter(call=>call.name==='public_event_media').length,2);
});

test('event uploads bind validated bytes to the authenticated actor and event',async()=>{
 const deps=dependencies();let uploaded;
 deps.storage.upload=async(path,bytes)=>{uploaded={path,bytes};return {error:null};};
 const res=capture();await eventsHandler(deps.values)(upload(),res);
 assert.equal(res.statusCode,200);assert.equal(res.payload().id,MEDIA);
 assert.ok(uploaded.path.startsWith(ACTOR+'/event/'+EVENT+'/'));
 const commit=deps.calls.find(call=>call.name==='commit_event_media');
 assert.equal(commit.args.p_actor,ACTOR);assert.equal(commit.args.p_key,KEY);
 assert.equal(commit.args.p_meta.path,uploaded.path);assert.equal(commit.args.p_meta.mime_type,'image/png');assert.equal(commit.args.p_meta.byte_size,uploaded.bytes.length);
 assert.equal(deps.removed.length,0);
});

test('revoked upload authority denies commit and retains private bytes for safe reconciliation',async()=>{
 let authority=0;const revoked=dependencies({executive:async()=>{if(++authority===2)throw new HttpError(403,'Event permission revoked');return {client:{},user:{id:ACTOR}};}});
 let res=capture();await eventsHandler(revoked.values)(upload(),res);
 assert.equal(res.statusCode,403);assert.equal(revoked.removed.length,0);assert.ok(!revoked.calls.some(call=>call.name==='commit_event_media'));
 const retry=dependencies({rpc:async(client,name)=>{if(name==='commit_event_media')throw new HttpError(409,'Changed retry');return [];}});
 retry.storage.upload=async()=>({error:{statusCode:409,message:'already exists'}});
 res=capture();await eventsHandler(retry.values)(upload(),res);
 assert.equal(res.statusCode,409);assert.equal(retry.removed.length,0);
});

test('a lost commit response never deletes bytes that may already be referenced',async()=>{
 const deps=dependencies({rpc:async(client,name)=>{if(name==='commit_event_media')throw new HttpError(503,'Commit response interrupted');return [];}});
 const res=capture();await eventsHandler(deps.values)(upload(),res);
 assert.equal(res.statusCode,503);assert.equal(deps.removed.length,0);
});

test('unsafe event upload options, cross-origin requests and oversized bodies fail before uploads',async()=>{
 const deps=dependencies();let writes=0;deps.storage.upload=async()=>{writes++;return {error:null};};
 for(const change of [{kind:'photo',is_banner:true},{mime:'application/pdf'},{alt_text:''},{event_id:'bad-id'}]){
  const req=upload();Object.assign(req.body,change);const res=capture();await eventsHandler(deps.values)(req,res);assert.equal(res.statusCode,422);
 }
 let req=upload();req.headers.origin='https://elsewhere.example';let res=capture();await eventsHandler(deps.values)(req,res);assert.equal(res.statusCode,403);
 req=upload();req.headers['content-length']='4500001';res=capture();await eventsHandler(deps.values)(req,res);assert.equal(res.statusCode,413);
 assert.equal(writes,0);
});
