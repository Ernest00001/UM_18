import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './dom-harness.mjs';
import {renderPayments} from '../public/assets/js/modules/finance.js';
test('advance-payment entry prefills the selected member and loads their published month assessments',async()=>{
 const {ctx,cleanup}=setup();try{const m=ctx.data.members[0],assessments=ctx.data.assessments.filter(a=>a.member_id===m.id);let requested;
 location.search='?new=1&member='+m.id;ctx.svc.memberAssessments=async id=>{requested=id;return assessments;};await renderPayments(ctx);
 assert.equal(requested,m.id);assert.equal(document.querySelector('[name=member_id]').value,m.id);assert.deepEqual(ctx.data.assessments,assessments);
 document.querySelector('#add-allocation').onclick();const options=[...document.querySelector('#allocations select').options].map(o=>o.value);for(const c of ctx.data.collections.filter(c=>c.status==='draft'))assert.ok(!options.includes(c.id));
 }finally{cleanup();}
});
test('a reader cannot open the payment recording form through its direct URL',async()=>{const {ctx,cleanup}=setup();try{location.search='?new=1';ctx.can=p=>p==='directory.read'||p==='finance.read';await renderPayments(ctx);assert.ok(ctx.container.textContent.includes('Access restricted'));assert.equal(document.querySelector('[name=amount]'),null);}finally{cleanup();}});
