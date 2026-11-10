// El ACRM absorbió Cotizaciones: ya no es un módulo del menú sino una de las tres secciones del
// ACRM —Leads, Acciones y Cotizaciones—, y el módulo activo es siempre el ACRM.
//
// Lo que se puede romper por separado y sin ruido:
//   · Las pestañas: tienen que estar en las tres pantallas, marcar la que está a la vista y no
//     inventar un conteo de cotizaciones antes de tenerlas. Son el único camino entre secciones.
//   · Quien tenía «quotes» guardado como módulo activo (antes de la absorción) tiene que volver a
//     Cotizaciones dentro del ACRM, no caer en el primer módulo de la lista.
//   · La sección elegida se recuerda al recargar.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function extraer(nombre) {
  const inicio = html.indexOf(`function ${nombre}(`);
  assert.notEqual(inicio, -1, `no se encontró la función ${nombre}`);
  let i = html.indexOf('{', inicio);
  let nivel = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') nivel++;
    else if (html[i] === '}' && --nivel === 0) break;
  }
  return html.slice(inicio, i + 1);
}
function constante(nombre) {
  const inicio = html.indexOf(`const ${nombre} = `);
  assert.notEqual(inicio, -1, `no se encontró ${nombre}`);
  return html.slice(inicio, html.indexOf('\n      };', inicio) + 9);
}

// ── Las tres pestañas ──────────────────────────────────────────────────────
const contexto = {quotes: [], cargaDiferida: {quotes: false}, state: {acrmSeccion: 'leads'}};
vm.createContext(contexto);
vm.runInContext(extraer('acrmSeccionesHtml'), contexto);
let barra = contexto.acrmSeccionesHtml();
for (const id of ['leads', 'acciones', 'cotizaciones']) assert.match(barra, new RegExp(`data-acrm-seccion="${id}"`), `la pestaña ${id} está`);
assert.match(barra, /class="active" aria-selected="true" data-acrm-seccion="leads"/, 'la sección a la vista se marca activa');
assert.equal((barra.match(/class="active"/g) || []).length, 1, 'solo una activa a la vez');
assert.doesNotMatch(barra, /Cotizaciones<span data-acrm-cotizaciones-n> · /, 'sin cotizaciones cargadas no inventa un conteo');
contexto.quotes = new Array(22).fill({});
contexto.cargaDiferida.quotes = true;
contexto.state.acrmSeccion = 'cotizaciones';
barra = contexto.acrmSeccionesHtml();
assert.match(barra, /Cotizaciones<span data-acrm-cotizaciones-n> · 22</, 'con la lista cargada, dice cuántas hay');
assert.match(barra, /class="active" aria-selected="true" data-acrm-seccion="cotizaciones"/);

// ── Fuera del menú, de vuelta a su sección ─────────────────────────────────
assert.doesNotMatch(html.slice(html.indexOf('const modules = ['), html.indexOf('const modules = [') + 4000), /id: "quotes"/,
  'Cotizaciones ya no es un módulo de la barra');
const guardado = (clave, valor) => ({
  modules: [{id: 'prospeccion'}, {id: 'tasks'}],
  activeModuleStorageKey: 'lr-suite-active-module',
  acrmSeccionStorageKey: 'lr-suite-acrm-seccion',
  window: {localStorage: {getItem: (k) => ({[clave]: valor}[k] ?? null)}}
});
for (const [clave, valor, modulo, seccion] of [
  ['lr-suite-active-module', 'quotes', 'prospeccion', 'cotizaciones'],
  ['lr-suite-acrm-seccion', 'acciones', 'financial', 'acciones'],
  ['lr-suite-acrm-seccion', 'cualquier-cosa', 'financial', 'leads']
]) {
  const c = guardado(clave, valor);
  vm.createContext(c);
  vm.runInContext(`${constante('getStoredActiveModule')}\n${constante('getStoredAcrmSeccion')}`, c);
  assert.equal(vm.runInContext('getStoredActiveModule()', c), modulo, `${clave}=${valor}: módulo`);
  assert.equal(vm.runInContext('getStoredAcrmSeccion()', c), seccion, `${clave}=${valor}: sección`);
}

// ── Las pestañas están en las tres pantallas y la elección se recuerda ─────
for (const pantalla of ['prospeccionModule', 'quotesModule', 'acrmLeadsModule']) {
  const cuerpo = extraer(pantalla);
  if (pantalla === 'prospeccionModule') {
    assert.match(cuerpo, /state\.acrmSeccion === "cotizaciones"[\s\S]*quotesModule\(\)/, 'el ACRM despacha a Cotizaciones');
    assert.match(cuerpo, /state\.acrmSeccion === "leads"[\s\S]*acrmLeadsModule\(\)/, 'y a Leads');
  }
  assert.match(cuerpo, /acrmSeccionesHtml\(\)/, `${pantalla} pinta las pestañas`);
  assert.match(cuerpo, /enlazarSeccionesAcrm\(\)/, `${pantalla} engancha los clics`);
}
const abrir = extraer('abrirSeccionAcrm');
assert.match(abrir, /state\.active = "prospeccion"/, 'cambiar de sección deja el ACRM como módulo activo');
assert.match(abrir, /saveAcrmSeccion\(state\.acrmSeccion\)/, 'y la sección elegida se recuerda al recargar');

console.log('PASS secciones del ACRM: tres pestañas en las tres pantallas, una sola activa y con el conteo real, Cotizaciones fuera del menú pero de vuelta en su sección para quien la tenía guardada, y la elección se recuerda.');
