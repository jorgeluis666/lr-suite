import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const dom=new JSDOM('<main id="root"></main>',{runScripts:'outside-only',url:'https://example.test'});
const w=dom.window;
let op=null,cb,removed=0;
const url='https://www.linkedin.com/in/test-profile';
const client={
 auth:{getUser:async()=>({data:{user:{id:'jorge'}}})},
 from(table){const q={select(){return this},order(){return this},eq(){return this},in(){return this},range(){return this},limit(){return this},then(resolve){resolve({data:table==='lr_pros_contactos_unificados'?[{nombre:'Ana',apellido:'Prueba',linkedin_url:url,aportado_por:'Diego'}]:table==='lr_pros_colaboradores'?[{usuario_id:'jorge',nombre:'Jorge'},{usuario_id:'diego',nombre:'Diego'}]:table==='lr_acrm_contactos'?(op?[op]:[]):[],count:1});}};return q;},
 channel(){const c={on(type,filter,fn){cb=fn;return this},subscribe(fn){queueMicrotask(()=>fn('SUBSCRIBED'));return this}};return c;},
 removeChannel(){removed++},
 async rpc(name,args){assert.equal(name,'lr_acrm_contactar');assert.equal(args.p_version,0);op={linkedin_url:url,estado:'reservado',responsable:'jorge',version:1};return {data:op};}
};
w.eval(readFileSync('../../src/modules/prospeccion/contactos-propios.js','utf8'));
const mod=w.LRProsContactosPropios,root=w.document.querySelector('#root');
const tick=()=>new Promise(r=>setTimeout(r,10));
mod.mount(root,client);await tick();
assert.match(root.textContent,/Reservar contacto/);
root.querySelector('[data-contact-action="reservar"]').click();await tick();
assert.match(root.textContent,/Ya envié el mensaje/);
op={...op,responsable:'diego'};cb();await tick();
assert.match(root.textContent,/En atención · Diego/);
assert.equal(root.querySelector('[data-contact-action]'),null);
op={...op,estado:'contactado',contactado_por:'diego',contactado_en:new Date().toISOString()};cb();await tick();
assert.match(root.textContent,/Contactado por Diego/);
assert.equal(mod.canonical('http://linkedin.com/in/TEST-profile/?trk=x'),url);
assert.equal(mod.canonical('ftp://www.linkedin.com/in/test-profile'),'');
mod.unmount();assert.equal(removed,1);
console.log('PASS: shared list, reservation action, other owner blocked, realtime contact attribution, URL normalization and subscription cleanup.');
w.close();

