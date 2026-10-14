import {BRAND} from './domain.js';
import {RUNTIME_MODE} from './runtime-mode.js';
let instance;
export async function service(){
 if(instance)return instance;
 if(RUNTIME_MODE==='review'){const {ReviewService}=await import('./review-service.js');instance=new ReviewService();}
 else if(RUNTIME_MODE==='preview'){const {PreviewService}=await import('./preview-service.js');instance=new PreviewService();await instance.initialize();}
 else {const {ProductionService}=await import('./production-service.js');instance=new ProductionService();await instance.initialize();}
 return instance;
}
export const reviewMode=RUNTIME_MODE==='review';
export const uiPreview=RUNTIME_MODE==='preview';
export async function branding(){try{return await (await service()).branding();}catch{return {...BRAND};}}
