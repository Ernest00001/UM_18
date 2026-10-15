import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './dom-harness.mjs';
import {renderAuth} from '../public/assets/js/modules/auth.js';
import {renderAccounts} from '../public/assets/js/modules/settings.js';
import {database,role,action,OWNER,READER} from './database-harness.mjs';
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};

test('password reveal toggles the existing input without changing its value or submitting the form',async()=>{
 const {ctx,cleanup}=setup();try{ctx.review=false;ctx.user=null;await renderAuth(ctx.container,ctx,async()=>{});const field=document.querySelector('[name=password]'),toggle=document.querySelector('[data-password-target]');field.value='Isolated-test-password';assert.equal(field.type,'password');assert.equal(toggle.type,'button');assert.equal(toggle.getAttribute('aria-controls'),field.id);toggle.click();assert.equal(field.type,'text');assert.equal(field.value,'Isolated-test-password');assert.equal(toggle.getAttribute('aria-pressed'),'true');assert.equal(toggle.textContent,'Hide');toggle.click();assert.equal(field.type,'password');assert.equal(field.value,'Isolated-test-password');assert.equal(toggle.getAttribute('aria-label'),'Show password');}finally{cleanup();}
});

test('a successful password login opens the workspace directly without requesting a factor or an email',async()=>{
 const {ctx,cleanup}=setup();try{ctx.review=false;ctx.user=null;let signedIn,entered;ctx.svc.login=async(email,password)=>{signedIn={email,password};return {id:'executive',needs_mfa:false,needs_password:false,login_method:'password',permissions:['directory.read']};};for(const method of ['factors','enroll','verify','recover'])ctx.svc[method]=async()=>{throw new Error('No second verification step should run');};await renderAuth(ctx.container,ctx,user=>{entered=user;});const form=document.querySelector('#login-form');form.elements.email.value=' executive@example.invalid ';form.elements.password.value='Isolated-test-password';form.onsubmit({preventDefault(){}});await settle();assert.deepEqual(signedIn,{email:'executive@example.invalid',password:'Isolated-test-password'});assert.equal(entered.id,'executive');assert.equal(document.querySelector('#mfa-form'),null);}finally{cleanup();}
});

test('invitation password setup supports reveal, prevents duplicate submits and continues to the workspace',async()=>{
 const {ctx,cleanup}=setup();try{ctx.review=false;ctx.user={needs_password:true};ctx.svc.callback={mode:'invite'};let saved,entered,finish;ctx.svc.setPassword=password=>{saved=password;return new Promise(resolve=>{finish=resolve;});};ctx.svc.session=async()=>({id:'accepted',needs_mfa:false,needs_password:false,login_method:'password'});await renderAuth(ctx.container,ctx,user=>{entered=user;});const form=document.querySelector('#password-form'),button=form.querySelector('button.btn.primary');form.elements.password.value='New-isolated-password';document.querySelector('[data-password-target]').click();assert.equal(form.elements.password.type,'text');const pending=form.onsubmit({preventDefault(){}});assert.equal(button.disabled,true);assert.equal(saved,'New-isolated-password');finish();await pending;assert.equal(entered.id,'accepted');assert.equal(button.disabled,false);assert.equal(document.querySelector('#mfa-form'),null);}finally{cleanup();}
});

test('an invitation session without a completed password remains at password setup or sign-in',async()=>{
 const {ctx,cleanup}=setup();try{ctx.review=false;ctx.user={needs_password:true,invitation_pending:true,permissions:[]};await renderAuth(ctx.container,ctx,async()=>{throw new Error('Must not enter workspace');});assert.ok(document.querySelector('#login-form'));assert.equal(document.querySelector('#retry-invitation'),null);}finally{cleanup();}
});

test('password-only accounts no longer show the authenticator-reset management control',async()=>{
 const {ctx,cleanup}=setup();try{ctx.user.login_method='password';ctx.detailId=ctx.user.id;await renderAccounts(ctx);assert.equal(document.querySelector('#reset-account-mfa'),null);}finally{cleanup();}
});

test('password sessions at AAL1 retain permission, session and revocation protection',async t=>{
 const db=await database();t.after(()=>db.close());
 await role(db,'authenticated',OWNER,'aal1','password');let context=(await db.query('select public.current_context() d')).rows[0].d;assert.equal(context.needs_mfa,false);assert.equal(context.needs_password,false);assert.equal(context.login_method,'password');assert.ok(context.permissions.includes('accounts.write'));assert.ok((await db.query("select public.workspace_data('accounts') d")).rows[0].d.accounts.length);
 assert.equal((await db.query('select mfa_required from public.private_settings')).rows[0].mfa_required,false);
 await role(db,'authenticated',READER,'aal1','password');assert.equal((await db.query("select public.has_permission('directory.read') allowed")).rows[0].allowed,true);assert.equal((await db.query("select public.has_permission('accounts.write') allowed")).rows[0].allowed,false);
 for(const method of [null,'invite','recovery','otp']){await role(db,'authenticated',OWNER,'aal1',method);context=(await db.query('select public.current_context() d')).rows[0].d;assert.equal(context.needs_password,true);assert.equal(context.needs_mfa,false);assert.deepEqual(context.permissions,[]);await assert.rejects(db.query("select public.workspace_data('accounts')"),/Access denied/);}
 await role(db,'authenticated',OWNER,'aal1',null);await db.query("select set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('user_metadata',jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password')))))::text,false)");await assert.rejects(db.query("select public.workspace_data('accounts')"),/Access denied/);
 await role(db,'authenticated',OWNER,'aal1','password');await action(db,'save_account',{id:READER,display_name:'Revoked Executive',active:false,roles:['read_only'],permissions:[],reason:'Audited test of immediate access removal'});await role(db,'authenticated',READER,'aal1','password');await assert.rejects(db.query("select public.workspace_data('members')"),/Access denied/);
 await role(db,'anon',null);await assert.rejects(db.query('select public.current_context()'),/permission denied/);
});
