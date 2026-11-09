 'use strict';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch(_){}
 event.waitUntil((async()=>{
  let receipt={type:'lr-suite-push-receipt',ok:true};
  try{await self.registration.showNotification('LR Suite',{body:String(data.body||'Tienes una actualización disponible.'),icon:new URL('./assets/lima-retail-logo.png',self.location.href).href,badge:new URL('./assets/lima-retail-logo.png',self.location.href).href,tag:String(data.tag||'lr-suite-daily'),renotify:true,data:{url:new URL('./notifications.html',self.location.href).href}});}
  catch(error){receipt={type:'lr-suite-push-receipt',ok:false,error:String(error.name||'Error')};}
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){
   if(client.url.startsWith(self.registration.scope))client.postMessage(receipt);
  }
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const target=new URL('./notifications.html',self.location.href).href;
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){
   if(client.url.startsWith(self.registration.scope)){await client.navigate(target);return client.focus();}
  }
  return self.clients.openWindow(target);
 })());
});
