import {BRAND} from './domain.js';
import {RUNTIME_MODE} from './runtime-mode.js';

export const reviewMode = RUNTIME_MODE === 'review';
export const uiPreview = RUNTIME_MODE === 'preview';
let instance;

export class PublicService {
  async initialize() {
    const response = await fetch('/api/config', {cache:'no-store'});
    if (!response.ok) throw new Error('Registration is not available until the association completes its setup.');
    this.config = await response.json();
    if (this.config.mode !== 'production') throw new Error('Invalid public configuration.');
  }
  async register(payload, key) {
    const response = await fetch('/api/register', {method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key':key}, body:JSON.stringify(payload)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'Your submission was not saved. Please try again.'), {fields:data.fields});
    return data;
  }
  async publicEvents(view = 'upcoming') {
    const response = await fetch('/api/events?view=' + encodeURIComponent(view), {cache:'no-store'});
    if (!response.ok) throw new Error('Event announcements are temporarily unavailable. Please try again later.');
    return response.json();
  }
}

export async function service() {
  if (instance) return instance;
  if (reviewMode) {
    const {ReviewService} = await import('./review-service.js');
    instance = new ReviewService();
  } else if(uiPreview) {
    const {PreviewService}=await import('./preview-service.js');
    instance=new PreviewService();
    await instance.initialize();
  } else {
    const candidate = new PublicService();
    await candidate.initialize();
    instance = candidate;
  }
  return instance;
}

export async function branding() {
  if (reviewMode||uiPreview) return (await service()).branding();
  try {
    const response = await fetch('/api/branding', {cache:'no-store'});
    if (!response.ok) throw new Error('Branding unavailable');
    return await response.json();
  } catch { return {...BRAND}; }
}
