import {createHash} from 'node:crypto';
import {handler,method,environment,sameOrigin,body,json,HttpError,uuidValid} from '../server/http.js';
import {executive,privileged,rpc} from '../server/supabase.js';
import {validateFile} from '../server/files.js';
export const config={api:{bodyParser:{sizeLimit:'4400kb'}}};
export function documentsHandler(overrides={}) {
 const deps={environment,executive,privileged,rpc,validateFile,...overrides};
 return handler(async(req,res)=>{method(req,'POST');const e=deps.environment();sameOrigin(req,e);const p=await body(req,4500000);const {client}=await deps.executive(req,e);
 if(['download','preview'].includes(p.op)){if(!uuidValid(p.id))throw new HttpError(422,'Choose a document.');const d=await deps.rpc(client,'document_access',{p_id:p.id});const {data,error}=await deps.privileged(e).storage.from(d.bucket).createSignedUrl(d.object_path,60,p.op==='download'?{download:d.title}:{});if(error)throw new HttpError(503,'Document access could not be created.');await deps.rpc(client,'document_access',{p_id:p.id});json(res,200,{url:data.signedUrl,expiresIn:60});return;}
 if(p.op!=='upload')throw new HttpError(400,'Unsupported document operation.');const branding=p.scope==='branding';
 if(branding){const {data,error}=await client.rpc('has_permission',{p_permission:'settings.write'});if(error||!data)throw new HttpError(403,'Branding permission required.');if(!['image/png','image/jpeg','image/webp'].includes(p.mime))throw new HttpError(422,'Use a PNG, JPEG, or WebP logo.');}
 else{const {data,error}=await client.rpc('can_access_document',{p_scope:p.scope,p_target:p.target_id||null,p_write:true});if(error||!data)throw new HttpError(403,'Document access is outside your current permissions.');}
 const {data:{user}}=await client.auth.getUser();if(!user)throw new HttpError(403,'Executive session unavailable.');
 if(p.previous_version_id&&!uuidValid(p.previous_version_id))throw new HttpError(422,'Choose a valid previous document version.');
 const key=req.headers['idempotency-key'];if(!uuidValid(key))throw new HttpError(422,'A valid operation key is required.');
 const validated=await deps.validateFile(p,branding?2097152:3145728);const digest=createHash('sha256').update(String(p.scope)).update(String(p.target_id||'general')).update(String(p.previous_version_id||'')).update(validated.bytes).digest('hex');
 const path=branding?`logos/${digest}.${validated.extension}`:`${user.id}/${p.scope}/${p.target_id||'general'}/${digest}.${validated.extension}`,bucket=branding?'branding':'private-documents',admin=deps.privileged(e);
 const {error}=await admin.storage.from(bucket).upload(path,validated.bytes,{contentType:validated.mime,upsert:false,cacheControl:branding?'31536000':'0'});const existed=error&&(String(error.statusCode)==='409'||/already exists|duplicate/i.test(error.message));if(error&&!existed)throw new HttpError(503,'The file was not uploaded.');
 // A failed response may follow a successful commit. Retain bytes for safe retry;
 // later orphan cleanup must check current and preserved database references.
 let result;if(branding){await deps.rpc(client,'execute_action',{p_action:'save_branding',p_payload:{logo_path:path},p_key:key});result={path,applied:true};}else result=await deps.rpc(client,'commit_document_v2',{p_meta:{title:p.title||validated.name,scope:p.scope,target_id:p.target_id||null,path,mime_type:validated.mime,byte_size:validated.bytes.length,category:p.category||'supporting',description:p.description||null,previous_version_id:p.previous_version_id||null}});json(res,200,result);
 });
}
export default documentsHandler();
