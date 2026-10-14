import {BRAND,ALL_PERMISSIONS} from '../public/assets/js/domain.js';

export function fixtures() {
  return {
    branding:{...BRAND},
    members:[],submissions:[],collections:[],assessments:[],payments:[],allocations:[],adjustments:[],expenses:[],events:[],attendance:[],welfare:[],contacts:[],documents:[],event_media:[],office_reports:[],officeReportHistory:[],audit:[],
    accounts:[{id:'00000000-0000-4000-8000-000000000001',display_name:'Workspace preview',email:null,active:true,permissions:[...ALL_PERMISSIONS],roles:['owner'],office_codes:['president'],expires_at:null}],
    settings:{document_limit_mb:3,retention_review_months:24}
  };
}
