import test from 'node:test';import assert from 'node:assert/strict';import {documentsHandler} from '../api/documents.js';
const user='10000000-0000-4000-8000-000000000001';
const response=()=>({headers:{},setHeader(key,value){this.headers[key]=value;},end(value){this.result=JSON.parse(value);}});
for(const branding of [false,true])test((branding?'logo':'private document')+' survives a lost commit response and unchanged retry returns the saved reference',async()=>{
 const objects=new Map(),rows=new Map();let removals=0,lost=true,logo;
 const bucket={upload:async(path,bytes)=>{if(objects.has(path))return {error:{statusCode:409,message:'Already exists'}};objects.set(path,bytes);return {error:null};},remove:async paths=>{removals++;paths.forEach(path=>objects.delete(path));}};
 const client={rpc:async()=>({data:true,error:null}),auth:{getUser:async()=>({data:{user:{id:user}}})}};
 const handler=documentsHandler({environment:()=>({origin:'https://association.example'}),executive:async()=>({client}),privileged:()=>({storage:{from:()=>bucket}}),validateFile:async()=>({bytes:Buffer.from('isolated-test-image'),mime:'image/png',name:'evidence.png',extension:'png'}),rpc:async(_client,name,p)=>{
  if(name==='execute_action'){logo=p.p_payload.logo_path;if(lost){lost=false;throw new Error('Commit response was lost');}return {};}
  if(!rows.has(p.p_meta.path))rows.set(p.p_meta.path,{id:crypto.randomUUID(),...p.p_meta});if(lost){lost=false;throw new Error('Commit response was lost');}return rows.get(p.p_meta.path);
 }});
 const req={method:'POST',headers:{origin:'https://association.example','idempotency-key':crypto.randomUUID()},body:{op:'upload',scope:branding?'branding':'general',name:'evidence.png',mime:'image/png',base64:'aXNvbGF0ZWQ='}};
 let res=response();await handler(req,res);assert.equal(res.statusCode,500);const committedPath=branding?logo:[...rows.keys()][0];assert.ok(objects.has(committedPath));assert.equal(removals,0);
 res=response();await handler(req,res);assert.equal(res.statusCode,200);assert.equal(objects.size,1);assert.equal(removals,0);if(branding){assert.equal(res.result.path,logo);assert.ok(res.result.applied);}else{assert.equal(rows.size,1);assert.equal(res.result.id,rows.get(committedPath).id);}
});
test('private upload permission failure occurs before storage upload',async()=>{
 let uploads=0;const client={rpc:async()=>({data:false,error:null})};const handler=documentsHandler({environment:()=>({origin:'https://association.example'}),executive:async()=>({client}),privileged:()=>({storage:{from:()=>({upload:async()=>{uploads++;return {error:null};}})}})});
 const res=response();await handler({method:'POST',headers:{origin:'https://association.example'},body:{op:'upload',scope:'general'}},res);assert.equal(res.statusCode,403);assert.equal(uploads,0);
});
