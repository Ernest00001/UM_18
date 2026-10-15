import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep,extname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {body,HttpError} from '../server/http.js';
import {validateFile} from '../server/files.js';
import {ReviewService} from '../.local/ui-preview/assets/js/review-service.js';

// Local-only UI state. Never deployed by Vercel or connected to Supabase.
const root=resolve('.local/ui-preview'),port=Number(process.env.PORT||3180),origin='http://127.0.0.1:'+port;
const workspace=new ReviewService();workspace.user=workspace.data.accounts[0];
const files=new Map();
const methods=new Set(['myProfile','saveMyProfile','presidentialCandidates','memberContributions','session','branding','load','act','history','searchMembers','searchPayments','accountabilityOverview','officeReports','monthlySchedule','collectionSummaries','welfareAssignments','memberRecord','memberAssessments','documentTargets','eventDocuments','publicEvents','eventMedia','eventMediaPreview','register','invite']);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ttf':'font/ttf','.txt':'text/plain'};
const json=(response,status,value)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));};
const fileUrl=(id,isPublic=false)=>origin+'/__ui/file?id='+encodeURIComponent(id)+(isPublic?'&public=1':'');

http.createServer(async(request,response)=>{
  try{
    const host=String(request.headers.host||'');
    if(!['127.0.0.1:'+port,'localhost:'+port].includes(host))throw new HttpError(403,'Local preview host required.');
    const url=new URL(request.url,origin);
    if(url.pathname.startsWith('/__ui/')){
      if(request.headers.origin&&!['http://'+host,origin].includes(request.headers.origin))throw new HttpError(403,'Use the local preview page.');
      if(request.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'Cross-site preview access is unavailable.');
      if(url.pathname==='/__ui/call'){
        if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
        const p=await body(request,65536);
        if(!methods.has(p.method)||!Array.isArray(p.args))throw new HttpError(400,'Unknown preview operation.');
        workspace.user=workspace.data.accounts.find(a=>a.id===workspace.user.id)||workspace.user;
        if(p.method==='eventDocuments')return json(response,200,workspace.data.documents.filter(d=>d.scope==='event'&&d.target_id===p.args[0]));
        if(p.method==='invite'&&p.args[0]?.member_id){const m=workspace.data.members.find(m=>m.id===p.args[0].member_id&&m.membership_status==='active'&&!m.archived_at&&!m.merged_into_member_id);if(!m)throw new HttpError(422,'Choose an active member before preparing an executive invitation.');}
        if(p.method==='eventMediaPreview'){await workspace.eventMediaPreview(p.args[0]);return json(response,200,fileUrl(p.args[0]));}
        const result=await workspace[p.method](...p.args);
        return json(response,200,result);
      }
      if(url.pathname==='/__ui/upload'){
        if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
        const p=await body(request,4500000),validated=await validateFile(p,p.scope==='branding'?2097152:3145728);
        const file=new Blob([validated.bytes],{type:validated.mime});Object.defineProperty(file,'name',{value:validated.name});
        if(p.type==='event'){
          if(!validated.mime.startsWith('image/'))throw new HttpError(422,'Use an image for posters and photos.');
          const metadata={event_id:p.event_id,kind:p.kind,caption:p.caption,alt_text:p.alt_text,is_banner:p.is_banner,show_in_gallery:p.show_in_gallery,content_hash:createHash('sha256').update(validated.bytes).digest('hex')};
          const row=await workspace.saveEventMedia(metadata,'',validated.mime,validated.bytes.length,file,request.headers['idempotency-key']);
          row.url=fileUrl(row.id,true);workspace.data.event_media.find(m=>m.id===row.id).url=row.url;workspace.eventMediaFiles.set(row.id,{file,url:fileUrl(row.id)});
          files.set(row.id,{bytes:validated.bytes,mime:validated.mime,event:true});
          return json(response,200,row);
        }
        const row=await workspace.upload(file,p.scope,p.target_id,p);
        const id=row.id||crypto.randomUUID();files.set(id,{bytes:validated.bytes,mime:validated.mime,event:false});
        if(p.scope==='branding'){workspace.data.branding.logo_url=fileUrl(id);return json(response,200,{logo_url:workspace.data.branding.logo_url,applied:true});}
        workspace.documents.set(id,{file,url:fileUrl(id)});
        return json(response,200,row);
      }
      if(url.pathname==='/__ui/file'){
        if(request.method!=='GET')throw new HttpError(405,'Method not allowed.');
        const id=url.searchParams.get('id'),file=files.get(id);
        if(!file)throw new HttpError(404,'Preview file unavailable.');
        if(url.searchParams.get('public')==='1'){
          const feeds=await Promise.all(['upcoming','gallery'].map(view=>workspace.publicEvents(view)));
          if(!file.event||!feeds.some(feed=>feed.events.some(event=>event.media.some(media=>media.id===id))))throw new HttpError(404,'This event image is not published.');
        }
        response.writeHead(200,{'Content-Type':file.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(file.bytes);return;
      }
      throw new HttpError(404,'Preview operation unavailable.');
    }
    if(url.pathname.startsWith('/api/'))throw new HttpError(503,'Live services will be connected after UI review.');
    let path=resolve(root,'.'+decodeURIComponent(url.pathname));const child=relative(root,path);
    if(child==='..'||child.startsWith('..'+sep)||isAbsolute(child))throw new HttpError(403,'Invalid preview path.');
    let status=200;
    try{if((await stat(path)).isDirectory())path=join(path,'index.html');await stat(path);}catch{const detail=/^\/admin\/(members|monthly|special|payments|expenses|events|welfare|documents|registrations|accounts|office-reports)\/[^/]+\/?$/.test(url.pathname);path=join(root,detail?'admin/index.html':'404.html');if(!detail)status=404;}
    response.writeHead(status,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    response.end(await readFile(path));
  }catch(error){json(response,error.status||400,{error:error.message||'Preview unavailable.'});}
}).listen(port,'127.0.0.1',()=>console.log('Empty UI preview: '+origin+' · executive screens: '+origin+'/admin/overview/'));
