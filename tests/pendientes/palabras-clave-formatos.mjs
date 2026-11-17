// Palabras Clave, una marca por cuenta: cada cuenta de Google Ads exporta su informe con el idioma
// de su interfaz, y hasta ahora el lector solo entendía el de la agencia.
//
// Lo que pasó de verdad el 17/11/2026, al conectar las cuatro cuentas que Nexus ya escribe en Drive:
// Tierra Films y Aquarius no se podían leer («faltan columnas: cost») porque su informe dice
// «Coste» y no «Costo»; y Hers salía con un gasto de PEN 45.984 en vez de 459,84, porque su hoja
// está en español de España y exporta «8,29», que el lector tomaba por miles.
//
// Aquarius además trae «Interacciones» y «Clics» a la vez, y la buena es «Clics».
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const report = require('../../src/modules/analisis-palabras-clave/keyword-report.js');

const informe = (cabecera, filas) =>
  ['Informe de palabras clave de búsqueda', '1 de noviembre de 2026 - 17 de noviembre de 2026', cabecera, ...filas].join('\n');

// ── España: «Coste», «Impr.» y coma decimal ────────────────────────────────
const espana = report.parseReport(
  informe(
    'Estado de las palabras clave,Palabra clave,Tipo de concordancia,Campaña,Grupo de anuncios,Conversiones,Código de moneda,Coste,Impr.,CTR,Clics',
    [
      'Habilitado,vales de pavo,Concordancia amplia,CE | Search,AG2,"2,00",PEN,"8,29","1.091","10,99%",10',
      'Habilitado,canastas,Concordancia de frase,CE | Search,AG2,"0,00",PEN,"1.234,56","2.000","0,00%",0'
    ]
  ),
  {name: 'Hers KW noviembre 2026'}
).month;

assert.equal(espana.currency, 'PEN');
assert.equal(espana.keywords[0].cost, 8.29, 'con coma decimal, 8,29 son 8 soles con 29, no 829');
assert.equal(espana.keywords[0].impressions, 1091, 'el punto es separador de miles');
assert.equal(espana.keywords[0].clicks, 10);
assert.equal(espana.keywords[0].conversions, 2);
assert.equal(espana.keywords[1].cost, 1234.56, 'miles con punto y decimales con coma');
assert.equal(espana.keywords[1].impressions, 2000);

// ── Aquarius: «Interacciones» antes que «Clics» en el informe ──────────────
const aquarius = report.parseReport(
  informe(
    'Estado de las palabras clave,Palabra clave,Tipo de concordancia,Campaña,Grupo de anuncios,Impr.,Interacciones,Tasa de interacción,Código de moneda,Coste,Clics,Conversiones',
    ['Habilitado,inventarios,Concordancia amplia,Activo Fijo,Todos,"1.500",7,"0,47%",PEN,"12,40",4,"1,00"']
  ),
  {name: 'Aquarius KW noviembre 2026'}
).month;

assert.equal(aquarius.keywords[0].clicks, 4, 'manda la columna Clics, no Interacciones');
assert.equal(aquarius.keywords[0].impressions, 1500);
assert.equal(aquarius.keywords[0].cost, 12.4);

// ── La agencia, en inglés: sigue valiendo el arreglo de los miles de Sheets ─
const agencia = report.parseReport(
  informe(
    'Estado de la palabra clave,Palabra clave,Tipo de concordancia,Campaña,Grupo de anuncios,Clics,Impresiones,CTR,Código de moneda,Costo,Conversiones',
    ['Habilitado,seo,Concordancia amplia,Video Animado,VA2,315,"1,29",7.06%,USD,245.11,50']
  ),
  {name: 'Lima Retail Google Ads Noviembre 2026'}
).month;

assert.equal(agencia.currency, 'USD');
assert.equal(agencia.keywords[0].impressions, 1290, 'Sheets deja "1,290" como "1,29": se repone el cero');
assert.equal(agencia.keywords[0].cost, 245.11);
assert.equal(agencia.keywords[0].clicks, 315);

// ── Sin columna Campaña no hay informe que leer ────────────────────────────
// Es el caso de GLOBAL BEVERAGES (Excambiare): su destino en Nexus todavía no manda campaña ni
// grupo de anuncios, y este módulo se organiza por campaña. Tiene que decirlo, no inventarla.
assert.throws(
  () =>
    report.parseReport(
      informe('Estado de la palabra clave,Palabra clave,Tipo de concordancia,Conversiones,Código de moneda,Costo,Impresiones,CTR,Clics', [
        'Habilitado,espumante,Concordancia de frase,0.00,PEN,1.69,19,5.26%,1'
      ]),
      {name: 'GLOBAL BEVERAGES Keywords Noviembre 2026'}
    ),
  /no es un informe de palabras clave/
);

console.log(
  'PASS palabras clave por marca: «Coste» y la coma decimal se leen bien (8,29 son 8,29 y no 829), «Clics» gana a «Interacciones», la agencia en inglés no cambia y un informe sin campaña se rechaza.'
);
