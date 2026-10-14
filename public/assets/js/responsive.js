export function bindExecutiveDrawer({sidebar,toggle,overlay,closeButton,document=globalThis.document,view=globalThis.window}){
 const media=view?.matchMedia?.('(max-width: 850px)')||{matches:false};let open=false;
 const sync=()=>{const visible=!media.matches||open;sidebar.classList.toggle('open',media.matches&&open);overlay.classList.toggle('open',media.matches&&open);sidebar.setAttribute('aria-hidden',String(!visible));sidebar.toggleAttribute('inert',!visible);toggle.setAttribute('aria-expanded',String(media.matches&&open));document.documentElement.classList.toggle('navigation-open',media.matches&&open);};
 const close=(focus=true)=>{open=false;sync();if(focus&&toggle.isConnected)toggle.focus();};
 const toggleMenu=()=>{if(!media.matches)return;open=!open;sync();if(open)(sidebar.querySelector('[aria-current=page]')||closeButton)?.focus();};
 const keydown=event=>{if(!media.matches||!open)return;if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key==='Tab'){const controls=[...sidebar.querySelectorAll('a[href],button:not([disabled])')];if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0]?.focus();}}};
 const changed=()=>{open=false;sync();},closeMenu=()=>close();toggle.addEventListener('click',toggleMenu);closeButton.addEventListener('click',closeMenu);overlay.addEventListener('click',closeMenu);sidebar.addEventListener('keydown',keydown);media.addEventListener?.('change',changed);sync();
 return ()=>{open=false;sync();media.removeEventListener?.('change',changed);document.documentElement.classList.remove('navigation-open');toggle.removeEventListener('click',toggleMenu);closeButton.removeEventListener('click',closeMenu);overlay.removeEventListener('click',closeMenu);sidebar.removeEventListener('keydown',keydown);};
}

export function revealExecutiveField(element,view=globalThis.window){
 if(!element?.isConnected||typeof view?.scrollBy!=='function'||view.visualViewport?.scale>1)return false;
 const viewport=view.visualViewport,offset=viewport?.offsetTop||0,height=viewport?.height||view.innerHeight;
 if(!Number.isFinite(height)||height<=80)return false;
 const rect=element.getBoundingClientRect(),dialog=element.closest('dialog[open]');
 if(dialog){const body=element.closest('.dialog-body');if(!body)return false;const bounds=body.getBoundingClientRect(),top=Math.max(offset+12,bounds.top+12),bottom=Math.min(offset+height-12,bounds.bottom-12),delta=rect.top<top?rect.top-top:rect.bottom>bottom?Math.min(rect.bottom-bottom,rect.top-top):0;if(Math.abs(delta)<1)return false;body.scrollBy?.({top:delta,left:0,behavior:'auto'});return true;}
 const header=element.ownerDocument.querySelector('.topbar'),bounds=header?.getBoundingClientRect(),top=Math.max(offset+16,bounds&&bounds.top<=offset+1?bounds.bottom+16:0),bottom=offset+height-24;
 const delta=rect.top<top?rect.top-top:rect.bottom>bottom?Math.min(rect.bottom-bottom,rect.top-top):0;if(!Number.isFinite(delta)||Math.abs(delta)<1)return false;
 view.scrollBy({top:delta,left:0,behavior:'auto'});return true;
}

export function bindExecutiveFieldScrolling(document=globalThis.document,view=globalThis.window){
 let frame;const request=view?.requestAnimationFrame?.bind(view)||((fn)=>setTimeout(fn,0)),cancel=view?.cancelAnimationFrame?.bind(view)||clearTimeout;
 const schedule=element=>{if(!element?.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea')||!element.closest('.workspace,.auth-wrap,dialog'))return;if(frame!==undefined)cancel(frame);frame=request(()=>{frame=undefined;revealExecutiveField(element,view);});};
 const updateViewport=()=>{const viewport=view?.visualViewport;if(viewport?.scale>1)return;const height=viewport?.height||view?.innerHeight;if(!Number.isFinite(height)||height<=0)return;document.documentElement.style.setProperty('--visible-viewport-height',height+'px');document.documentElement.style.setProperty('--visible-viewport-top',(viewport?.offsetTop||0)+'px');document.documentElement.classList.toggle('keyboard-visible',height<(view.innerHeight||height)-140);};
 const focus=event=>schedule(event.target),resize=()=>{updateViewport();schedule(document.activeElement);};updateViewport();document.addEventListener('focusin',focus);view?.visualViewport?.addEventListener?.('resize',resize);view?.addEventListener?.('resize',resize);
 return ()=>{if(frame!==undefined)cancel(frame);document.removeEventListener('focusin',focus);view?.visualViewport?.removeEventListener?.('resize',resize);view?.removeEventListener?.('resize',resize);};
}
