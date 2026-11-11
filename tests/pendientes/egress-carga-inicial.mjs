// Lote 10, lo que faltaba: dejar de pagar por traer y subir lo mismo todos los días.
//
//   · El historial de completadas se bajaba ENTERO en cada carga, sin tope. Cada tarea cerrada
//     que se acumula lo hace más pesado, y se paga en egress aunque no haya cambiado nada.
//   · Y al terminar de cargar se subía el tablero entero SIEMPRE, aunque no se hubiera tocado una
//     coma: abrir la suite por la mañana y no hacer nada costaba una escritura completa.
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

// ── El historial, ejecutado contra una tabla de mentira ───────────────────
// 2.500 registros archivados, para que la paginación tenga algo que paginar.
const archivados = Array.from({length: 2500}, (_, i) => ({
  payload: {completedRecordId: `r-${i}`, title: `Tarea ${i}`},
  archived_at: `2026-${String(1 + Math.floor(i / 300)).padStart(2, '0')}-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`
}));
archivados.sort((a, b) => (a.archived_at < b.archived_at ? -1 : 1));

function montarHistorial(marcaInicial) {
  const consultas = [];
  const almacen = {'lr-suite-history-archived-at': marcaInicial};
  const cliente = {
    from() {
      const filtro = {desde: null};
      const q = {
        select() { return q; },
        eq() { return q; },
        gt(_col, valor) { filtro.desde = valor; return q; },
        order() { return q; },
        async range(desde, hasta) {
          const todos = filtro.desde ? archivados.filter((r) => r.archived_at > filtro.desde) : archivados;
          const trozo = todos.slice(desde, hasta + 1);
          consultas.push({desde: filtro.desde, filas: trozo.length});
          return {data: trozo, error: null};
        }
      };
      return q;
    }
  };
  const contexto = {
    String, Array, JSON, Number, console,
    sharedPendingAvailable: true,
    sharedPendingClient: cliente,
    SHARED_PENDING_HISTORY_TABLE: 'lr_suite_pending_history',
    SHARED_PENDING_APP_ID: 'lr-suite-pending',
    COMPLETED_STORAGE_KEY: 'completadas',
    completedTasks: [],
    mergeCompletedTaskHistory: (...fuentes) => fuentes.flat().filter(Boolean),
    writeStoredJson: () => {},
    window: {localStorage: {getItem: (k) => almacen[k] ?? null, setItem: (k, v) => (almacen[k] = v)}}
  };
  vm.createContext(contexto);
  vm.runInContext(
    // La constante de la clave vive fuera de la función; sin ella, getItem/setItem irían a
    // «undefined» y la marca nunca se guardaría.
    [(html.match(/^\s*const HISTORY_WATERMARK_KEY = "[^"]+";$/m) || [])[0],
      extraer('loadArchivedCompletedTasks'),
      'globalThis.leerMarca = () => window.localStorage.getItem(HISTORY_WATERMARK_KEY);'].join('\n'),
    contexto
  );
  return {contexto, consultas};
}

// Primera vez: no hay marca, se trae todo paginando de mil en mil.
let {contexto: c, consultas} = montarHistorial(null);
await c.loadArchivedCompletedTasks();
assert.equal(consultas.length, 3, '2.500 registros son tres páginas de mil');
assert.equal(consultas.every((q) => q.desde === null), true, 'la primera vez no se filtra por fecha');
assert.equal(c.completedTasks.length, 2500);
const marca = c.leerMarca();
assert.equal(marca, archivados.at(-1).archived_at, 'la marca queda en el archived_at más alto leído');

// Segunda carga, sin nada nuevo: una sola consulta y cero registros.
({contexto: c, consultas} = montarHistorial(marca));
await c.loadArchivedCompletedTasks();
assert.equal(consultas.length, 1, 'una consulta, no tres');
assert.equal(consultas[0].filas, 0, 'y no baja ni un registro: antes bajaba los 2.500');
assert.equal(consultas[0].desde, marca, 'pidió solo lo posterior a la marca');

// Con algo nuevo, se trae solo eso.
archivados.push({payload: {completedRecordId: 'r-nuevo', title: 'Recién cerrada'}, archived_at: '2026-12-31T23:59:59.000Z'});
({contexto: c, consultas} = montarHistorial(marca));
await c.loadArchivedCompletedTasks();
assert.equal(consultas[0].filas, 1, 'solo el registro nuevo');
assert.equal(c.completedTasks.length, 1);
assert.equal(c.leerMarca(), '2026-12-31T23:59:59.000Z', 'la marca avanza');

// ── La carga inicial no vuelve a subir lo que no cambió ──────────────────
const carga = html.slice(html.indexOf('let recoveredFromBackup = false;'));
assert.match(carga.slice(0, 1800), /const comoLlego = data \? JSON\.stringify\(\[data\.tasks \|\| \[\], data\.completed_tasks \|\| \[\]\]\) : null;/);
assert.match(carga.slice(0, 1800), /if \(!data \|\| recoveredFromBackup \|\| comoQueda !== comoLlego\) \{\s*await saveSharedPendingState\(\);/);
// Y la marca se mueve DESPUÉS de guardar, no antes: si falla el guardado, se vuelve a pedir.
const cargador = extraer('loadArchivedCompletedTasks');
assert.ok(cargador.indexOf('writeStoredJson(COMPLETED_STORAGE_KEY') < cargador.indexOf('setItem(HISTORY_WATERMARK_KEY'),
  'primero se guarda lo traído y después se mueve la marca');

console.log('PASS egress de la carga inicial: el historial pasa de bajarse entero cada vez (2.500 registros, 3 páginas) a una consulta que no trae nada cuando no hay novedades, y el tablero solo se sube si de verdad cambió.');
