// El ACRM absorbió Cotizaciones: ya no es un módulo del menú, es una sección del ACRM.
//
// Esa mudanza tiene tres piezas que se pueden romper por separado y sin ruido:
//   · Cotizaciones sale de la barra lateral, pero NO del alcance: si se cayera también el permiso,
//     render() mandaría a otro módulo y la sección quedaría inalcanzable.
//   · La caja del módulo activo y el botón resaltado de la barra se resuelven por un id que traduce
//     «quotes» a «prospeccion». Sin esa traducción, mirar Cotizaciones mostraba el rótulo del
//     primer módulo de la lista —Pendientes— porque el find() no encontraba nada y caía al [0].
//   · La barra de dos pastillas tiene que estar en las dos pantallas; es el único camino de ida y
//     vuelta que queda.
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

// ── Las dos pastillas ──────────────────────────────────────────────────────
const contexto = {quotes: [], escapeHtml: (t) => String(t)};
vm.createContext(contexto);
vm.runInContext(extraer('acrmSecciones'), contexto);
const {acrmSecciones} = contexto;

let barra = acrmSecciones('prospeccion');
assert.match(barra, /data-acrm-seccion="prospeccion"/, 'la pastilla del embudo está');
assert.match(barra, /data-acrm-seccion="quotes"/, 'y la de cotizaciones también');
assert.match(barra, /class="acrm-seccion activa" type="button" data-acrm-seccion="prospeccion"/,
  'la sección en pantalla se marca activa');
assert.doesNotMatch(barra, /Cotizaciones \(/, 'sin cotizaciones cargadas no inventa un conteo');

contexto.quotes = new Array(22).fill({});
barra = acrmSecciones('quotes');
assert.match(barra, /Cotizaciones \(22\)/, 'con la lista cargada, la pastilla dice cuántas hay');
assert.match(barra, /class="acrm-seccion activa" type="button" data-acrm-seccion="quotes"/);
assert.doesNotMatch(barra, /class="acrm-seccion activa" type="button" data-acrm-seccion="prospeccion"/,
  'solo una activa a la vez');

// ── Fuera del menú, pero dentro del alcance ────────────────────────────────
const entrada = html.slice(html.indexOf('id: "quotes"'), html.indexOf('id: "quotes"') + 400);
assert.match(entrada, /oculto:\s*true/, 'la entrada de Cotizaciones está marcada como oculta');
assert.match(extraer('currentSuiteUserModules'), /filter\(\(module\) => !module\.oculto\)/,
  'la lista del menú deja fuera los módulos ocultos');
assert.match(extraer('suiteUserCanAccessModule'), /modules\.some\(\(module\) => module\.id === moduleId\)/,
  'el permiso se mira contra todos los módulos, no contra los visibles: si no, Cotizaciones sería inalcanzable');

// ── El rótulo de arriba y el botón resaltado ───────────────────────────────
const shell = extraer('shell');
assert.match(shell, /const idEnLaBarra = state\.active === "quotes" \? "prospeccion" : state\.active;/,
  'mirando Cotizaciones, el módulo activo sigue siendo el ACRM');
assert.match(shell, /visibleModules\.find\(\(module\) => module\.id === idEnLaBarra\)/,
  'la caja del módulo activo se resuelve por ese id');
assert.match(shell, /module\.id === idEnLaBarra \? "active" : ""/,
  'y el botón del ACRM queda resaltado mientras se ve su sección');

// ── La barra está en las dos pantallas ─────────────────────────────────────
const prospeccion = extraer('prospeccionModule');
const cotizaciones = extraer('quotesModule');
assert.match(prospeccion, /acrmSecciones\("prospeccion"\)/, 'la cola y el embudo la pintan');
assert.match(cotizaciones, /acrmSecciones\("quotes"\)/, 'la tabla de cotizaciones también');
assert.match(prospeccion, /wireAcrmSecciones\(\)/, 'y una engancha los clics');
assert.match(cotizaciones, /wireAcrmSecciones\(\)/, 'y la otra igual');
assert.match(extraer('wireAcrmSecciones'), /state\.active = boton\.dataset\.acrmSeccion/,
  'el clic cambia de sección');
assert.match(extraer('wireAcrmSecciones'), /saveActiveModule/,
  'y la sección elegida se recuerda al recargar');

console.log('PASS secciones del ACRM: Cotizaciones fuera del menú pero alcanzable, el rótulo y el botón siguen siendo el ACRM, y las dos pastillas están en ambas pantallas con el conteo real.');
