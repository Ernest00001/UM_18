import {officeLabels} from './executive-offices.js';
export const MEMBERSHIP_HEADERS=['Member ID','Name','Phone','Email','City','Country','Occupation','Skills','Membership','Executive office'];
export const membershipRow=m=>[m.member_no,m.full_name,m.phone_original,m.email,m.city,m.country,m.occupation,(m.skills||[]).join('; '),m.membership_status,officeLabels(m.executive_offices||[]).join('; ')];
// A physical register must include every page, irrespective of the screen filters.
export async function fullMembershipRegister(svc,fallback=[]){
 const members=new Map();
 if(svc.searchMembers){
  let offset=0;
  for(;;){const page=await svc.searchMembers({query:'',status:'',country:'',offset,limit:100,sort:'full_name',descending:false});
   for(const m of page.rows)if(!m.merged_into_member_id)members.set(m.id,m);
   offset+=page.rows.length;
   if(offset>=page.count)break;
   if(!page.rows.length)throw new Error('The complete register could not be loaded. Please try again.');
  }
 }else for(const m of fallback)if(!m.merged_into_member_id)members.set(m.id,m);
 return [...members.values()].sort((a,b)=>a.full_name.localeCompare(b.full_name)||a.id.localeCompare(b.id));
}
