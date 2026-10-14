import {createHmac,randomUUID} from 'node:crypto';
import {handler,method,environment,sameOrigin,body,json,HttpError,uuidValid} from '../server/http.js';
import {privileged,rpc} from '../server/supabase.js';
import {validateRegistration} from '../public/assets/js/domain.js';
export const config={api:{bodyParser:{sizeLimit:'24kb'}}};
export function registrationHandler(overrides={}) {
 const deps={environment,privileged,rpc,validateRegistration,...overrides};
 return handler(async(req,res)=>{method(req,'POST');const e=deps.environment();sameOrigin(req,e);if(!e.rateSalt||e.rateSalt.length<32)throw new HttpError(503,'Submission controls are not configured.');const payload=await body(req);const key=req.headers['idempotency-key'];if(!uuidValid(key))throw new HttpError(400,'A valid submission retry key is required.');const client=deps.privileged(e);
 // Vercel overwrites its trusted forwarded IP header. Do not trust arbitrary proxy chains.
 const ip=String(req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();const hash=createHmac('sha256',e.rateSalt).update(ip).digest('hex');if(!await deps.rpc(client,'consume_registration_rate',{p_hash:hash}))throw new HttpError(429,'Too many submissions. Please try again later.');
 if(payload?.website){json(res,200,{reference:randomUUID(),message:'Submission received for executive review'});return;}
 const valid=deps.validateRegistration(payload);if(!valid.valid)throw new HttpError(422,'Please check the highlighted details.',valid.errors);
 // New requests stay pending; leadership approves them through the executive workspace.
 const result=await deps.rpc(client,'submit_registration',{p_payload:valid.payload,p_key:key});json(res,200,result);});
}
export default registrationHandler();
