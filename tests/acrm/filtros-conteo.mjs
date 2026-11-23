// El número de leads que lleva cada filtro de la Tabla Maestra, dentro de su propio botón.
//
// Lo que se puede romper sin ruido:
//   · Que la cifra de un botón sea la de otro filtro: quien la lee decide dónde trabajar con ella.
//   · Que una base sin los conteos (o un conteo que falló) deje ceros en los botones en vez de
//     quedarse como antes: un «0» en «Sin tocar» dice que no hay cola, y es mentira.
//   · Que el número de «Seguimiento de Cotizaciones» aparezca antes de cargar las cotizaciones.
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
// La barra de filtros, tal como la escribe el módulo: así el test usa los mismos botones y las
// mismas marcas que la pantalla, no una copia.
const inicio = html.indexOf('<div class="acrm-leads-filtros">');
const fin = html.indexOf('<div id="acrmTablaLeads">', inicio);
assert.ok(inicio > 0 && fin > inicio, 'no se encontró la barra de filtros de la Tabla Maestra');
const FILTROS = [['todos', 'Todos'], ['nuevo', 'Sin tocar'], ['contactado', 'Contactados'],
  ['respondio', 'Respondieron'], ['cotizados', 'Con cotización'], ['ganado', 'Ganados']];
const acrmLeads = {filtro: 'todos', canal: '', busqueda: '', total: 0, conteos: null, conteosClave: ''};
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
const barra = vm.runInNewContext('`' + html.slice(inicio, fin) + '`', {ACRM_LEADS_FILTROS: FILTROS, acrmLeads, escapeHtml});

const dom = new JSDOM(`<section class="acrm-leads">${barra}</section>`, {url: 'https://example.test'});
const d = dom.window.document;
const quotes = [{id: 'a', estado: 'Enviado'}, {id: 'b', estado: 'Enviado'}, {id: 'c', estado: 'Aprobado'}, {id: 'd', estado: 'Perdido'}];
const cargaDiferida = {quotes: false};
const c = vm.createContext({
  document: d, window: dom.window, acrmLeads, quotes, cargaDiferida,
  quoteCerrada: (q) => ['Aprobado', 'Perdido'].includes(q.estado),
  fmtNumber: (n) => new Intl.NumberFormat('es-PE').format(n),
  leadsVisibles: () => true, acrmSeguimientoPintar: () => {}, acrmLeadsEnlazar: () => {}
});
c.window.LRACRMLeads = {};
vm.runInContext(source('acrmLeadsPintar'), c);
const pintar = () => vm.runInContext('acrmLeadsPintar()', c);
const pildora = (filtro) => d.querySelector(`[data-lead-filtro-n="${filtro}"]`);
const texto = (filtro) => (pildora(filtro).hidden ? null : pildora(filtro).textContent);

// Cada filtro de la barra tiene su marca, y ninguna muestra nada hasta que haya conteos.
assert.deepEqual(FILTROS.map(([id]) => Boolean(pildora(id))), FILTROS.map(() => true), 'cada filtro tiene dónde poner su número');
pintar();
assert.deepEqual(FILTROS.map(([id]) => texto(id)), FILTROS.map(() => null), 'sin conteos, los botones se quedan como antes');
assert.equal(d.getElementById('acrmSeguimientoN').hidden, true, 'y el de cotizaciones tampoco inventa un cero');

// Con los conteos puestos, cada botón lleva el suyo.
acrmLeads.conteos = {todos: 4433, nuevo: 4100, contactado: 220, respondio: 85, cotizados: 28, ganado: 9};
pintar();
const comoLaPantalla = (n) => vm.runInContext('fmtNumber', c)(n);
assert.deepEqual(FILTROS.map(([id]) => texto(id)), [4433, 4100, 220, 85, 28, 9].map(comoLaPantalla),
  'el número de cada botón es el de su propio filtro, con el separador de miles de la suite');
assert.equal(texto('todos'), '4,433', 'y los miles se separan, que son cuatro mil leads');
assert.ok(d.querySelector('[data-lead-filtro="nuevo"]').textContent.startsWith('Sin tocar'), 'el nombre del filtro sigue delante de la cifra');

// Un filtro que la base no supo contar vuelve a quedarse sin número, no en cero.
acrmLeads.conteos = {todos: 4433, nuevo: 4100};
pintar();
assert.equal(texto('ganado'), null, 'lo que no vino no se dibuja');
assert.equal(texto('todos'), comoLaPantalla(4433));
acrmLeads.conteos = null;
pintar();
assert.deepEqual(FILTROS.map(([id]) => texto(id)), FILTROS.map(() => null), 'si el conteo falla, los botones vuelven a su nombre a secas');

// «Seguimiento de Cotizaciones» cuenta las cotizaciones vivas, que es con lo que abre ese panel, y
// solo cuando ya están cargadas: la cifra no justifica bajar la hoja entera.
const seguimiento = () => (d.getElementById('acrmSeguimientoN').hidden ? null : d.getElementById('acrmSeguimientoN').textContent);
assert.equal(seguimiento(), null);
cargaDiferida.quotes = true;
pintar();
assert.equal(seguimiento(), '2', 'las aprobadas y las perdidas ya no están en seguimiento');
assert.match(d.getElementById('acrmSeguimientoN').title, /2 cotizaciones en seguimiento/);

dom.window.close();
console.log('PASS filtros-conteo: cada filtro de la Tabla Maestra lleva su número, sin conteos se queda como antes y el de cotizaciones solo sale con las cotizaciones cargadas.');
