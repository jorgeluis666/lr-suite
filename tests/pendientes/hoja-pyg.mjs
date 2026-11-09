// Lote 7 de la auditoría: lecturas de la hoja de Pérdidas y Ganancias a prueba de errores.
//
// El fallo gordo: una fecha con mes 13 (un tipeo, o una fecha en formato de EE. UU.) hacía que
// buildFinancialModel lanzara «Cannot read properties of undefined (reading 'charAt')» al buscar
// el nombre de ese mes. Nadie lo atrapaba, así que P&G se quedaba en «Cargando…» para los dos
// usuarios y Cotizaciones tampoco se dibujaba.
//
// Saca las funciones reales del index.html y las corre con una hoja de prueba.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function extraer(nombre) {
  const inicio = html.indexOf(`function ${nombre}(`);
  assert.notEqual(inicio, -1, `no se encontró la función ${nombre} en index.html`);
  let i = html.indexOf('{', inicio);
  let nivel = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') nivel++;
    else if (html[i] === '}' && --nivel === 0) break;
  }
  return html.slice(inicio, i + 1);
}

function constante(nombre) {
  const re = new RegExp(`const ${nombre} = (\\[[\\s\\S]*?\\]);`);
  const m = re.exec(html);
  assert.ok(m, `no se encontró ${nombre}`);
  return JSON.parse(m[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
}

const contexto = {
  console: {warn() {}, error() {}},
  JSON, Date, Number, String, Object, Array, Set, Map, Math, isNaN, RegExp,
  SHEET_MONTH_NAMES: constante('SHEET_MONTH_NAMES'),
  SHEET_MONTH_SHORT: constante('SHEET_MONTH_SHORT')
};
vm.createContext(contexto);
vm.runInContext(
  ['normalizeText', 'parseSheetCsv', 'sheetNumber', 'sheetDate', 'sheetMonthNumber', 'sheetTable', 'buildFinancialModel']
    .map(extraer).join('\n'),
  contexto
);
const {sheetNumber, sheetDate, buildFinancialModel} = contexto;

// ── Fechas ─────────────────────────────────────────────────────────────────
assert.equal(sheetDate('19/01/2026'), '2026-01-19');
assert.equal(sheetDate('10/13/2026'), '', 'mes 13: no hay mes trece');
assert.equal(sheetDate('05/00/2026'), '', 'mes 00 tampoco');
assert.equal(sheetDate('32/01/2026'), '', 'día 32 tampoco');
assert.equal(sheetDate(''), '');

// ── Números ────────────────────────────────────────────────────────────────
assert.equal(sheetNumber('S/ 5,600.00'), 5600);
assert.equal(sheetNumber('(1,200.00)'), -1200, 'los paréntesis son el negativo de contabilidad');
assert.equal(sheetNumber('S/ (1,200.00)'), -1200);
assert.equal(sheetNumber('−450'), -450, 'menos tipográfico');
assert.equal(sheetNumber('–450'), -450, 'raya');
assert.equal(sheetNumber('-450'), -450);
assert.equal(sheetNumber('S/ -'), 0, 'el guion contable es cero, no una celda vacía');
assert.equal(sheetNumber('-'), 0);
assert.equal(sheetNumber('1.200,50'), null, 'formato europeo: mejor nada que un número equivocado');
assert.equal(sheetNumber('23.5%'), 23.5);
assert.equal(sheetNumber(''), null);
assert.equal(sheetNumber('2026-01'), null, 'un guion en medio no es un signo');

// ── La hoja entera ─────────────────────────────────────────────────────────
const hoja = (ventas, inversion = '', resultados = '') => ({
  tabs: {ventas, inversion, resultados},
  syncedAt: '2026-11-09T11:00:00Z'
});
const cabecera = 'Fecha,Mes,Cliente,Servicio,Monto base,Meses,Facturacion,Estado';

const conFechaMala = buildFinancialModel(hoja(
  `Resultados 2026\n${cabecera}\n` +
  '19/01/2026,Enero,Cliente A,Google Ads,1000,1,1000,Pagado\n' +
  '10/13/2026,,Cliente B,Meta Ads,500,1,500,Pagado\n'
));
assert.equal(conFechaMala.invalidDates, 1, 'la fila con mes 13 se cuenta');
assert.ok(conFechaMala.months.length, 'y el modelo se construye igual');
assert.ok(conFechaMala.months.every((m) => m.label && !m.label.includes('undefined')),
  'ningún mes se queda sin nombre');

// Ventas de otro año: se descartan, pero ahora se dicen.
const otroAnio = buildFinancialModel(hoja(
  `Resultados 2026\n${cabecera}\n` +
  '19/01/2026,Enero,Cliente A,Google Ads,1000,1,1000,Pagado\n' +
  '05/02/2027,,Cliente C,Google Ads,800,1,800,Pagado\n'
));
assert.equal(otroAnio.year, 2026);
assert.equal(otroAnio.otherYears.count, 1);
assert.equal(otroAnio.otherYears.billed, 800);

// Fila Total en Inversion: no es una plataforma más.
const conTotal = buildFinancialModel(hoja(
  `Resultados 2026\n${cabecera}\n19/01/2026,Enero,A,Google Ads,1000,1,1000,Pagado\n`,
  'Inversion 2026\nPlataforma,Periodo,Moneda,Inversion origen,TC,Inversion en PEN,Resultado principal,Resultados\n' +
  'Google Ads,2026,USD,100,3.7,370,Clics,500\n' +
  'Meta Ads,2026,PEN,,,130,Mensajes,80\n' +
  'Total,,,,,500,,\n' +
  'Nota: el TC es el promedio del año,,,,,,,\n'
));
// Se comparan como texto: los arrays salen del contexto aislado y deepStrictEqual se queja del
// prototipo aunque el contenido sea idéntico.
assert.equal(conTotal.platforms.map((p) => p.name).join(' | '), 'Google Ads | Meta Ads',
  'ni el Total ni la nota entran como plataforma');
assert.equal(conTotal.platforms.reduce((t, p) => t + p.amount, 0), 500, 'la inversión no se duplica');

console.log('PASS hoja P&G: fechas imposibles descartadas y contadas, negativos y guion contable, formato europeo rechazado, ventas de otro año avisadas, fila Total de Inversion ignorada.');
