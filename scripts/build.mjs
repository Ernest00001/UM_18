import {mkdir,rm,cp,readFile,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {resolve,relative,isAbsolute,sep} from 'node:path';
const review=process.argv.includes('--review'),preview=process.argv.includes('--preview');
if(review&&preview)throw new Error('Choose only one preview mode.');
if((review||preview)&&process.env.VERCEL_ENV==='production')throw new Error((review?'Review':'UI preview')+' mode is forbidden in a production Vercel build.');
const output=preview?'.local/ui-preview':'dist',target=resolve(output),child=relative(process.cwd(),target);
if(!child||child==='..'||child.startsWith('..'+sep)||isAbsolute(child))throw new Error('Build output must remain inside the project.');
await rm(target,{recursive:true,force:true});await cp('public',target,{recursive:true});
await mkdir(output+'/assets/js/vendor',{recursive:true});await build({stdin:{contents:"export {createClient} from '@supabase/supabase-js';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',minify:true,outfile:output+'/assets/js/vendor/supabase.js',target:'es2022',legalComments:'eof'});
await build({stdin:{contents:"export {PDFDocument,rgb} from 'pdf-lib';export {default as fontkit} from '@pdf-lib/fontkit';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',minify:true,outfile:output+'/assets/js/vendor/pdf-engine.js',target:'es2022',legalComments:'eof'});
await writeFile(output+'/assets/js/runtime-mode.js',`export const RUNTIME_MODE='${preview?'preview':review?'review':'production'}';\n`);
if(review||preview){const fixture=await readFile(preview?'fixtures/empty-preview.js':'fixtures/review.js','utf8');await writeFile(output+'/assets/js/fixtures.js',fixture.replace("'../public/assets/js/domain.js'","'./domain.js'"));}else await rm(output+'/assets/js/review-service.js',{force:true});
if(!preview)await rm(output+'/assets/js/preview-service.js',{force:true});
if(!review&&!preview)await rm(output+'/assets/js/review-accountability.js',{force:true});
const publicHtml=await readFile('public/index.html','utf8'),adminHtml=await readFile('public/admin/index.html','utf8');
for(const route of ['register','confirmation','privacy','help','events','gallery']){await mkdir(output+'/'+route,{recursive:true});await writeFile(output+'/'+route+'/index.html',publicHtml);}await writeFile(output+'/404.html',publicHtml);
for(const route of ['login','profile','overview','office-reports','registrations','members','monthly','special','payments','expenses','events','welfare','contacts','documents','reports','branding','accounts','audit']){await mkdir(output+'/admin/'+route,{recursive:true});await writeFile(output+'/admin/'+route+'/index.html',adminHtml);}
// Only admin detail paths need a fallback. Vercel rewrites below exclude /api entirely.
await writeFile(output+'/robots.txt','User-agent: *\nDisallow: /admin/\n');
console.log(`Built ${preview?'EMPTY UI PREVIEW':review?'FICTIONAL REVIEW':'PRODUCTION'} vanilla frontend in ${output}. No server secrets are embedded.`);
