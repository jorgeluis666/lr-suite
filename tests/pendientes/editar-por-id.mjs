// Lote 12, parte 1: lo que escribes tiene que guardarse en TU tarea.
//
// Los campos del tablero llevaban un data-index con la posición que tenía la tarea cuando se
// dibujó la fila. Entre que alguien empieza a escribir y suelta el campo pasan segundos, y en ese
// rato un cambio del otro usuario reordena la lista o cierra una tarea. La posición deja de
// apuntar a lo mismo y el texto se guardaba en OTRA tarea, sin un aviso.
//
// Esta prueba reproduce exactamente eso: se empieza a editar la tarea de la posición 2 y, antes
// de soltar el campo, se cierra la que estaba encima. Con el código viejo el texto caía en la
// tarea siguiente; con el nuevo cae donde debe.
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

// Tres tareas; el campo que se edita es el título (índice 0) de la del medio.
const nuevasTareas = () => [
  ['Primera de Diego', 'Diego', '', 'Pendiente', 'Alta', '', 't-1', ''],
  ['La que estoy editando', 'Jorge Luis', '', 'Pendiente', 'Alta', '', 't-2', ''],
  ['Tercera, la de al lado', 'Jorge Luis', '', 'Pendiente', 'Media', '', 't-3', '']
];

const avisos = [];
function montar() {
  const contexto = {
    Number, String, Array, Object,
    tasks: nuevasTareas(),
    taskId: (task, index) => task?.[6] || `task-${index}`,
    canCurrentUserControlTask: () => true,
    isSameSuitePerson: (a, b) => String(a).toLowerCase() === String(b).toLowerCase(),
    setEditingPresence: () => {},
    saveTaskState: () => {},
    tasksModule: () => {},
    notifyTaskAssignment: () => {},
    showLiveActivity: (m) => avisos.push(m)
  };
  vm.createContext(contexto);
  vm.runInContext(
    [extraer('findPendingTaskById'), extraer('tareaDelCampo'), extraer('finishInlineTaskEdit')].join('\n'),
    contexto
  );
  return contexto;
}

// Un campo editable como el del tablero: dentro de una fila con data-task-id, y con el data-index
// que tenía al dibujarse.
const campo = (taskIdValue, index, texto) => {
  const fila = {dataset: {taskId: taskIdValue}};
  return {
    contentEditable: 'true',
    textContent: texto,
    dataset: {index: String(index), field: '0', original: 'La que estoy editando', cancelEdit: 'false'},
    closest: (sel) => (sel === '[data-task-id]' ? fila : null)
  };
};

// ── El caso que rompía ────────────────────────────────────────────────────
let c = montar();
const elemento = campo('t-2', 1, 'Mi texto nuevo');
// Mientras se escribía, el otro usuario cerró la primera: todo sube una posición.
c.tasks.splice(0, 1);
c.finishInlineTaskEdit(elemento);

assert.equal(c.tasks.find((t) => t[6] === 't-2')[0], 'Mi texto nuevo',
  'el texto tiene que ir a la tarea que se estaba editando');
assert.equal(c.tasks.find((t) => t[6] === 't-3')[0], 'Tercera, la de al lado',
  'y la de al lado no se toca: esto es lo que fallaba, el texto caía aquí');

// ── Sin cambios de por medio, lo de siempre ──────────────────────────────
c = montar();
c.finishInlineTaskEdit(campo('t-2', 1, 'Sin interferencias'));
assert.equal(c.tasks[1][0], 'Sin interferencias');
assert.equal(c.tasks[0][0], 'Primera de Diego');
assert.equal(c.tasks[2][0], 'Tercera, la de al lado');

// ── La tarea desapareció mientras se escribía ────────────────────────────
c = montar();
avisos.length = 0;
c.tasks = c.tasks.filter((t) => t[6] !== 't-2');
const antes = JSON.stringify(c.tasks);
c.finishInlineTaskEdit(campo('t-2', 1, 'Texto huérfano'));
assert.equal(JSON.stringify(c.tasks), antes, 'no se escribe en ninguna otra tarea');
assert.match(avisos.join(' '), /ya no está/, 'y se avisa en vez de guardar en silencio');

// ── Cancelar con Escape sigue restaurando el original ────────────────────
c = montar();
const cancelado = campo('t-2', 1, 'esto no debería quedar');
cancelado.dataset.cancelEdit = 'true';
c.finishInlineTaskEdit(cancelado);
assert.equal(c.tasks[1][0], 'La que estoy editando');

// ── Un campo sin fila alrededor no escribe a ciegas ──────────────────────
c = montar();
const suelto = {
  contentEditable: 'true', textContent: 'x',
  dataset: {index: '1', field: '0', original: '', cancelEdit: 'false'},
  closest: () => null
};
const antesSuelto = JSON.stringify(c.tasks);
c.finishInlineTaskEdit(suelto);
assert.equal(JSON.stringify(c.tasks), antesSuelto, 'sin id no se adivina la posición');

// ── Y los otros tres sitios resuelven igual ──────────────────────────────
for (const fn of ['beginInlineTaskEdit', 'openTaskBadgeSelect']) {
  assert.match(extraer(fn), /tareaDelCampo\(element\)/, `${fn} sigue buscando por posición`);
}
const porFecha = html.slice(html.indexOf('document.querySelectorAll("[data-task-date]")'));
assert.match(porFecha.slice(0, 2200), /tareaDelCampo\(event\.target\)/);
assert.doesNotMatch(porFecha.slice(0, 2200), /tasks\[index\]\[field\] = valor/,
  'la fecha ya no se escribe por posición');
// El desplegable vuelve a resolver al elegir, no solo al abrirse.
assert.match(extraer('openTaskBadgeSelect'), /findPendingTaskById\(idDeLaTarea\)/);

console.log('PASS editar por id: con la lista moviéndose debajo, el texto va a la tarea que se estaba editando y la de al lado no se toca; si la tarea desapareció se avisa y no se escribe en ninguna; cancelar y el caso normal siguen igual.');
