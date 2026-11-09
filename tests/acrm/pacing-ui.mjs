import {JSDOM} from 'jsdom';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const dom=new JSDOM('<div id="lrAcrmResumen"></div><main id="panel"></main>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window;
w.HTMLElement.prototype.scrollIntoView=()=>{};
let callbacks=[],removed=0;
const tasks=[{id:'1',responsable:'j',accion:'Escribir',vence_en:new Date().toISOString(),captura:'li:test',version:1,tipo:'seguimiento',lr_acrm_capturas:{nombre:'<script>bad()</script>',canal:'linkedin'}},{id:'2',responsable:'d',accion:'Responder',vence_en:new Date().toISOString(),captura:'wa:123456789:51999888777',version:1,tipo:'respuesta',prioridad_ia:90,motivo_ia:'Consulta pendiente',ia_en:new Date().toISOString(),lr_acrm_capturas:{nombre:'Lead',canal:'meta_whatsapp'}}];
const embudo=[{captura:'wa:123456789:51999888777',etapa:'respondio',version:2,cotizacion:null,monto:null}];
const marcador={mes:'2026-11',canales:[
 {canal:'linkedin',contactados:4,respondieron:2,cotizados:1,ganados:1,perdidos:0,monto_ganado:2400,sin_tocar:7},
 {canal:'meta_whatsapp',contactados:0,respondieron:0,cotizados:0,ganados:0,perdidos:0,monto_ganado:0,sin_tocar:1}],
 personas:[{usuario_id:'j',nombre:'Jorge',mensajes:9,prospectos:4,racha:3,cotizados:1,ganados:1},
 {usuario_id:'d',nombre:'Diego',mensajes:0,prospectos:0,racha:0,cotizados:0,ganados:0}]};
const capturas=[{clave:'wa:123456789:51999888777',nombre:'Lead',capturado_en:'2026-11-02T10:00:00Z',consulta:'Quiero cotizar'}];
const rows=t=>t==='lr_pros_colaboradores'?[{usuario_id:'j',nombre:'Jorge'},{usuario_id:'d',nombre:'Diego'}]:t==='lr_acrm_embudo'?embudo:t==='lr_acrm_capturas'?capturas:tasks;
const client={auth:{getUser:async()=>({data:{user:{id:'j'}}})},functions:{invoke:async()=>({error:{message:'Sin conexión Claude'}})},from(t){const q={select(){return this},eq(){return this},in(){return this},order(){return this},limit(){return this},then(fn){fn({data:rows(t)});}};return q;},rpc:async name=>({data:name==='lr_acrm_pacing'?[{canal:'linkedin',capturados:4,meta:10,esperados:6,faltan:6,por_dia:2},{canal:'meta_whatsapp',capturados:0,meta:0,desde_anuncio:0}]:name==='lr_acrm_marcador'?marcador:{ok:true}}),channel(){const c={on(e,f,cb){callbacks.push(cb);return this},subscribe(){return this}};return c;},removeChannel(){removed++}};
w.eval(readFileSync('../../src/modules/prospeccion/acrm-panel.js','utf8'));
const tick=()=>new Promise(r=>setTimeout(r,10));const root=w.document.querySelector('#panel'),resumen=w.document.querySelector('#lrAcrmResumen');
w.LRACRM.mount(root,client);await tick();
assert.match(resumen.textContent,/LinkedIn\s*4 \/ 10/);assert.match(resumen.textContent,/Por debajo/);assert.equal(resumen.querySelector('#acrmMonth').type,'month');
assert.match(root.textContent,/Por debajo del ritmo/);assert.match(root.textContent,/IA · Consulta pendiente/);
assert.equal(root.querySelectorAll('[data-edit]').length,1);assert.equal(root.querySelector('script'),null);
// Marcador: embudo por canal con la conversión entre pasos, ranking con racha y quién va ganando.
const pasos=[...root.querySelectorAll('.acrm-canal')][0];
assert.match(pasos.textContent,/LinkedIn · 7 sin tocar · S\/ 2,400 ganados/);
assert.match(pasos.textContent,/50%/,'de 4 contactados a 2 que respondieron');
const fila=[...root.querySelectorAll('.acrm-ranking tbody tr')];
assert.match(fila[0].textContent,/Jorge\s*va ganando/);assert.match(fila[0].textContent,/3 días/);
assert.match(fila[1].textContent,/sin racha/);
assert.equal(root.querySelectorAll('.acrm-etapa').length,1);
assert.match(root.querySelector('.acrm-etapa').textContent,/Respondió/);
// La foto que ve el agente: el lead de WhatsApp con su teléfono sacado de la clave, para que el
// index.html pueda emparejarlo con la cotización que lleva ese mismo número.
const foto=w.LRACRM.snapshot();
assert.equal(foto.leads.length,1);
assert.equal(foto.leads[0].telefono,'51999888777');
assert.equal(foto.leads[0].etapa,'respondio','la etapa del lead sale del embudo, no de la cola');
assert.equal(foto.leads[0].etapa_version,2);
// Emparejar cotizaciones con leads por teléfono, con el formato real del módulo de Cotizaciones:
// «+51 999 888 777» contra la clave wa:<phone_id>:51999888777.
const cotizaciones=[
 {id:'q-1',cliente:'Oskar Valle',contacto:'Oskar',servicio:'Gestión Google Ads',montoCotizado:650,fechaEnvio:'2026-11-03',telefono:'+51 999 888 777',estado:'Enviada',montoFacturado:0},
 {id:'q-2',cliente:'Otro',servicio:'Meta Ads',montoCotizado:9000,fechaEnvio:'2026-11-04',telefono:'+51 911 222 333',estado:'Enviada',montoFacturado:0},
 {id:'q-3',cliente:'Sin teléfono',montoCotizado:400,fechaEnvio:'2026-11-05',telefono:'',estado:'Enviada',montoFacturado:0}
];
const enlaces=w.LRACRM.enlacesConCotizaciones(cotizaciones);
assert.equal(enlaces.length,1,'solo engancha el teléfono que coincide; sin número no se adivina');
assert.equal(enlaces[0].id,'q-1');
assert.equal(enlaces[0].lead.captura,'wa:123456789:51999888777');
assert.equal(enlaces[0].sugerida,'cotizado');
assert.equal(enlaces[0].yaEsta,false,'el lead está en «respondió»: el salto sigue pendiente');
// Aprobada o facturada, el salto que toca es «ganado», no «cotizado».
assert.equal(w.LRACRM.enlacesConCotizaciones([{...cotizaciones[0],estado:'Aprobada'}])[0].sugerida,'ganado');
assert.equal(w.LRACRM.enlacesConCotizaciones([{...cotizaciones[0],montoFacturado:650}])[0].sugerida,'ganado');
assert.equal(w.LRACRM.enlacesConCotizaciones([]).length,0);
assert.equal(w.LRACRM.telefonoCorto('+51 949 037 970'),'949037970');
assert.equal(w.LRACRM.telefonoCorto('12345'),'','un número corto no empareja con nada');
root.querySelector('[data-edit]').click();const input=root.querySelector('[name="accion"]');input.focus();input.value='No perder este borrador';input.dispatchEvent(new w.Event('input',{bubbles:true}));callbacks[0]();await tick();assert.equal(root.querySelector('[name="accion"]').value,'No perder este borrador');
input.blur();root.querySelector('#acrmCancelEdit').click();root.querySelector('#acrmPrioritize').click();await tick();assert.match(root.textContent,/Sin conexión Claude/);assert.match(root.textContent,/Se conserva el orden anterior/);
w.LRACRM.unmount();assert.equal(removed,1);assert.equal(resumen.textContent,'');w.close();console.log('PASS minimal UI: pacing, both owners, owner controls, escaped content, draft preservation, explicit AI failure, marcador with funnel conversion and streaks, stage badge, quote-to-lead matching by phone, and cleanup.');
