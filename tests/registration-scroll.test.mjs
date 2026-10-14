import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './dom-harness.mjs';
import {revealRegistrationElement,bindRegistrationScrolling,mountRegistration} from '../public/assets/js/registration.js';

test('a field scrolls only when obscured, uses the visible keyboard viewport and respects reduced motion and zoom',()=>{
  const {ctx,cleanup}=setup();
  try{
    const control=document.createElement('input');ctx.container.append(control);let rect={top:200,bottom:246},reduced=false;
    control.getBoundingClientRect=()=>rect;
    const scrolls=[],view={innerHeight:800,visualViewport:{height:300,offsetTop:0,scale:1},matchMedia:()=>({matches:reduced}),scrollBy:options=>scrolls.push(options)};
    assert.equal(revealRegistrationElement(control,view),false);assert.equal(scrolls.length,0);
    rect={top:270,bottom:316};assert.equal(revealRegistrationElement(control,view),true);
    assert.deepEqual(scrolls.pop(),{top:36,left:0,behavior:'smooth'});
    reduced=true;view.visualViewport.offsetTop=100;rect={top:80,bottom:126};
    assert.equal(revealRegistrationElement(control,view),true);
    assert.deepEqual(scrolls.pop(),{top:-36,left:0,behavior:'auto'});
    view.visualViewport.scale=2;assert.equal(revealRegistrationElement(control,view),false);assert.equal(scrolls.length,0);
    delete view.visualViewport;delete view.matchMedia;rect={top:760,bottom:806};
    assert.equal(revealRegistrationElement(control,view),true);
    assert.deepEqual(scrolls.pop(),{top:26,left:0,behavior:'auto'});
    control.remove();assert.equal(revealRegistrationElement(control,view),false);
  }finally{cleanup();}
});

test('keyboard resize rechecks the focused field without changing focus or entries and detaches listeners on exit',()=>{
  const {ctx,cleanup}=setup();
  try{
    const form=document.createElement('form'),input=document.createElement('input');input.type='text';input.value='Retained member name';form.append(input);ctx.container.append(form);
    input.getBoundingClientRect=()=>({top:340,bottom:386});let focusCalls=0;input.focus=()=>{focusCalls++;};
    Object.defineProperty(document,'activeElement',{configurable:true,get:()=>input});
    const frames=new Map(),viewportListeners=new Map(),windowListeners=new Map(),scrolls=[];let frameId=0;
    const view={innerHeight:800,visualViewport:{height:800,offsetTop:0,scale:1,addEventListener:(name,fn)=>viewportListeners.set(name,fn),removeEventListener:(name,fn)=>{if(viewportListeners.get(name)===fn)viewportListeners.delete(name);}},addEventListener:(name,fn)=>windowListeners.set(name,fn),removeEventListener:(name,fn)=>{if(windowListeners.get(name)===fn)windowListeners.delete(name);},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>({matches:false}),scrollBy:options=>scrolls.push(options)};
    const flush=()=>{while(frames.size){const [id,fn]=frames.entries().next().value;frames.delete(id);fn();}};
    const scrolling=bindRegistrationScrolling(form,view);
    input.dispatchEvent(new window.Event('focusin',{bubbles:true}));flush();assert.equal(scrolls.length,0);
    view.visualViewport.height=320;viewportListeners.get('resize')();flush();
    assert.deepEqual(scrolls,[{top:86,left:0,behavior:'smooth'}]);
    input.value+=' while typing';input.dispatchEvent(new window.Event('input',{bubbles:true}));flush();
    assert.equal(scrolls.length,1);assert.equal(focusCalls,0);assert.equal(input.value,'Retained member name while typing');
    scrolling.destroy();assert.equal(viewportListeners.size,0);assert.equal(windowListeners.size,0);assert.equal(frames.size,0);
  }finally{cleanup();}
});

test('a rejected submission keeps its values and leaves focus on the highlighted field rather than moving to the phase title',async()=>{
  const {ctx,cleanup}=setup(),originalFocus=window.HTMLElement.prototype.focus;let focused,registration;
  try{
    window.HTMLElement.prototype.focus=function(){focused=this;};
    registration=mountRegistration(ctx.container,{brand:ctx.brand,review:true,getService:async()=>({register:async()=>{throw Object.assign(new Error('Check email'),{fields:{email:'Please review this email address.'}});}})});
    await registration.start();assert.ok(ctx.container.classList.contains('registration-open'));
    const form=document.querySelector('#registration'),field=name=>form.querySelector(`[name="${name}"]`),advance=()=>form.onsubmit({preventDefault(){}});
    for(const [name,value] of Object.entries({full_name:'Fictional Member',phone:'08012345678',city:'Uyo',country:'Nigeria'}))field(name).value=value;
    await advance();await advance();field('email').value='fictional@example.invalid';await advance();field('acknowledgement').checked=true;
    await advance();assert.equal(registration.phase(),2);assert.equal(focused,field('email'));
    assert.equal(field('email').getAttribute('aria-invalid'),'true');assert.equal(field('full_name').value,'Fictional Member');assert.equal(field('phone').value,'08012345678');
    assert.equal(form.querySelector('#phase-next').disabled,false);
  }finally{registration?.destroy();window.HTMLElement.prototype.focus=originalFocus;cleanup();}
});
