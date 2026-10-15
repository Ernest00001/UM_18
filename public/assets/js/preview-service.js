import {operationKey} from './ui.js';

// This adapter is shipped only in the separate localhost UI preview.
export class PreviewService {
 async myProfile(){return this.call('myProfile');}
 async saveMyProfile(payload){return this.call('saveMyProfile',[payload,operationKey()]);}
 async presidentialCandidates(){return this.call('presidentialCandidates');}
 async memberContributions(id){return this.call('memberContributions',[id]);}
 async changeSigninEmail(){throw new Error('This local preview does not send confirmation emails.');}
  async call(method,args=[]) {
    const response=await fetch('/__ui/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'The preview change was not saved.');
    return result;
  }
  async initialize(){this.config={mode:'preview'};this.user=await this.call('session');}
  async session(){return this.call('session');}
  async branding(){return this.call('branding');}
  async login(){throw new Error('Live sign-in will be available after Supabase setup. Use the workspace preview to review the screens.');}
  async logout(){}
  async recover(){throw new Error('Password recovery will be available after Supabase setup. No email was sent.');}
  async load(){return this.call('load');}
  async act(action,payload,key=operationKey()){return this.call('act',[action,payload,key]);}
  async history(scope,id){return this.call('history',[scope,id]);}
  async searchMembers(options){return this.call('searchMembers',[options]);}
  async searchPayments(options){return this.call('searchPayments',[options]);}
  async accountabilityOverview(options){return this.call('accountabilityOverview',[options]);}
  async officeReports(){return this.call('officeReports');}
  async monthlySchedule(options){return this.call('monthlySchedule',[options]);}
  async collectionSummaries(){return this.call('collectionSummaries');}
  async welfareAssignments(){return this.call('welfareAssignments');}
  async memberRecord(id){return this.call('memberRecord',[id]);}
  async memberAssessments(id){return this.call('memberAssessments',[id]);}
  async documentTargets(scope,query=''){return this.call('documentTargets',[scope,query]);}
  async eventDocuments(id){return this.call('eventDocuments',[id]);}
  async publicEvents(view){return this.call('publicEvents',[view]);}
  async eventMedia(id){return this.call('eventMedia',[id]);}
  async eventMediaPreview(id){return this.call('eventMediaPreview',[id]);}
  async register(payload,key){return this.call('register',[payload,key]);}
  async invite(payload){return this.call('invite',[payload,operationKey()]);}
  async resetMfa(){throw new Error('Authenticator recovery requires the live Supabase connection.');}
  async sendFile(file,metadata){
    const bytes=new Uint8Array(await file.arrayBuffer());let raw='';
    for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const response=await fetch('/__ui/upload',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':operationKey()},body:JSON.stringify({name:file.name,mime:file.type,base64:btoa(raw),...metadata})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'The preview file was not saved.');return result;
  }
  async uploadEventMedia(file,metadata){return this.sendFile(file,{type:'event',...metadata});}
  async upload(file,scope,target,metadata={}){return this.sendFile(file,{type:'document',scope,target_id:target,...metadata});}
  async download(id){return '/__ui/file?id='+encodeURIComponent(id);}
}
