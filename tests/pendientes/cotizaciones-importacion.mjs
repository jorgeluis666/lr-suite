// Lote 9 de la auditoría: la importación de cotizaciones no puede llevarse por delante la base.
// (Actualizada en noviembre de 2026: las cotizaciones viven en lr_acrm_cotizaciones.)
//
// El riesgo real: si la lectura inicial de Supabase fallaba, `quotes` quedaba en [] y una
// importación fusionaba contra una base vacía; además el respaldo se escribía con ese mismo [],
// así que se perdía también la única copia buena. Ahora la fusión relee la base del servidor y el
// respaldo no se escribe si viene vacío.
//
// Aquí se prueba la otra mitad: que importQuotesText rechace lo que no debería entrar.
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

const avisos = [];
const contexto = {
  console: {warn() {}, error() {}},
  JSON, Date, Number, String, Object, Array, Math, RegExp, isNaN,
  window: {alert: (m) => avisos.push(String(m))},
  // spreadsheetRowsFromText primero intenta leer el XLS que Excel guarda como HTML; sin tablas,
  // cae al camino de texto, que es el de un CSV/TSV y el que se prueba aquí.
  DOMParser: class {
    parseFromString() {
      return {querySelectorAll: () => []};
    }
  },
  newQuoteDefaults: () => ({}),
  parseImportedContacts: () => []
};
vm.createContext(contexto);
vm.runInContext(
  ['spreadsheetRowsFromText', 'normalizeXlsHeader', 'parseMoneyCell', 'importQuotesText'].map(extraer).join('\n'),
  contexto
);
const {importQuotesText} = contexto;
const limpiar = () => (avisos.length = 0);

// ── Lo que sí entra ────────────────────────────────────────────────────────
limpiar();
const bueno = importQuotesText(
  'ID\tServicio\tCliente\tMonto cotizado\n' +
  'cot-001\tGoogle Ads\tOskar Valle\t650\n' +
  'cot-002\tMeta Ads\tOtro Cliente\t900\n'
);
assert.equal(bueno.length, 2, 'un archivo correcto entra entero');
assert.equal(bueno[0].id, 'cot-001');
assert.equal(avisos.length, 0, 'y no avisa de nada');

// Sin columna ID pero con Cliente: las listas hechas a mano siguen funcionando.
limpiar();
const sinId = importQuotesText('Servicio\tCliente\n' + 'Google Ads\tCliente Nuevo\n');
assert.equal(sinId.length, 1, 'sin ID pero con Cliente se acepta');
assert.equal(avisos.length, 0);

// ── Lo que ya no entra ─────────────────────────────────────────────────────
limpiar();
assert.equal(importQuotesText('Nombre\tApellido\nJuan\tPerez\n').length, 0, 'otra tabla cualquiera no');
assert.match(avisos[0] || '', /Servicio/, 'y dice qué columnas hacen falta');

limpiar();
assert.equal(importQuotesText('Servicio\tCliente\nGoogle Ads\tX\u0000Y\n').length, 0, 'bytes nulos no');
assert.match(avisos[0] || '', /bytes nulos/);

limpiar();
const conIdRaro = importQuotesText(
  'ID\tServicio\tCliente\n' +
  'cot-001\tGoogle Ads\tUno\n' +
  '<script>\tMeta Ads\tDos\n'
);
assert.equal(conIdRaro.length, 0, 'un ID con caracteres raros cancela la importación entera');
assert.match(avisos[0] || '', /caracteres no permitidos/);
assert.match(avisos[0] || '', /\b3\b/, 'y dice en qué fila del archivo está');

// Los IDs legítimos con puntos, guiones y dos puntos siguen pasando.
limpiar();
assert.equal(importQuotesText('ID\tServicio\tCliente\nsheet-quote-01\tGoogle Ads\tUno\n').length, 1);
assert.equal(importQuotesText('ID\tServicio\tCliente\n2026.10:a_1\tGoogle Ads\tUno\n').length, 1);
assert.equal(avisos.length, 0);

// ── La fusión contra la base ───────────────────────────────────────────────
// Desde que el ACRM absorbió Cotizaciones, cada fila se guarda sola en lr_acrm_cotizaciones y ya
// no hay bloque que respaldar (tests/acrm/cotizaciones-ui.mjs prueba la fusión contra la base de
// verdad). Aquí se comprueba sobre el código que la importación relee la tabla antes de fusionar,
// que se cancela si no puede, y que nada vuelve a escribir el bloque JSON viejo.
const importar = extraer('handleQuoteImport');
assert.match(importar, /api\.cargar\(client\)/, 'la importación relee la base del servidor');
assert.match(importar, /la importación se canceló/, 'y se cancela si esa lectura falla');
assert.doesNotMatch(html, /key: "quotes"/, 'nadie escribe ya el bloque JSON de cotizaciones');

console.log('PASS importación de cotizaciones: columnas exigidas, bytes nulos e IDs raros rechazados con el número de fila, y la fusión relee la tabla en vez de pisarla.');
