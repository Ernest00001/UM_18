import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {handler,environment,sameOrigin,body,json,HttpError,uuidValid} from '../server/http.js';
import {executive,privileged,rpc} from '../server/supabase.js';
import {validateFile} from '../server/files.js';

export const config = {api:{bodyParser:{sizeLimit:'4400kb'}}};

export function eventsHandler(overrides = {}) {
  const deps = {environment,executive,privileged,rpc,validateFile,createClient,...overrides};
  return handler(async (req,res) => {
    const e = deps.environment();
    if (req.method === 'GET') {
      const params = new URL(req.url || '/api/events', e.origin).searchParams;
      const mediaId = params.get('media');
      if (mediaId !== null) {
        if (!uuidValid(mediaId)) throw new HttpError(422,'Choose a valid event image.');
        const admin = deps.privileged(e);
        const media = await deps.rpc(admin,'public_event_media',{p_id:mediaId});
        const {data,error} = await admin.storage.from('event-media').createSignedUrl(media.object_path,60);
        if (error) throw new HttpError(503,'The event image is temporarily unavailable.');
        await deps.rpc(admin,'public_event_media',{p_id:mediaId});
        res.setHeader('Location',data.signedUrl);
        res.setHeader('Cache-Control','no-store');
        res.setHeader('X-Content-Type-Options','nosniff');
        res.setHeader('Referrer-Policy','no-referrer');
        res.statusCode=302;res.end();return;
      }
      const view = params.get('view') || 'upcoming';
      if (!['upcoming','gallery'].includes(view)) throw new HttpError(422,'Choose upcoming events or the gallery.');
      const client = deps.createClient(e.url,e.key,{auth:{persistSession:false,autoRefreshToken:false}});
      const feed = await deps.rpc(client,'public_events',{p_view:view});
      const events = (feed.events || []).map(event => ({id:event.id,title:event.title,event_date:event.event_date,status:event.status,public_location:event.public_location,public_description:event.public_description,closed_at:event.closed_at,media:(event.media || []).map(media => ({id:media.id,kind:media.kind,caption:media.caption,alt_text:media.alt_text,is_banner:media.is_banner,url:'/api/events?media='+encodeURIComponent(media.id)}))}));
      json(res,200,{events});return;
    }
    if (req.method !== 'POST') throw new HttpError(405,'Method not allowed.');
    sameOrigin(req,e);
    const p = await body(req,4500000);
    if (p.op === 'preview') {
      if (!uuidValid(p.id)) throw new HttpError(422,'Choose an event image.');
      const {client} = await deps.executive(req,e);
      const media = await deps.rpc(client,'event_media_access',{p_id:p.id});
      const {data,error} = await deps.privileged(e).storage.from('event-media').createSignedUrl(media.object_path,60);
      if (error) throw new HttpError(503,'The event image is temporarily unavailable.');
      await deps.rpc(client,'event_media_access',{p_id:p.id});
      json(res,200,{url:data.signedUrl,expiresIn:60});return;
    }
    if (p.op !== 'upload' || !uuidValid(p.event_id)) throw new HttpError(422,'Choose an event to attach an image.');
    if (!['poster','photo'].includes(p.kind) || typeof p.caption !== 'string' || p.caption.length>1500 || typeof p.alt_text !== 'string' || p.alt_text.trim().length<2 || p.alt_text.length>300 || typeof p.is_banner !== 'boolean' || typeof p.show_in_gallery !== 'boolean' || p.kind==='photo' && p.is_banner) throw new HttpError(422,'Provide the image type, description and public display choices.');
    if (!['image/png','image/jpeg','image/webp'].includes(p.mime)) throw new HttpError(422,'Event posters and photos must be PNG, JPEG or WebP images.');
    const key=req.headers['idempotency-key'];
    if (!uuidValid(key)) throw new HttpError(422,'A valid upload operation key is required.');
    const {client,user} = await deps.executive(req,e,'events.write');
    await deps.rpc(client,'event_media_list',{p_event:p.event_id});
    const validated = await deps.validateFile(p,3145728);
    const digest=createHash('sha256').update(p.event_id).update(p.kind).update(validated.bytes).digest('hex');
    const path=`${user.id}/event/${p.event_id}/${digest}.${validated.extension}`;
    const admin=deps.privileged(e);
    const {error} = await admin.storage.from('event-media').upload(path,validated.bytes,{contentType:validated.mime,upsert:false,cacheControl:'0'});
    const existed=error&&(String(error.statusCode)==='409'||/already exists|duplicate/i.test(error.message));
    if (error&&!existed) throw new HttpError(503,'The event image was not uploaded.');
    await deps.executive(req,e,'events.write');
    // A failed response may follow a committed row or a concurrent upload.
    // Keep private bytes for a retry; orphan cleanup must first check references.
    const result=await deps.rpc(admin,'commit_event_media',{p_actor:user.id,p_key:key,p_meta:{event_id:p.event_id,path,mime_type:validated.mime,byte_size:validated.bytes.length,kind:p.kind,caption:p.caption,alt_text:p.alt_text.trim(),is_banner:p.is_banner,show_in_gallery:p.show_in_gallery}});
    json(res,200,result);
  });
}

export default eventsHandler();
