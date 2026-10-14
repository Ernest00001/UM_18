import {createHmac,randomUUID} from 'node:crypto';
import {handler,method,environment,sameOrigin,body,json,HttpError,uuidValid} from '../server/http.js';
import {privileged,rpc} from '../server/supabase.js';
import {validateRegistration} from '../public/assets/js/domain.js';
export const config={api:{bodyParser:{sizeLimit:'24kb'}}};
export default handler(async(req,res)=>{method(req,'POST');const e=environment();sameOrigin(req,e);if(!e.rateSalt||e.rateSalt.length<32)throw new HttpError(503,'Submission controls are not configured.');const payload=await body(req);const key=req.headers['idempotency-key'];if(!uuidValid(key))throw new HttpError(400,'A valid submission retry key is required.');const client=privileged(e);
 // Vercel overwrites its trusted forwarded IP header. Do not trust arbitrary proxy chains.
 const ip=String(req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();const hash=createHmac('sha256',e.rateSalt).update(ip).digest('hex');if(!await rpc(client,'consume_registration_rate',{p_hash:hash}))throw new HttpError(429,'Too many submissions. Please try again later.');
 if(payload?.website){json(res,200,{reference:randomUUID(),message:'Submission received for executive review'});return;}
 const valid=validateRegistration(payload);if(!valid.valid)throw new HttpError(422,'Please check the highlighted details.',valid.errors);
 if(e.botSecret){const params=new URLSearchParams({secret:e.botSecret,response:String(payload.bot_token||''),remoteip:ip,idempotency_key:key});const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:params,signal:AbortSignal.timeout(8000)});const check=await response.json();if(!response.ok||!check.success||check.hostname!==new URL(e.origin).hostname)throw new HttpError(422,'Complete the verification and try again.');}
 else if(!(process.env.ALLOW_LOCAL_NO_BOT==='true'&&process.env.VERCEL_ENV!=='production'&&new URL(e.origin).hostname==='localhost'))throw new HttpError(503,'Submission verification is not configured.');
 const result=await rpc(client,'submit_registration',{p_payload:valid.payload,p_key:key});json(res,200,result);});
