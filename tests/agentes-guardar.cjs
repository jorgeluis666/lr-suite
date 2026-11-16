const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html','utf8');
const start = html.indexOf('async function agentesEscribir(');
const end = html.indexOf('// ── La lista', start);
function context() {
 const state = {agentesOcupado:'',agentesAviso:'',field:'claude-sonnet-5-5',
  ensureSharedPendingClient:()=>({}),render(){state.field='';},
  agentesCargarFicha:async()=>{},agentesCargar:async()=>{},
  agentesMotivo:()=> 'No se pudo guardar'};
 vm.createContext(state);vm.runInContext(html.slice(start,end),state);return state;
}
test('agent save reads edited model before rerender and blocks duplicate submission',async()=>{
 const c=context(); let sent,finish,calls=0;
 const first=c.agentesEscribir('alta',()=>{calls++;sent=c.field;return new Promise(r=>finish=r);},'Guardado');
 await c.agentesEscribir('alta',()=>{calls++;return Promise.resolve({});},'Duplicado');
 assert.equal(sent,'claude-sonnet-5-5');assert.equal(c.field,'');assert.equal(calls,1);
 finish({});await first;assert.equal(c.agentesAviso,'Guardado');assert.equal(c.agentesOcupado,'');
});
test('agent save reports transport failure and releases busy state',async()=>{
 const c=context();await c.agentesEscribir('ficha',async()=>{throw Error('network');},'Guardado');
 assert.equal(c.agentesAviso,'No se pudo guardar');assert.equal(c.agentesOcupado,'');
});
