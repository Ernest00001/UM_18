import test from 'node:test';import assert from 'node:assert/strict';
import {setup} from './dom-harness.mjs';import {renderCollections} from '../public/assets/js/modules/collections.js';import {localMonthlySchedule} from '../public/assets/js/monthly-schedule.js';
test('View year visibly confirms the loaded year and exposes a recoverable loading state',async()=>{
 const {ctx,cleanup}=setup();try{ctx.monthlyYear=2026;ctx.svc.monthlySchedule=async options=>localMonthlySchedule(ctx.data,options);await renderCollections(ctx,'monthly');
 let finish;ctx.svc.monthlySchedule=options=>new Promise(resolve=>{finish=()=>resolve(localMonthlySchedule(ctx.data,options));});const form=document.querySelector('#monthly-year-form');document.querySelector('#monthly-year').value='2027';const pending=form.onsubmit({preventDefault(){},currentTarget:form});
 assert.equal(form.querySelector('button').disabled,true);assert.ok(document.querySelector('#monthly-schedule-status').textContent.includes('Loading dues for 2027'));assert.equal(document.querySelectorAll('[data-month]').length,0);
 finish();await pending;assert.equal(form.querySelector('button').disabled,false);assert.equal(document.querySelector('#monthly-year-title').textContent,'Dues across 2027');assert.ok(document.querySelector('#monthly-schedule-status').textContent.includes('Showing January–December 2027'));assert.equal(document.querySelector('[data-month]').dataset.month,'2027-01');
 ctx.svc.monthlySchedule=async()=>{throw new Error('Connection interrupted');};document.querySelector('#monthly-year').value='2028';await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(form.querySelector('button').disabled,false);assert.ok(document.querySelector('#monthly-schedule-error').textContent.includes('Connection interrupted'));
 }finally{cleanup();}
});
test('Find member reports an empty member list, restores its button after failure and supports successful retry',async()=>{
 const {ctx,cleanup}=setup();try{ctx.data.members=[];await renderCollections(ctx,'monthly');const form=document.querySelector('#monthly-member-form');form.querySelector('[name=query]').value='<b>missing</b>';
 ctx.svc.searchMembers=async()=>({rows:[],count:0});await form.onsubmit({preventDefault(){},currentTarget:form});const results=document.querySelector('#monthly-member-results');assert.ok(results.textContent.includes('Your member list is empty'));assert.ok(results.textContent.includes('<b>missing</b>'));assert.equal(results.querySelector('b'),null);
 ctx.svc.searchMembers=async()=>{throw new Error('Search temporarily unavailable');};await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(form.querySelector('button').disabled,false);assert.equal(form.querySelector('button').textContent,'Find member');assert.equal(results.textContent,'Search temporarily unavailable');
 ctx.svc.searchMembers=async()=>({rows:[{id:'member',full_name:'Audit match',member_no:'SET2018-999'}],count:1});await form.onsubmit({preventDefault(){},currentTarget:form});assert.ok(results.textContent.includes('1 match'));assert.ok(results.querySelector('[data-monthly-member]'));
 }finally{cleanup();}
});
