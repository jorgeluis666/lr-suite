 'use strict';
(() => {
 const origin='https://nexus.limaretail.com', channel='lr-suite-push';
 const $=id=>document.getElementById(id), status=$('status'),receipt=$('receipt');
 let popup,registration,subscription,key,context;const pending=new Map();
 const workerReady=navigator.serviceWorker?.register('./notifications-sw.js',{scope:'./',updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).then(async r=>{registration=r;subscription=await r.pushManager.getSubscription();return r;});
 workerReady?.catch(error=>status.textContent=error.message);
 function rpc(action,sub=subscription){
  if(!popup||popup.closed)return Promise.reject(Error('Vuelve a vincular tu cuenta.'));
  return new Promise((resolve,reject)=>{const id=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(Error('La vinculación no respondió. Inicia sesión en la ventana de Nexus y vuelve a vincular.'));},30000);pending.set(id,{resolve,reject,timer});popup.postMessage({channel,id,action,subscription:sub?.toJSON?sub.toJSON():sub},origin);});
 }
 async function hello(){
  try{const result=await rpc('hello');key=result.key;context=result.context;if(!key)throw Error('Servicio de envío no disponible.');await workerReady;const active=subscription&&(await rpc('status')).active;$('enable').disabled=false;$('test').disabled=!active;$('disable').disabled=!active;status.textContent=active?'LR Suite activa para tu cuenta: 06:15, 13:15 y 18:15 · Lima.':'Cuenta vinculada. Pulsa Permitir notificaciones de LR Suite.';window.focus();}
  catch(error){status.textContent=error.message;}
 }
 window.addEventListener('message',event=>{
  if(event.origin!==origin||event.source!==popup||event.data?.channel!==channel)return;
  if(event.data.ready){hello();return;}
  const item=pending.get(event.data.id);if(!item)return;pending.delete(event.data.id);clearTimeout(item.timer);event.data.ok?item.resolve(event.data):item.reject(Error(event.data.error||'No se pudo completar.'));
 });
 $('connect').addEventListener('click',()=>{popup=window.open(origin+'/notifications?client=lr-suite','lr-suite-notifications','popup,width=580,height=520');if(!popup){status.textContent='Permite la ventana de vinculación para continuar.';return;}status.textContent='Inicia sesión si Nexus lo solicita. Luego vuelve aquí y pulsa Vincular mi cuenta otra vez.';});
 $('enable').addEventListener('click',async()=>{
  $('enable').disabled=true;
  try{if(await Notification.requestPermission()!=='granted')throw Error('No se concedió el permiso de LR Suite.');await workerReady;const bytes=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-key.length%4)%4)),c=>c.charCodeAt(0));subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});const result=await rpc('subscribe');$('test').disabled=false;$('disable').disabled=false;status.textContent='Notificaciones de LR Suite activas. '+result.migration;}
  catch(error){status.textContent=error.message;}finally{$('enable').disabled=false;}
 });
 $('test').addEventListener('click',async()=>{ $('test').disabled=true;receipt.textContent='Esperando recepción en LR Suite…';try{await rpc('test');status.textContent='El proveedor aceptó la prueba. Esperando recepción en LR Suite.';}catch(error){status.textContent=error.message;}finally{$('test').disabled=false;}});
 $('local').addEventListener('click',async()=>{try{if(Notification.permission!=='granted')throw Error('Primero permite las notificaciones de LR Suite.');await workerReady;await registration.showNotification('LR Suite',{body:'Prueba local de notificaciones de LR Suite.',icon:new URL('./assets/lima-retail-logo.png',location.href).href,tag:'lr-suite-local',renotify:true});receipt.textContent='LR Suite pidió mostrar el aviso local. Confirma si apareció en Windows.';}catch(error){receipt.textContent=error.message;}});
 $('disable').addEventListener('click',async()=>{try{await rpc('unsubscribe');await subscription.unsubscribe();subscription=null;$('test').disabled=true;$('disable').disabled=true;status.textContent='Notificaciones desactivadas en este navegador.';}catch(error){status.textContent=error.message;}});
 navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='lr-suite-push-receipt')receipt.textContent=event.data.ok?'LR Suite recibió el Push a las '+new Date().toLocaleTimeString('es-PE',{timeZone:'America/Lima'})+' · Lima y el navegador aceptó mostrarlo. Confirma si apareció en Windows.':'LR Suite recibió el Push, pero no pudo mostrarlo: '+event.data.error;});
})();
