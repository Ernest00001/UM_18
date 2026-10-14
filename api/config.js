import {handler,method,environment,json,HttpError} from '../server/http.js';
export default handler(async(req,res)=>{method(req,'GET');const e=environment();if(process.env.APP_MODE&&process.env.APP_MODE!=='production')throw new HttpError(503,'Production mode is required on this endpoint.');json(res,200,{mode:'production',supabaseUrl:e.url,publishableKey:e.key,timezone:'Africa/Lagos'});});
