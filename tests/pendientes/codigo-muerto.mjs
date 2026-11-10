// Lote 18: lo que se borró tiene que seguir borrado, y las fotos tienen que seguir pesando poco.
//
// Eran unas 480 líneas que nadie ejecutaba pero que había que leer en un archivo de 27 mil, y un
// fondo de login de 1,45 MB que se bajaba hasta en el celular, donde el CSS lo esconde.
import {readFileSync, statSync} from 'node:fs';
import assert from 'node:assert/strict';

const raiz = new URL('../../', import.meta.url);
const html = readFileSync(new URL('index.html', raiz), 'utf8');

// ── El módulo de ManyChat ──────────────────────────────────────────────────
// No lo despachaba render() ni estaba en `modules`: no había forma de abrirlo, y seguía
// apuntando a mc_leads. Lo que sí vive es la lectura de leads de P&G, que es otra cosa.
for (const muerto of ['manychatModule', 'ensureManychatClient', 'renderManychatStatus',
  'manychatFullName', 'manychatEstadoBadge']) {
  assert.equal(html.includes(muerto), false, `${muerto} volvió al archivo`);
}
assert.ok(html.includes('.from("mc_leads")'), 'la lectura de leads de P&G sigue en pie: esa sí se usa');

// ── El select «Abril 2026 / Marzo 2026» de header() ────────────────────────
// Salía por defecto cuando no se pasaba accesorio. Las seis llamadas pasan uno, así que no se
// veía nunca; lo que sí hacía era confundir a quien leyera header().
assert.equal(html.includes('<option>Abril 2026</option>'), false);
const header = html.slice(html.indexOf('function header(title'), html.indexOf('function header(title') + 600);
assert.match(header, /\$\{accessory \|\| ""\}/);

// ── Los colores de ruta que nunca se guardaron ─────────────────────────────
// getStoredCriticalRouteColors() corría al construir `state`, antes de que existiera su
// constante: ReferenceError atrapado por el try, [] siempre. Y la clave no se escribía nunca.
for (const muerto of ['getStoredCriticalRouteColors', 'CRITICAL_ROUTE_COLORS_STORAGE_KEY',
  'criticalRouteColors', 'drawCriticalRouteArrows', 'scheduleCriticalRouteArrows',
  'criticalRoutesHtml', 'quoteDocumentCell', 'quoteDocumentHref',
  // La pantalla de Cotizaciones y su panel de desglose: desde el 10/11/2026 la cotización y su
  // desglose se editan en la ficha de cada lead (acrmLeadCotizacionHtml).
  'quotesModule', 'quoteDrawer']) {
  assert.equal(html.includes(muerto), false, `${muerto} volvió al archivo`);
}
// Lo que sí se usa no se fue por delante.
for (const vivo of ['criticalRouteColor', 'defaultCriticalRouteColors', 'isValidHexColor',
  'critical-route-swatch', 'critical-route-picker', 'acrmLeadCotizacionHtml', 'data-desglose-agregar']) {
  assert.ok(html.includes(vivo), `${vivo} hace falta y no está`);
}

// ── El CSS sin dueño ───────────────────────────────────────────────────────
// Una clase solo puede quedarse si alguien la escribe en algún sitio: en una plantilla, en un
// classList o en un querySelector. Si solo aparece como selector, no la ve nadie.
const soloSelector = (clase) => {
  const lineas = html.split('\n').filter((l) => l.includes(clase));
  return lineas.length > 0 && lineas.every((l) => /^\s*[.#\[][\w .,:>()[\]="'-]*\{?\s*,?\s*$/.test(l));
};
for (const clase of ['quote-pill', 'quote-link', 'critical-route-panel', 'critical-route-card',
  'critical-route-palette', 'task-bottom-row', 'user-list', 'user-row', 'utm-platform-badge']) {
  assert.equal(html.includes(`.${clase}`), false, `.${clase} no la usa nadie: no debería estar`);
  assert.equal(soloSelector(clase), false);
}

// ── Las fotos ──────────────────────────────────────────────────────────────
const pesa = (ruta) => statSync(new URL(ruta, raiz)).size;
assert.ok(pesa('assets/login-bg-1600.jpg') < 100 * 1024,
  `el fondo del login pasa de 100 KB: ${pesa('assets/login-bg-1600.jpg')} bytes`);
assert.ok(pesa('assets/lima-retail-logo-96.png') < 10 * 1024);
assert.ok(pesa('assets/favicon-32.png') < 5 * 1024);
// Un JPEG de verdad empieza con FF D8 FF; el anterior empezaba con la firma de un PNG pese a
// llamarse .jpg, que es justo por lo que pesaba treinta veces más.
const cabecera = readFileSync(new URL('assets/login-bg-1600.jpg', raiz)).subarray(0, 3);
assert.deepEqual([...cabecera], [0xff, 0xd8, 0xff], 'el fondo tiene que ser un JPEG de verdad');

assert.ok(html.includes('./assets/login-bg-1600.jpg'));
assert.ok(html.includes('./assets/favicon-32.png'));
assert.equal(html.includes('src="./assets/lima-retail-logo.png"'), false);
// Y en el celular, donde el fondo está oculto por CSS, ni se descarga.
const gate = html.slice(html.indexOf('function suiteGate('), html.indexOf('function suiteGate(') + 1400);
assert.match(gate, /matchMedia\("\(max-width: 768px\)"\)\.matches\) return;/);
assert.ok(gate.indexOf('matchMedia') < gate.indexOf('new Image()'), 'el corte va antes de la descarga');

console.log('PASS código muerto: ManyChat, el select de abril, los colores de ruta que nunca se guardaron y 25 reglas CSS sin dueño siguen fuera; el fondo del login es un JPEG real de 58 KB y el celular ya no lo descarga.');
