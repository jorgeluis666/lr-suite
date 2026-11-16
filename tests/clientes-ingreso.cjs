const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../src/modules/clientes/ingreso.js');
const blank=()=>({nombre:'Cliente de prueba',responsable:'Operaciones',servicios:'Publicidad',objetivos:'Medir consultas',checklist:{}});
test('existing catalog is reused; several dashboards still produce one client',()=>{
 const rows=[{key:api.PREFIX+'repo-a',payload:blank(),updated_at:'2026-01-01T00:00:00Z'}];
 const result=api.catalog([{repo:'repo-a',cliente:'Cliente de prueba'},{repo:'repo-b',cliente:'Cliente de prueba'},{repo:'internal',cliente:'Lima Retail'}],rows);
 assert.equal(result.length,1);assert.equal(result[0].key,'repo-a');assert.equal(result[0].existing,true);
 assert.equal(api.catalog([],rows)[0].existing,false);
});
test('completion needs evidence; activation requires previous steps',()=>{
 const data=blank();data.checklist.alta={estado:'completo'};
 assert.throws(()=>api.validate(data),/evidencia/);
 data.checklist.alta.nota='Objetivos confirmados';
 assert.equal(api.validate(data).checklist.alta.estado,'completo');
 data.checklist.activacion={estado:'completo',nota:'Revisado'};
 assert.throws(()=>api.validate(data),/anteriores/);
 data.checklist.alta.estado='inventado';assert.throws(()=>api.validate(data),/Estado/);
});
test('unstarted client is never ready; names normalize to collision-safe keys',()=>{
 assert.equal(api.progress(blank()).done,0);assert.equal(api.progress(blank()).next,'Alta del cliente');
 assert.equal(api.newKey('  ACME Perú '),api.newKey('acme peru'));
 assert.throws(()=>api.newKey('💚'),/nombre/);
 assert.throws(()=>api.validate({...blank(),contacto:'a'.repeat(201)}),/contacto/);
});
function database() {
 const records=new Map();
 return {records,from(name){assert.equal(name,'lr_suite_private_data');let operation,body,filters=[];
  const q={update(v){operation='update';body=v;return q;},insert(v){operation='insert';body=v;return q;},eq(k,v){filters.push([k,v]);return q;},
   async select(){if(operation==='insert'){if(records.has(body.key))return {error:{code:'23505'}};records.set(body.key,structuredClone(body));return {data:[structuredClone(body)]};}
    const row=[...records.values()].find(r=>filters.every(([k,v])=>r[k]===v));if(!row)return {data:[]};Object.assign(row,structuredClone(body));return {data:[structuredClone(row)]};}};return q;
 }};
}
test('save persists one client and rejects stale tab without overwriting another edit',async()=>{
 const db=database();const first=await api.save(db,'repo-a',blank(),null);
 const second=await api.save(db,'repo-a',{...blank(),responsable:'Equipo B'},first);
 await assert.rejects(()=>api.save(db,'repo-a',{...blank(),responsable:'Equipo A'},first),/otra sesión/);
 assert.equal(db.records.get(api.PREFIX+'repo-a').payload.responsable,'Equipo B');
 await assert.rejects(()=>api.save(db,'repo-a',blank(),null),/otra sesión/);
 assert.notEqual(first.updated_at,second.updated_at);
});
test('permission failure does not report a save',async()=>{
 const db={from:()=>({insert:()=>({select:async()=>({error:{code:'42501'}})})})};
 await assert.rejects(()=>api.save(db,'new-client',blank(),null),/No se pudo guardar/);
});
