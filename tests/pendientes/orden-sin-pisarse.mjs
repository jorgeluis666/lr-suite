// Lote 12, parte 3: dos personas reordenando a la vez no se pisan.
//
// Arrastrar un pendiente renumeraba TODOS: `tasks.forEach((t,i) => t[14] = i)`. Al fusionar, la
// copia de cada navegador decía que los doce habían cambiado, así que ganaba una entera y el
// movimiento de la otra persona desaparecía sin dejar rastro.
//
// Ahora solo cambia de orden la tarea movida, con un valor intermedio entre sus vecinas. Dos
// movimientos distintos tocan tareas distintas y los dos sobreviven.
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

const ORDEN = 14;
const tarea = (id, orden) => {
  const t = [`Tarea ${id}`, 'Jorge Luis', '', 'Pendiente', 'Alta', '', id, ''];
  t[ORDEN] = orden;
  return t;
};

function montar(tareas) {
  const contexto = {Array, Number, TASK_MANUAL_ORDER_INDEX: ORDEN, tasks: tareas};
  vm.createContext(contexto);
  vm.runInContext(
    [extraer('hasManualOrder'), extraer('taskManualOrder'), extraer('reordenarSoloLaMovida')].join('\n'),
    contexto
  );
  return contexto;
}

// Mueve la tarea `id` a la posición `destino` y devuelve los órdenes resultantes.
function mover(contexto, id, destino) {
  const desde = contexto.tasks.findIndex((t) => t[6] === id);
  const [movida] = contexto.tasks.splice(desde, 1);
  contexto.tasks.splice(destino, 0, movida);
  contexto.reordenarSoloLaMovida(movida, destino);
  return Object.fromEntries(contexto.tasks.map((t) => [t[6], t[ORDEN]]));
}

// ── Solo cambia la que se movió ───────────────────────────────────────────
let c = montar([tarea('a', 0), tarea('b', 1), tarea('c', 2), tarea('d', 3)]);
let r = mover(c, 'd', 1);
assert.equal(r.d, 0.5, 'la movida queda entre sus dos vecinas');
assert.deepEqual([r.a, r.b, r.c], [0, 1, 2], 'las otras tres no se tocan');

// ── Al principio y al final de la lista ──────────────────────────────────
c = montar([tarea('a', 0), tarea('b', 1), tarea('c', 2)]);
r = mover(c, 'c', 0);
assert.equal(r.c, -1, 'sin vecina arriba, se resta uno a la de abajo');
assert.deepEqual([r.a, r.b], [0, 1]);

c = montar([tarea('a', 0), tarea('b', 1), tarea('c', 2)]);
r = mover(c, 'a', 2);
assert.equal(r.a, 3, 'sin vecina abajo, se suma uno a la de arriba');
assert.deepEqual([r.b, r.c], [1, 2]);

// ── Los dos movimientos sobreviven ───────────────────────────────────────
// Jorge mueve «d» al puesto 1; Diego, en su navegador, mueve «a» al final. Al fusionar se
// quedan los dos, porque cada uno tocó una tarea distinta.
const base = () => [tarea('a', 0), tarea('b', 1), tarea('c', 2), tarea('d', 3)];
const deJorge = mover(montar(base()), 'd', 1);
const deDiego = mover(montar(base()), 'a', 3);
const tocadasPorJorge = Object.keys(deJorge).filter((id) => deJorge[id] !== {a: 0, b: 1, c: 2, d: 3}[id]);
const tocadasPorDiego = Object.keys(deDiego).filter((id) => deDiego[id] !== {a: 0, b: 1, c: 2, d: 3}[id]);
assert.deepEqual(tocadasPorJorge, ['d'], 'Jorge solo cambió una tarea');
assert.deepEqual(tocadasPorDiego, ['a'], 'Diego solo cambió una tarea');
assert.equal(tocadasPorJorge.some((id) => tocadasPorDiego.includes(id)), false,
  'no hay ninguna tarea en disputa: la fusión se queda con los dos movimientos');
// Fusionado: cada tarea con el orden de quien la tocó.
const fusion = {a: deDiego.a, b: 1, c: 2, d: deJorge.d};
const ordenFinal = Object.entries(fusion).sort((x, y) => x[1] - y[1]).map(([id]) => id);
assert.deepEqual(ordenFinal, ['d', 'b', 'c', 'a'], 'los dos movimientos se ven en el resultado');

// ── Cuando ya no caben más intermedios, se renumera una vez ──────────────
c = montar([tarea('a', 1), tarea('b', 1.0005), tarea('c', 5)]);
r = mover(c, 'c', 1);
assert.deepEqual([r.a, r.c, r.b], [0, 1, 2], 'el hueco era menor que una milésima: se renumera todo');

// ── Vecinas sin orden: se numera todo y queda la base puesta ─────────────
const sinOrden = [tarea('a', 0), tarea('b', 1), tarea('c', 2)];
delete sinOrden[0][ORDEN];
delete sinOrden[1][ORDEN];
c = montar(sinOrden);
r = mover(c, 'c', 1);
assert.deepEqual(Object.values(r).sort((x, y) => x - y), [0, 1, 2], 'todas quedan con un orden válido');

// ── Y el arrastre usa esto, no el renumerado de antes ────────────────────
const arrastre = extraer('reorderTaskByDrop');
assert.match(arrastre, /reordenarSoloLaMovida\(movedTask, nuevoIndice\)/);
assert.doesNotMatch(arrastre, /tasks\.forEach\(\(task, index\) => \{\s*if \(Array\.isArray\(task\)\) task\[TASK_MANUAL_ORDER_INDEX\] = index;/,
  'ya no renumera la lista entera en cada arrastre');

console.log('PASS orden sin pisarse: arrastrar cambia el orden de una sola tarea, los movimientos de dos personas se pueden fusionar los dos, y solo se renumera todo cuando de verdad no caben más intermedios.');
