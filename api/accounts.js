import {handler,method,environment,sameOrigin,body,json,HttpError,uuidValid} from '../server/http.js';
import {executive,privileged,rpc} from '../server/supabase.js';
import {ALL_PERMISSIONS} from '../public/assets/js/domain.js';
import {validOfficeCodes} from '../public/assets/js/executive-offices.js';
export default handler(async(req,res)=>{method(req,'POST');const e=environment();sameOrigin(req,e);const p=await body(req);
 if(p.op==='reset_mfa'){
 const {client,user}=await executive(req,e,'accounts.mfa_reset');const key=req.headers['idempotency-key'];if(!uuidValid(p.id)||!uuidValid(key)||String(p.reason||'').trim().length<2)throw new HttpError(422,'Choose an executive and provide a recovery reason.');
 const op=await rpc(client,'begin_account_recovery',{p_target:p.id,p_key:key,p_reason:p.reason.trim()});if(op.completed){json(res,200,{completed:true});return;}
 const admin=privileged(e),deleted=[];let completed=false;
 try{const {data,error}=await admin.auth.admin.mfa.listFactors({userId:p.id});if(error)throw new Error('Factor lookup failed.');for(const factor of data.factors){await executive(req,e,'accounts.mfa_reset');const {error}=await admin.auth.admin.mfa.deleteFactor({userId:p.id,id:factor.id});if(error)throw new Error('Factor reset failed.');deleted.push(factor.id);}completed=true;}
 finally{await executive(req,e,'accounts.mfa_reset');await rpc(admin,'finish_account_recovery',{p_actor:user.id,p_id:op.id,p_lease:op.lease_id,p_completed:completed,p_details:{deleted_factor_ids:deleted,completed}});}
 if(!completed)throw new HttpError(503,'Recovery did not finish. The operation is audited and the account remains restricted.');json(res,200,{completed:true});return;
 }
 const {client,user}=await executive(req,e,'accounts.write');
 const permissionList=value=>value===undefined||(Array.isArray(value)&&value.length<=ALL_PERMISSIONS.length&&new Set(value).size===value.length&&value.every(x=>ALL_PERMISSIONS.includes(x)));
 const validDate=value=>!value||(typeof value==='string'&&Number.isFinite(Date.parse(value)));
 if(p.op!=='invite'||!Array.isArray(p.roles)||!p.roles.length||p.roles.length>5||p.roles.some(r=>!['owner','secretary','treasurer','welfare','read_only'].includes(r))||new Set(p.roles).size!==p.roles.length||typeof p.email!=='string'||p.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)||typeof p.display_name!=='string'||p.display_name.trim().length<2||p.display_name.length>120||typeof p.reason!=='string'||p.reason.trim().length<2||p.reason.length>1500||!permissionList(p.permissions)||!permissionList(p.denied_permissions)||!validDate(p.expires_at)||(p.member_id&&!uuidValid(p.member_id)))throw new HttpError(422,'Provide valid invitation details, roles, and an access reason.');
 if(p.role_schedule!==undefined&&(!Array.isArray(p.role_schedule)||p.role_schedule.length>p.roles.length||new Set(p.role_schedule.map(s=>s?.role_code)).size!==p.role_schedule.length||p.role_schedule.some(s=>!s||!p.roles.includes(s.role_code)||!validDate(s.starts_at)||!validDate(s.expires_at)||(s.starts_at&&s.expires_at&&Date.parse(s.expires_at)<=Date.parse(s.starts_at)))))throw new HttpError(422,'Review each role’s effective dates.');
 if(p.office_codes!==undefined&&!validOfficeCodes(p.office_codes))throw new HttpError(422,'Choose valid executive offices without duplicates.');
 if(p.roles.includes('owner')&&((p.denied_permissions||[]).some(x=>['accounts.write','directory.read'].includes(x))||p.expires_at||p.role_schedule?.some(s=>s.role_code==='owner'&&s.expires_at)))throw new HttpError(422,'Owners must retain permanent account administration and directory access.');
 const key=req.headers['idempotency-key'];if(!uuidValid(key))throw new HttpError(422,'A valid invitation operation key is required.');
 if(p.replaces_executive_id&&!uuidValid(p.replaces_executive_id))throw new HttpError(422,'Choose a valid executive to replace.');
 // Membership enrollment and replacement checks are enforced in the database.
 p.include_membership=true;p.approved_member_invitation=true;
 if(!uuidValid(p.member_id))throw new HttpError(422,'Choose an approved member before sending an executive invitation.');
 const op=await rpc(client,'begin_invitation',{p_key:key,p_payload:p});if(op.completed){json(res,200,{id:op.user_id,invited:true});return;}
 if(p.member_id)await rpc(client,'executive_invitation_member',{p_member:p.member_id});
 const admin=privileged(e);let id=op.user_id;
 if(!id){const {data,error}=await admin.auth.admin.inviteUserByEmail(p.email,{redirectTo:e.origin+'/admin/login/',data:{display_name:p.display_name}});if(error)throw new HttpError(409,'Invitation delivery could not be established. Review Supabase Auth before retrying.');id=data.user.id;await rpc(client,'mark_invitation_identity',{p_id:op.id,p_lease:op.lease_id,p_user:id});}
 try{await executive(req,e,'accounts.write');const result=await rpc(admin,'provision_invitation_v2',{p_op:op.id,p_lease:op.lease_id,p_actor:user.id,p_id:id,p_name:p.display_name,p_email:p.email,p_roles:p.roles,p_permissions:p.permissions||[],p_expires:p.expires_at||null,p_member:p.member_id||null,p_reason:p.reason,p_denied:p.denied_permissions||[],p_schedule:p.role_schedule||[],p_offices:p.office_codes||[]});json(res,200,{id:result.id,invited:true});}
 catch{throw new HttpError(409,'The invitation identity was recorded, but executive access was not granted. After reviewing the record, retry this same operation; it will not send another invitation.');}

});
