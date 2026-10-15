export const BRAND = {organisation_name:'Unmatched 18', short_name:'UM18', slogan:'semper ultra', cohort:2018, logo_url:null, contact_email:null, contact_phone:null, school_name:null};
export const ALL_PERMISSIONS = ['directory.read','members.write','registrations.review','contacts.read','contacts.write','events.write','finance.read','finance.write','finance.export','directory.export','members.import','welfare.read','welfare.write','welfare.export','documents.write','settings.write','accounts.write','accounts.mfa_reset','welfare.assign','audit.read','office_reports.write'];
export function kobo(value) {
  const s=String(value??'').trim();
  if(!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('Enter a non-negative amount with at most two decimal places.');
  const [a,b='']=s.split('.'); const n=Number(a)*100+Number(b.padEnd(2,'0'));
  if(!Number.isSafeInteger(n)||n>100000000000) throw new Error('Amount is too large.');
  return n;
}
export const money=n=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:2}).format(Number(n||0)/100);
export function normalizePhone(value) {
  let n=String(value||'').trim().replace(/[\s().-]/g,'');
  if(n.startsWith('00')) n='+'+n.slice(2);
  if(/^0\d{10}$/.test(n)) n='+234'+n.slice(1);
  if(!/^\+[1-9]\d{6,14}$/.test(n)) throw new Error('Use a Nigerian mobile number or a complete international number beginning with +.');
  return n;
}
export const normalizedName=s=>String(s||'').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const PUBLIC_FIELDS=['full_name','former_name','phone','whatsapp','email','city','region','country','gender','birthday_day','birthday_month','birth_year','address','socials','joined_year','qualification','qualification_other','course','institution','occupation','occupation_other','business_name','business_sector','business_description','skills','emergency_name','emergency_relationship','emergency_phone','emergency_permission','message','acknowledgement','website','bot_token'];
export function validateRegistration(input,{strict=true,requireContacts=false}={}) {
  const errors={}; const p={};
  if(!input||Array.isArray(input)||typeof input!=='object')return {valid:false,errors:{form:'A registration object is required.'},payload:{}};
  if(strict&&Object.keys(input).some(k=>!PUBLIC_FIELDS.includes(k))) errors.form='Unexpected fields are not allowed.';
  for(const f of PUBLIC_FIELDS) p[f]=typeof input[f]==='string'?input[f].trim():input[f];
  for(const [f,label] of [['full_name','Full name'],['city','City'],['country','Country']]) if(!p[f]||String(p[f]).length<2) errors[f]=`${label} is required.`;
  for(const f of PUBLIC_FIELDS){if(!['skills','socials','acknowledgement','emergency_permission','birthday_day','birthday_month','birth_year','joined_year'].includes(f)&&p[f]!=null&&typeof p[f]!=='string')errors[f]='Enter text for this field.';if(typeof p[f]==='string'&&p[f].length>(f==='bot_token'?2048:['address','message','business_description'].includes(f)?1500:180))errors[f]='This field is too long.';}
  try{p.phone_normalized=normalizePhone(p.phone);}catch(e){errors.phone=e.message;}
  if(requireContacts&&!p.email)errors.email='Personal email is required.';
  if(requireContacts&&!p.whatsapp)errors.whatsapp='WhatsApp number is required.';
  if(p.whatsapp) try{p.whatsapp_normalized=normalizePhone(p.whatsapp);}catch(e){errors.whatsapp=e.message;}
  if(p.emergency_phone) try{p.emergency_phone_normalized=normalizePhone(p.emergency_phone);}catch(e){errors.emergency_phone=e.message;}
  if(p.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) errors.email='Enter a valid email address.';
  if(p.acknowledgement!==true&&p.acknowledgement!=='on') errors.acknowledgement='Please acknowledge the explained use of your information.';
  if((p.emergency_name||p.emergency_relationship||p.emergency_phone)&&p.emergency_permission!==true&&p.emergency_permission!=='on') errors.emergency_permission='Confirm that your emergency contact has agreed.';
  if(p.emergency_name||p.emergency_relationship||p.emergency_phone){if(!p.emergency_name)errors.emergency_name='Provide the contact name, or clear the emergency section.';if(!p.emergency_relationship)errors.emergency_relationship='Provide the relationship, or clear the emergency section.';if(!p.emergency_phone)errors.emergency_phone='Provide the contact phone, or clear the emergency section.';}
 const year=new Date().getUTCFullYear();
  for(const [f,min,max] of [['joined_year',1900,2018],['birth_year',1900,year]]) if(p[f]&&(!Number.isInteger(Number(p[f]))||Number(p[f])<min||Number(p[f])>max)) errors[f]=`Enter a year from ${min} to ${max}.`;
  if(!!p.birthday_day!==!!p.birthday_month) errors.birthday_day='Provide both a day and a month, or leave both blank.';
  if(p.birthday_day&&p.birthday_month){ const d=Number(p.birthday_day),m=Number(p.birthday_month),max=new Date(Date.UTC(Number(p.birth_year)||2000,m,0)).getUTCDate(); if(!Number.isInteger(d)||!Number.isInteger(m)||m<1||m>12||d<1||d>max) errors.birthday_day='Enter a valid birthday.'; }
  if(p.gender&&!['female','male','other','prefer_not_to_say'].includes(p.gender)) errors.gender='Choose an available option.';
  if(p.occupation&&!['employed','student','self-employed','job-seeking','retired','other'].includes(p.occupation)) errors.occupation='Choose an available option.';
  if(p.skills&&!Array.isArray(p.skills)) errors.skills='Skills must be a list.';
  if(Array.isArray(p.skills)&&(p.skills.length>30||p.skills.some(x=>typeof x!=='string')))errors.skills='Use up to 30 text entries for skills.';
  p.skills=(Array.isArray(p.skills)?p.skills:[]).map(String).map(x=>x.trim()).filter(Boolean).slice(0,30);
  if(p.skills.some(x=>x.length>80)) errors.skills='Keep each skill under 80 characters.';
  if(p.socials!=null&&p.socials!==''&&!Array.isArray(p.socials))errors.socials='Social profiles must be a list.';p.socials=Array.isArray(p.socials)?p.socials:[];
  if(p.socials.length>10||p.socials.some(x=>!x||typeof x!=='object'||typeof x.platform!=='string'||typeof x.handle!=='string'||!x.platform||!x.handle||String(x.platform).length>40||String(x.handle).length>180||(String(x.handle).includes('://')&&!safeUrl(x.handle)))) errors.socials='Use a platform and a handle or safe https URL (up to 10).';
  p.acknowledgement=true; p.phone_original=p.phone; p.name_normalized=normalizedName(p.full_name);
  delete p.bot_token; delete p.website;
  return {valid:!Object.keys(errors).length,errors,payload:p};
}
export function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
export function netPayment(p,adjustments=[]){return p.status==='confirmed'?Number(p.amount_kobo)+adjustments.filter(a=>a.payment_id===p.id).reduce((s,a)=>s+Number(a.delta_kobo),0):0;}
export function paidFor(data,member,collection){return data.allocations.filter(a=>a.member_id===member&&a.collection_id===collection).reduce((s,a)=>s+(data.payments.find(p=>p.id===a.payment_id)?.status==='confirmed'?Number(a.amount_kobo):0),0);}
export function assessmentState(a,paid){const due=Math.max(0,Number(a.expected_kobo)-Number(a.waiver_kobo||0));return {due,paid,outstanding:Math.max(0,due-paid),status:due===0?'waived':paid>=due?'paid':paid>0?'partial':'outstanding'};}
export function collectionTotals(data,c){const received=data.allocations.filter(a=>a.collection_id===c.id&&data.payments.find(p=>p.id===a.payment_id)?.status==='confirmed').reduce((s,a)=>s+Number(a.amount_kobo),0);const spending=data.expenses.filter(e=>e.collection_id===c.id&&e.status==='approved').reduce((s,e)=>s+Number(e.amount_kobo),0);const assessments=data.assessments.filter(a=>a.collection_id===c.id);return {received,spending,remaining:received-spending,expected:assessments.reduce((s,a)=>s+Math.max(0,a.expected_kobo-(a.waiver_kobo||0)),0),outstanding:assessments.reduce((s,a)=>s+assessmentState(a,paidFor(data,a.member_id,c.id)).outstanding,0)};}
export function assertAllocations(data,payment,allocations,net=netPayment(payment,data.adjustments)){
  let sum=0;const seen=new Set();
  for(const a of allocations){if(!Number.isSafeInteger(a.amount_kobo)||a.amount_kobo<=0) throw new Error('Allocations must be positive integer kobo.'); if(a.member_id&&a.member_id!==payment.member_id) throw new Error('Allocation member mismatch.');const c=data.collections.find(c=>c.id===a.collection_id);if(!c||c.status==='draft') throw new Error('Select a published collection.');if(c.participation==='compulsory'&&!data.assessments.some(x=>x.collection_id===c.id&&x.member_id===payment.member_id))throw new Error('This member has no assessment for that collection.');if(seen.has(c.id))throw new Error('Combine allocations to the same collection.');seen.add(c.id);sum+=a.amount_kobo;}
  if(sum>net)throw new Error('Allocations exceed the confirmed available amount.'); return sum;
}
export function csvCell(v){let s=String(v??'');if(!(typeof v==='number'&&Number.isFinite(v))&&/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export const csv=rows=>rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
export function parseCsv(s){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(quoted&&s[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&s[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}if(quoted)throw new Error('Unclosed quoted CSV field.');row.push(cell);if(row.some(Boolean))rows.push(row);return rows;}
export function uid(){return globalThis.crypto.randomUUID();}
export function dayISO(value=new Date()){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
