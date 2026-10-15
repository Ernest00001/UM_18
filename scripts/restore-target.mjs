const PRODUCTION_PROJECT='hpbzhaleqphfucnautpl';
function projectRef(value){
 let url;try{url=new URL(value);}catch{throw new Error('Use the canonical Supabase project URL for restore checks.');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||!/^([a-z0-9]{20})\.supabase\.co$/.test(url.hostname))throw new Error('Use the canonical Supabase project URL for restore checks.');
 return url.hostname.split('.')[0];
}
export function verifyRestoreTarget({targetUrl,sourceUrl,approvedProjectRef,environment,confirmation}){
 const target=projectRef(targetUrl),source=projectRef(sourceUrl);
 if(environment!=='staging'||confirmation!=='STAGING_RESTORE_APPROVED'||!approvedProjectRef||target!==approvedProjectRef)throw new Error('Explicit staging environment and matching RESTORE_TARGET_PROJECT_REF are required.');
 if(target===PRODUCTION_PROJECT||target===source)throw new Error('Staging restore cannot target production or the backup source project.');
 return target;
}
