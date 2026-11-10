import {JSDOM} from 'jsdom';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const dom=new JSDOM('<div id="lrAcrmResumen"></div><main id="panel"></main><div id="lrAcrmRanking"></div>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window;
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
// El marcador vive en la barra del título, como tabla: los rótulos del embudo se escriben una vez
// en la cabecera y cada canal es una fila, de capturado a ganado. El aviso de ritmo corto sigue
// ahí, que es lo único del indicador viejo que avisaba de un problema.
assert.equal(resumen.querySelector('#acrmMonth').type,'month');
assert.match(resumen.textContent,/Por debajo/);
const cabecera=[...resumen.querySelectorAll('.acrm-marcador thead th')].map(th=>th.textContent.trim());
assert.deepEqual(cabecera,['Canal','Capturados','Sin tocar','Contactados','Respondieron','Cotizados','Ganados','Cierre','Cotizado','Ganado'],
 'las columnas van en orden de embudo y los rótulos se escriben una sola vez');
const filas=[...resumen.querySelectorAll('.acrm-marcador tbody tr')].map(tr=>[...tr.children].map(c=>c.textContent.trim()));
assert.equal(filas.length,2,'una fila por canal');
assert.match(filas[0][0],/^LinkedIn/);
assert.equal(filas[0][1],'4de 10','los capturados llevan la meta debajo, no un rótulo repetido');
assert.equal(filas[0][2],'7','los sin tocar son columna, no una coletilla en el pie');
assert.deepEqual(filas[0].slice(3,7),['4','2','1','1']);
assert.equal(filas[0][7],'25%','el cierre de punta a punta: 1 ganado de 4 contactados');
assert.equal(filas[0][8],'—','sin monto cotizado la celda dice «—», no un hueco');
assert.equal(filas[0][9],'S/ 2,400');
// El salto entre pasos ya no ocupa sitio en la fila: va en el título de cada celda.
assert.equal([...resumen.querySelectorAll('.acrm-marcador tbody tr')][0].children[4].title,'50% del paso anterior',
 'la conversión de 4 contactados a 2 que respondieron');
// Meta Ads no movió nada este mes: sus nueve celdas quedan apagadas y la única que no lo está es
// el contacto sin tocar, que es justo lo accionable de esa fila.
assert.match(filas[1][0],/^Meta Ads/);
const metaAds=[...resumen.querySelectorAll('.acrm-marcador tbody tr')][1];
assert.equal(metaAds.querySelectorAll('td.cero').length,8,'los ceros no pesan como los datos');
assert.equal(metaAds.querySelectorAll('td:not(.cero)').length,1);
assert.equal(metaAds.querySelector('td:not(.cero)').textContent.trim(),'1','el sin tocar es lo único vivo de la fila');
// Con más de un canal se suma al pie; con uno solo sería repetir la misma fila.
const pie=[...resumen.querySelectorAll('.acrm-marcador tfoot th,.acrm-marcador tfoot td')].map(c=>c.textContent.trim());
assert.deepEqual(pie,['Total','4','8','4','2','1','1','25%','—','S/ 2,400']);
assert.equal(root.querySelectorAll('.acrm-marcador').length,0,'el marcador no ocupa sitio sobre la cola');
assert.match(root.textContent,/Por debajo del ritmo/);assert.match(root.textContent,/IA · Consulta pendiente/);
assert.equal(root.querySelectorAll('[data-edit]').length,1);assert.equal(root.querySelector('script'),null);
// El ranking cierra la página, en su propio contenedor.
const ranking=w.document.getElementById('lrAcrmRanking');
assert.equal(root.querySelectorAll('.acrm-ranking').length,0,'ya no está sobre la cola');
const fila=[...ranking.querySelectorAll('.acrm-ranking tbody tr')];
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
w.LRACRM.unmount();assert.equal(removed,1);assert.equal(resumen.textContent,'');assert.equal(ranking.textContent,'');w.close();console.log('PASS minimal UI: pacing, both owners, owner controls, escaped content, draft preservation, explicit AI failure, funnel in the title bar and ranking at the end, quote-to-lead matching by phone, and cleanup.');
