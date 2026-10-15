// Independent of the app's modules so an interrupted module load has a way out.
(()=>{
 const loading=document.querySelector('[data-app-loader]');
 if(!loading)return;
 loading.minimumDisplayReady=new Promise(resolve=>setTimeout(resolve,1000));
 const showFailure=()=>{
  if(!loading.isConnected)return;
  loading.classList.add('failed');loading.setAttribute('aria-busy','false');
  loading.querySelector('[data-loading-message]').textContent='Loading is taking longer than expected. Check your connection and try again.';
  const actions=loading.querySelector('[data-loading-actions]');actions.hidden=false;
  actions.querySelector('button').onclick=()=>location.reload();
 };
 const timer=setTimeout(showFailure,20000);
 const observer=new MutationObserver(()=>{if(!loading.isConnected){clearTimeout(timer);observer.disconnect();}});
 observer.observe(loading.parentNode,{childList:true});
})();
