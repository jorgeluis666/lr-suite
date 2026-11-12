// La paginación de la Tabla Maestra: una página de la tabla es una consulta al servidor, y cuántas
// filas trae la elige la persona (20, 50 o 100).
//
// Lo que se puede romper sin ruido:
//   · Que «Siguiente» avance aunque el servidor no tenga más, o que «Anterior» pase de la primera.
//   · Que un error de red deje la tabla apuntando a una página que no se pudo leer.
//   · Que el cambio de tamaño no vuelva a la primera página (se saltarían leads).
//   · Que dos clics seguidos disparen dos consultas.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
function source(name) {
  const start = html.indexOf('      function ' + name + '(');
  assert.ok(start >= 0, `no se encontró ${name}`);
  return html.slice(start, html.indexOf('\n      }', start) + 8);
}
const dom = new JSDOM(`<section class="acrm-leads">
  <select id="acrmLeadsPorPagina"><option value="20">20</option><option value="50">50</option><option value="100">100</option></select>
  <button id="acrmLeadsAnterior"></button><button id="acrmLeadsMas"></button></section>`);
const guardado = [];
const state = {lista: [], pagina: 0, porPagina: 20, hayMas: true, generacion: 0, cargando: false, error: ''};
let peticiones = 0, fallar = false, concurrente = false, desdeCeroUltimo = null;
const c = vm.createContext({
  document: dom.window.document,
  window: {localStorage: {setItem: (k, v) => guardado.push([k, v]), getItem: () => null}},
  ACRM_LEADS_TAMANOS: [20, 50, 100],
  ACRM_LEADS_TAMANO_CLAVE: 'lr-acrm-leads-por-pagina',
  acrmLeads: state,
  acrmLeadsPintar: () => {},
  acrmLeadsCargar: async ({desdeCero = true} = {}) => {
    state.generacion++;
    peticiones++;
    desdeCeroUltimo = desdeCero;
    if (desdeCero) state.pagina = 0;
    state.error = fallar ? 'Error de red' : '';
    if (concurrente) state.generacion++;
  }
});
vm.runInContext(source('acrmLeadsEnlazar') + ';acrmLeadsEnlazar()', c);
const clic = async (id) => { dom.window.document.getElementById(id).click(); await new Promise((r) => setImmediate(r)); };

// ── Avanzar y retroceder: cada página es una consulta ─────────────────────
await clic('acrmLeadsAnterior');
assert.deepEqual([state.pagina, peticiones], [0, 0], 'en la primera página, «Anterior» no hace nada');
await clic('acrmLeadsMas');
assert.deepEqual([state.pagina, peticiones, desdeCeroUltimo], [1, 1, false], '«Siguiente» pide la página siguiente, sin reiniciar');
await clic('acrmLeadsAnterior');
assert.deepEqual([state.pagina, peticiones], [0, 2], 'y «Anterior» vuelve a la de antes');

// ── Sin más páginas en el servidor, no se pide otra ───────────────────────
state.hayMas = false;
const antesDelTope = peticiones;
await clic('acrmLeadsMas');
assert.deepEqual([state.pagina, peticiones], [0, antesDelTope], 'sin «hayMas» no se avanza');
state.hayMas = true;

// ── Un error de red deja la tabla en la página que sí se leyó ─────────────
fallar = true;
await clic('acrmLeadsMas');
assert.equal(state.pagina, 0, 'si la lectura falla, se vuelve a la página anterior');
fallar = false;

// ── Un filtro que cambió durante la petición manda ────────────────────────
concurrente = true;
state.pagina = 0;
await clic('acrmLeadsMas');
assert.equal(state.pagina, 1, 'no se pisa la página de una carga más nueva');
concurrente = false;

// ── El tamaño lo elige la persona y se recuerda ───────────────────────────
state.pagina = 3;
const antes = peticiones;
const select = dom.window.document.getElementById('acrmLeadsPorPagina');
select.value = '100';
select.dispatchEvent(new dom.window.Event('change'));
await new Promise((r) => setImmediate(r));
assert.equal(state.porPagina, 100);
assert.deepEqual([peticiones, desdeCeroUltimo, state.pagina], [antes + 1, true, 0], 'cambiar el tamaño vuelve a la primera página');
assert.deepEqual(guardado, [['lr-acrm-leads-por-pagina', '100']], 'y la elección queda en este navegador');
select.dispatchEvent(new dom.window.Event('change'));
await new Promise((r) => setImmediate(r));
assert.equal(peticiones, antes + 1, 'elegir el mismo tamaño no vuelve a pedir');

// ── Mientras carga, no se duplican consultas ──────────────────────────────
state.cargando = true;
const enCurso = peticiones;
await clic('acrmLeadsMas');
await clic('acrmLeadsAnterior');
assert.equal(peticiones, enCurso, 'con una carga en curso, los botones no piden de nuevo');

// ── El tamaño guardado se lee al arrancar ─────────────────────────────────
const leer = vm.createContext({window: {localStorage: {getItem: () => '50'}}, ACRM_LEADS_TAMANOS: [20, 50, 100], ACRM_LEADS_TAMANO_CLAVE: 'lr-acrm-leads-por-pagina'});
vm.runInContext(source('acrmLeadsPorPaginaGuardada') + ';globalThis.n=acrmLeadsPorPaginaGuardada()', leer);
assert.equal(leer.n, 50, 'se recupera lo elegido la última vez');
const sinNada = vm.createContext({window: {localStorage: {getItem: () => '7'}}, ACRM_LEADS_TAMANOS: [20, 50, 100], ACRM_LEADS_TAMANO_CLAVE: 'x'});
vm.runInContext(source('acrmLeadsPorPaginaGuardada') + ';globalThis.n=acrmLeadsPorPaginaGuardada()', sinNada);
assert.equal(sinNada.n, 20, 'un valor raro guardado no rompe la tabla: 20 por defecto');

dom.window.close();
console.log('PASS ACRM: paginación por consulta, tope del servidor, errores, cargas concurrentes y el selector de 20 / 50 / 100 recordado.');
