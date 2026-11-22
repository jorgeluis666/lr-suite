import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const js=readFileSync(new URL('../../src/modules/prospeccion/acrm-rubros.js',import.meta.url),'utf8');
const dom=new JSDOM('<details id="rubros"><summary>Rubros</summary><div data-rubros-body></div></details>',{runScripts:'outside-only'});
dom.window.eval(js);const api=dom.window.LRACRMRubros,plain=x=>JSON.parse(JSON.stringify(x));
const companies=[['Dominio clave','Segmento','Rubro'],['a.pe','','Tecnología'],['b.pe','','Moda'],['c.pe','','Moda'],['d.pe','',''],['e.pe','','Salud'],['a.pe','','Tecnología']];
const hist=[['Fecha de corte','Dominio','Google','Precisión','Link','Meta','Estado'],
 ['19/11/2026','a.pe',200,'Exacto','',20,'Aproximado'],['21/11/2026','a.pe',4,'Exacto','',5,'Aproximado'],
 ['21/11/2026','b.pe',0,'Exacto','',null,'Sin verificar'],['21/11/2026','c.pe',6,'Exacto','',null,'Página por validar'],
 ['21/11/2026','d.pe',0,'Exacto','',0,'Sin resultados'],['21/11/2026','ajeno.pe',20,'Exacto','',40,'Aproximado']];
const sample=api.publicidad(companies,hist);
assert.equal(sample.series.ambas.total,2,'un anunciante aunque tenga muchos anuncios o aparezca en ambas plataformas');
assert.equal(sample.series.google.total,2);assert.equal(sample.series.meta.total,1);
assert.equal(sample.cobertura.empresas,5);assert.equal(sample.cobertura.sinVerificar,1);assert.equal(sample.cobertura.parciales,2);assert.equal(sample.cobertura.sinAnuncios,1);assert.equal(sample.cobertura.fueraCatalogo,1);
const unknown=api.publicidad(companies,[...hist,['22/11/2026','a.pe',null,'Sin verificar','',null,'Sin verificar']]);
assert.equal(unknown.series.ambas.total,1,'no recicla un corte antiguo cuando el último no está verificado');
assert.throws(()=>api.publicidad(companies,[hist[0],['fecha mala','a.pe',3,'Exacto']]),/Fecha/);
assert.deepEqual(plain(api.agrupar([{rubro:'  Tecnología  '},{rubro:'tecnologia'},{rubro:''},{rubro:null},{rubro:' — '}])).map(r=>r.valor),[3,2]);
let calls=0;
const rows=Array.from({length:1201},(_,i)=>({clave:String(i).padStart(5,'0'),rubro:i<1000?'':i<1200?'Retail':'<img src=x onerror=alert(1)>'}));
const client={from(table){assert.equal(table,'lr_acrm_capturas');return {select(cols,opts){assert.equal(cols,'clave,rubro');assert.equal(opts.count,'exact');return this;},order(key){assert.equal(key,'clave');return this;},async range(start,end){calls++;return {data:rows.slice(start,Math.min(end+1,start+200)),count:rows.length};}};}};
const crm=await api.leerCrm(client);assert.equal(crm.total,1201);assert.equal(calls,7,'continúa aunque el servidor limite la respuesta a menos de 500');
assert.equal(crm.rubros.find(r=>r.rubro==='Sin rubro').valor,1000);
const faulty={from(){return {select(){return this},order(){return this},range(){return Promise.resolve({data:[],count:2})}}}};
await assert.rejects(api.leerCrm(faulty),/incompleta/);
let page=0;
const changing={from(){return {select(){return this},order(){return this},range(){return Promise.resolve({data:[{clave:String(page++),rubro:'A'}],count:page===1?2:3})}}}};
await assert.rejects(api.leerCrm(changing),/cambió/);
assert.equal(await api.leerCrm(client,()=>false),null,'descarta lecturas de una vista desmontada');
const pie=api.pie(crm,'leads');
assert.ok(pie.includes('Sin rubro'));assert.ok(pie.includes('&lt;img'));
dom.window.document.querySelector('[data-rubros-body]').innerHTML=pie;
assert.equal(dom.window.document.querySelector('img'),null);
assert.equal(dom.window.document.querySelectorAll('svg').length,1);
assert.match(api.pie({total:1,rubros:[{rubro:'Sin rubro',valor:1}]},'leads'),/<circle/);
assert.doesNotMatch(api.pie({total:0,rubros:[]},'leads'),/<svg/);
let reads=0;
const db={from(table){reads++;if(table==='lr_acrm_capturas')return client.from(table);return {select(){return this},eq(){return this},async maybeSingle(){return {data:{payload:sample}}}};}};
const root=dom.window.document.querySelector('details');api.mount(root,db);
assert.equal(reads,0,'no descarga el CRM hasta desplegar');
root.open=true;root.dispatchEvent(new dom.window.Event('toggle'));
await new Promise(r=>setTimeout(r,40));
assert.equal(root.querySelectorAll('svg').length,2);
assert.equal(root.querySelector('img'),null);
const before=reads;root.open=false;root.open=true;root.dispatchEvent(new dom.window.Event('toggle'));
await new Promise(r=>setTimeout(r,20));assert.equal(reads,before,'reabrir usa el corte cargado');
const select=root.querySelector('select');select.value='meta';select.dispatchEvent(new dom.window.Event('change'));
assert.match(root.textContent,/1 anunciantes únicos/);assert.equal(reads,before,'el selector no repite lecturas');
root.querySelector('[data-rubros-refresh]').click();await new Promise(r=>setTimeout(r,40));assert.ok(reads>before);
if(process.env.CRM_RUBROS_PREVIEW){
 const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8'),css=readFileSync(new URL('../../src/modules/prospeccion/acrm-rubros.css',import.meta.url),'utf8');
 const base=html.slice(html.indexOf('<style>'),html.indexOf('</style>')+8);
 writeFileSync('/tmp/crm-rubros-preview.html','<!doctype html><meta charset="utf-8">'+base+'<style>'+css+'</style><main style="padding:24px"><section class="module acrm-leads"><details class="panel acrm-rubros" open><summary>Análisis de rubros <span>Distribución del CRM y anunciantes en Google / Meta</span></summary>'+root.querySelector('[data-rubros-body]').outerHTML+'</details><div class="panel" style="padding:16px">Tabla Maestra de Leads</div></section></main>');
}
api.unmount();dom.window.close();
console.log('PASS rubros: CRM completo, datos faltantes, límites de servidor, cambios concurrentes, anunciantes únicos, cortes/estados, XSS, carga diferida, filtro y actualización.');
