// Lote 7 de la auditoría, parte de Palabras Clave: cuando hay dos informes del mismo mes en la
// carpeta de Drive, ¿cuál gana?
//
// Antes se comparaban las fechas de modificación como texto aunque vinieran vacías. Con dos
// cadenas vacías ninguna es menor que la otra, así que ganaba la última de la carpeta —y el aviso
// en pantalla decía «se usa la modificada más recientemente», justo lo que no pasaba—.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const report = require('../../src/modules/analisis-palabras-clave/keyword-report.js');

const mes = (id, sourceFile, modifiedTime, clicks = 1) => ({
  id,
  label: id,
  sourceFile,
  driveFileId: sourceFile,
  modifiedTime,
  period: {},
  currency: 'USD',
  check: {label: '', ok: true, totals: {}, diff: 0},
  account: {cost: clicks},
  excluded: [],
  keywords: [{impressions: 10, clicks, cost: 1, conversions: 0}]
});

// Con fechas de verdad, manda la más reciente.
const conFechas = report.buildModel([
  mes('2026-10', 'Octubre.csv', '2026-11-01T10:00:00.000Z', 1),
  mes('2026-10', 'Octubre v2.csv', '2026-11-03T10:00:00.000Z', 2)
]);
assert.equal(conFechas.months.length, 1);
assert.equal(conFechas.months[0].sourceFile, 'Octubre v2.csv');
assert.equal(conFechas.duplicates[0].usado, 'Octubre v2.csv');
assert.equal(conFechas.duplicates[0].descartado, 'Octubre.csv');
assert.match(conFechas.duplicates[0].criterio, /recientemente/);

// Sin fechas, manda el que no es una copia. Antes ganaba el último de la lista, que es
// precisamente el que suele ser la copia.
const sinFechas = report.buildModel([
  mes('2026-10', 'Octubre.csv', '', 1),
  mes('2026-10', 'Copia de Octubre.csv', '', 2)
]);
assert.equal(sinFechas.months[0].sourceFile, 'Octubre.csv', 'la copia no puede ganar por ir última');
assert.equal(sinFechas.duplicates[0].descartado, 'Copia de Octubre.csv');
assert.match(sinFechas.duplicates[0].criterio, /copia/);

// Y da igual el orden en que lleguen.
const alReves = report.buildModel([
  mes('2026-10', 'Copia de Octubre.csv', '', 2),
  mes('2026-10', 'Octubre.csv', '', 1)
]);
assert.equal(alReves.months[0].sourceFile, 'Octubre.csv');

// Una fecha a medias no decide: se cae al nombre.
const mediaFecha = report.buildModel([
  mes('2026-10', 'Octubre.csv', '2026-11-01T10:00:00.000Z', 1),
  mes('2026-10', 'Copia de Octubre.csv', '', 2)
]);
assert.equal(mediaFecha.months[0].sourceFile, 'Octubre.csv');
assert.match(mediaFecha.duplicates[0].criterio, /copia/);

// Sin nada que distinga, se avisa igual y se queda la primera.
const empate = report.buildModel([
  mes('2026-10', 'Octubre.csv', '', 1),
  mes('2026-10', 'Octubre (1).csv', '', 2)
]);
assert.equal(empate.months[0].sourceFile, 'Octubre.csv');
assert.match(empate.duplicates[0].criterio, /primera de la carpeta/);

// Un mes sin repetir no genera aviso.
const limpio = report.buildModel([mes('2026-09', 'Septiembre.csv', '2026-10-01T10:00:00.000Z')]);
assert.equal(limpio.duplicates.length, 0);
assert.equal(limpio.defaultMonth, '2026-09');

console.log('PASS palabras clave: con fechas gana la más reciente, sin fechas gana la que no es copia sin importar el orden, y el aviso nombra las dos hojas.');
