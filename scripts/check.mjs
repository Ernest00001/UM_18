import {readdir,readFile,stat} from 'node:fs/promises';import {spawnSync} from 'node:child_process';
async function files(dir){const result=[];for(const name of await readdir(dir)){const p=dir+'/'+name;if((await stat(p)).isDirectory())result.push(...await files(p));else result.push(p);}return result;}
let count=0;for(const p of [...await files('public'),...await files('server'),...await files('api'),...await files('scripts')].filter(p=>/\.(js|mjs)$/.test(p))){const r=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});if(r.status){process.stderr.write(r.stderr);process.exit(1);}count++;}
const html=await readFile('public/index.html','utf8');if(!html.includes('viewport'))throw new Error('Viewport missing');console.log(`Syntax verified for ${count} JavaScript modules.`);
