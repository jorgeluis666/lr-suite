import assert from 'node:assert/strict';import {parseEvents,validSignature} from '../../supabase/functions/acrm-meta/payload.ts';
const msg={from:'51999888777',id:'wamid.test',timestamp:'1793509200',type:'text',text:{body:'Quiero cotizar'},referral:{source_type:'ad',source_id:'ad-1'}};
const payload={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123456789'},contacts:[{wa_id:'51999888777',profile:{name:'Prueba'}}],messages:[msg]}}]}]};
const [event]=parseEvents(payload,'123456789');assert.equal(event.anuncio_id,'ad-1');assert.equal(event.nombre,'Prueba');assert.equal(parseEvents(payload,'999').length,0);
delete msg.referral;assert.equal(parseEvents(payload,'123456789')[0].anuncio_id,null);
const body=JSON.stringify(payload),secret='test-only';const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body)));const signature='sha256='+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
assert.equal(await validSignature(body,signature,secret),true);assert.equal(await validSignature(body+'x',signature,secret),false);assert.equal(await validSignature(body,null,secret),false);
console.log('PASS Meta: signed payload, tamper rejection, destination phone scoping, named contact matching, ad attribution and organic distinction.');
