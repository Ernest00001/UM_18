import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {parseHTML} from 'linkedom';
import {build} from 'esbuild';import {setup} from './dom-harness.mjs';
test('both page shells show the accessible maroon 18 loader before their application modules',async()=>{
 for(const path of ['public/index.html','public/admin/index.html']){const html=await readFile(path,'utf8'),{document}=parseHTML(html),loader=document.querySelector('[data-app-loader]');assert.equal(loader.getAttribute('role'),'status');assert.equal(loader.getAttribute('aria-busy'),'true');assert.equal(loader.querySelector('.brand-loading-number').textContent,'18');assert.ok(loader.querySelector('[data-loading-actions]').hidden);assert.ok(html.indexOf('page-loading.js')<html.indexOf('type="module"'));}
 const css=await readFile('public/assets/css/page-loading.css','utf8');assert.ok(css.includes('background:#800000'));assert.ok(css.includes('prefers-reduced-motion:reduce'));
});
test('a stalled application offers a retry without continuing its spinner indefinitely',async()=>{
 const {document}=parseHTML(await readFile('public/index.html','utf8'));let callback,reloaded=false;const observers=[];
 class Observer{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}
 const source=await readFile('public/assets/js/page-loading.js','utf8');new Function('document','setTimeout','clearTimeout','MutationObserver','location',source)(document,fn=>{callback=fn;return 1;},()=>{},Observer,{reload(){reloaded=true;}});
 callback();const loader=document.querySelector('[data-app-loader]');assert.equal(loader.getAttribute('aria-busy'),'false');assert.ok(loader.classList.contains('failed'));assert.equal(loader.querySelector('[data-loading-actions]').hidden,false);loader.querySelector('button').onclick();assert.ok(reloaded);
});

test('the minimum display resolves at one second independently of the stalled-load retry',async()=>{
 const {document}=parseHTML(await readFile('public/index.html','utf8')),timers=new Map();
 class Observer{observe(){}disconnect(){}}
 const source=await readFile('public/assets/js/page-loading.js','utf8');new Function('document','setTimeout','clearTimeout','MutationObserver','location',source)(document,(fn,delay)=>{timers.set(delay,fn);return delay;},()=>{},Observer,{reload(){}});
 let ready=false;document.querySelector('[data-app-loader]').minimumDisplayReady.then(()=>ready=true);await Promise.resolve();assert.equal(ready,false);assert.ok(timers.has(1000));assert.ok(timers.has(20000));timers.get(1000)();await Promise.resolve();assert.equal(ready,true);assert.ok(!document.querySelector('[data-app-loader]').classList.contains('failed'));
});

test('public and executive pages retain the loader until its minimum display completes',async t=>{
 for(const area of ['public','admin'])await t.test(area,async()=>{
  const {ctx,cleanup}=setup();try{
   ctx.container.id=area==='public'?'public-app':'app';const shell=parseHTML(await readFile(area==='public'?'public/index.html':'public/admin/index.html','utf8'));ctx.container.innerHTML=shell.document.querySelector('[data-app-loader]').outerHTML;
   const loader=ctx.container.querySelector('[data-app-loader]');let release;loader.minimumDisplayReady=new Promise(resolve=>release=resolve);location.pathname=area==='public'?'/help/':'/admin/expenses/';
   globalThis.__loadingTestService={branding:async()=>ctx.brand,session:async()=>ctx.user,load:async()=>ctx.data,publicEvents:async()=>({events:[]})};
   const bundled=await build({entryPoints:['public/assets/js/'+(area==='public'?'public.js':'admin.js')],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'loading-service',setup(builder){builder.onResolve({filter:/^\.\/(public-service|service)\.js$/},()=>({path:'loading-service',namespace:'loading'}));builder.onLoad({filter:/.*/,namespace:'loading'},()=>({contents:'export const reviewMode=false,uiPreview=false;export async function service(){return globalThis.__loadingTestService;}export async function branding(){return globalThis.__loadingTestService.branding();}',loader:'js'}));builder.onResolve({filter:/vendor\//},args=>({path:args.path,external:true}));}}]});
   const starting=import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(loader.isConnected);assert.equal(ctx.container.querySelector('.public-header,.topbar'),null);release();await starting;assert.ok(!loader.isConnected);assert.ok(ctx.container.querySelector(area==='public'?'.public-header':'.topbar'));
  }finally{delete globalThis.__loadingTestService;cleanup();}
 });
});
