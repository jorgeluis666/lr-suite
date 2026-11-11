// Lote 12, parte 4: una tarea devuelta a pendientes no puede volver al historial.
//
// «Regresar» la sacaba de la lista local y ya. Pero el registro sigue existiendo en la copia del
// otro navegador y en la tabla lr_suite_pending_history, y mergeCompletedTaskHistory lo vuelve a
// meter en la siguiente fusión: la tarea queda a la vez pendiente y completada.
//
// La lápida dice «esta se regresó a propósito», y la fusión la respeta.
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

const registro = (id, titulo) => ({
  completedRecordId: id,
  title: titulo,
  owner: 'Jorge Luis',
  completedAt: '2026-11-10T12:00:00.000Z',
  action: 'completada'
});

function montar() {
  const contexto = {
    Map, Array, Object, Number, String, Date, JSON,
    taskTimer: {tombstonesById: {}},
    completedTaskIdentity: (t) => t?.completedRecordId || 'sin-id',
    isCompletedTaskForActiveSuiteUser: () => true,
    currentSuiteUserName: () => 'Jorge Luis'
  };
  vm.createContext(contexto);
  vm.runInContext(
    [extraer('taskTombstones'), extraer('tumbaDeCompletada'),
      extraer('mergeCompletedTaskHistory'), extraer('pruneTaskTombstones')].join('\n'),
    contexto
  );
  return contexto;
}

// ── Sin lápida, el registro entra (como siempre) ──────────────────────────
let c = montar();
let r = c.mergeCompletedTaskHistory([registro('r-1', 'Una tarea')], [registro('r-2', 'Otra')]);
assert.equal(r.length, 2);

// ── Con lápida, el que se regresó no vuelve ──────────────────────────────
c = montar();
const devuelta = registro('r-1', 'Una tarea');
c.taskTombstones()[c.tumbaDeCompletada(devuelta)] = {
  action: 'regresada', closedAt: Date.now(), closedBy: 'Jorge Luis', title: 'Una tarea'
};
// Llega la copia del otro navegador, que todavía la tiene como completada.
r = c.mergeCompletedTaskHistory([devuelta, registro('r-2', 'Otra')]);
// Ojo: el array viene del contexto vm y deepEqual compara también el prototipo, así que dos
// arrays idénticos fallan. Se compara el contenido como texto.
assert.equal(r.map((x) => x.completedRecordId).join(','), 'r-2',
  'la regresada no vuelve al historial, aunque llegue de fuera');

// Y da igual cuántas veces llegue, o de cuántas fuentes a la vez.
r = c.mergeCompletedTaskHistory([devuelta], [devuelta], [registro('r-2', 'Otra')], [devuelta]);
assert.equal(r.map((x) => x.completedRecordId).join(','), 'r-2');

// ── La lápida no se pierde con el tope de 1000 ───────────────────────────
c = montar();
const tumbas = c.taskTombstones();
// Mil lápidas normales, todas más recientes que la de la completada.
for (let i = 0; i < 1000; i++) tumbas[`task-${i}`] = {closedAt: Date.now() + 1000 + i};
tumbas['completed:r-1'] = {closedAt: 1, action: 'regresada'};
const quedan = c.pruneTaskTombstones();
assert.ok(quedan['completed:r-1'],
  'la lápida de la regresada sobrevive aunque sea la más vieja: si cae, el registro resucita');
assert.equal(Object.keys(quedan).filter((k) => !k.startsWith('completed:')).length, 1000,
  'las normales siguen con su tope de 1000');

// ── Y «Regresar» pone la lápida antes de sacarla de la lista ─────────────
const restaurar = extraer('restoreCompletedTask');
assert.match(restaurar, /taskTombstones\(\)\[tumbaDeCompletada\(task\)\]/);
assert.ok(restaurar.indexOf('tumbaDeCompletada(task)') < restaurar.indexOf('completedTasks.splice'),
  'la lápida se pone antes del splice, o se pierde la identidad del registro');
assert.match(restaurar, /action: "regresada"/);

console.log('PASS regresar no resucita: una completada devuelta a pendientes no vuelve al historial aunque llegue de la copia del otro navegador, por muchas veces que llegue, y su lápida no cae con el tope de 1000.');
