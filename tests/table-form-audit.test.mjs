import test from 'node:test';import assert from 'node:assert/strict';
import {setup} from './dom-harness.mjs';import {table} from '../public/assets/js/ui.js';

test('table sorting, paging and Enter in search do not submit a surrounding dialog form',()=>{
 const {ctx,cleanup}=setup();try{
  ctx.container.innerHTML='<form id="parent"><div id="table"></div><button type="submit">Save</button></form>';const holder=document.querySelector('#table');
  table(holder,{rows:[{name:'Beta'},{name:'Alpha'},{name:'Gamma'}],columns:[{key:'name',label:'Name'}],pageSize:1});
  const check=()=>assert.ok([...holder.querySelectorAll('button')].every(button=>button.getAttribute('type')==='button'));check();
  holder.querySelector('[data-sort]').click();check();assert.equal(holder.querySelector('tbody td').textContent,'Alpha');
  holder.querySelector('[data-next]').click();check();assert.equal(holder.querySelector('tbody td').textContent,'Beta');
  holder.querySelector('[data-prev]').click();assert.equal(holder.querySelector('tbody td').textContent,'Alpha');
  const search=holder.querySelector('[type=search]');let prevented=false;search.onkeydown({key:'Enter',preventDefault(){prevented=true;}});assert.ok(prevented);search.value='Gamma';search.oninput({target:search});check();assert.equal(holder.querySelector('tbody td').textContent,'Gamma');assert.equal(document.querySelector('#parent>button').getAttribute('type'),'submit');
 }finally{cleanup();}
});
