// Las tres categorías de visualización del tablero: Claude uso, Día a día y Proyectos.
//
// Lo que se prueba aquí es lo que no se ve al mirar la pantalla un rato:
//   · Qué nombres cuentan como «pendiente del día» («MIÉRCOLES 11», no «Miércoles de pauta»).
//   · Que lo elegido a mano manda sobre la regla automática.
//   · Que al pasar el día el tablero se renombra UNA vez y marca lo que quedó abierto, sin
//     tocar las diarias, las terminadas ni los tableros con nombre propio.
//   · Que lo ya arrastrado conserva el día del que viene: lo útil es desde cuándo se arrastra.
process.env.TZ = 'America/Lima';
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

// Una const de una sola línea, leída del archivo para probar la lista de verdad.
function constante(nombre) {
  const inicio = html.indexOf(`const ${nombre} =`);
  assert.notEqual(inicio, -1, `no se encontró la constante ${nombre}`);
  const fin = html.indexOf(';', inicio);
  assert.notEqual(fin, -1, `la constante ${nombre} no termina`);
  return html.slice(inicio, fin + 1);
}

const VIEW = 14;
const SUBTASKS = 9;
const ESTADO = 3;

function montar(tareas = [], {bloqueadas = []} = {}) {
  const guardados = [];
  const contexto = {
    Array,
    String,
    Boolean,
    Number,
    Date,
    RegExp,
    tasks: tareas,
    TASK_VIEW_INDEX: VIEW,
    TASK_SUBTASKS_INDEX: SUBTASKS,
    TASK_UPDATED_AT_INDEX: 13,
    taskId: (task) => task[6] || task[0],
    isTaskLockedByOtherUser: (id) => bloqueadas.includes(id),
    isDailySubtask: (subtask) => Boolean(subtask?.daily),
    pendingSubtasks: (task) => (Array.isArray(task[SUBTASKS]) ? task[SUBTASKS] : []),
    nextSubtaskStamp: () => '2026-11-14T10:00:00.000Z',
    nextTaskStamp: (previo = 0) => Number(previo) + 1,
    taskEditStamp: (task) => Number(task[13]) || 0,
    saveTaskState: (opciones) => guardados.push(opciones?.reason || 'cambio'),
    localStorage: {getItem: () => null, setItem: () => {}}
  };
  vm.createContext(contexto);
  vm.runInContext(
    [
      constante('PENDING_WEEKDAY_TITLES'),
      constante('PENDING_BOARD_VIEW_IDS').replace(
        /PENDING_BOARD_VIEWS\.filter[\s\S]*;/,
        "['claude', 'dia', 'proyectos'];"
      ),
      extraer('normalizeText'),
      extraer('parseDayKey'),
      extraer('pendingDayTitle'),
      extraer('isPendingDayTitle'),
      extraer('pendingTaskStoredView'),
      extraer('pendingTaskAutoView'),
      extraer('pendingTaskView'),
      extraer('rollPendingDayBoards')
    ].join('\n'),
    contexto
  );
  contexto.guardados = guardados;
  return contexto;
}

const tablero = (titulo, {vista = '', estado = 'Pendiente', id = titulo, subtareas = []} = {}) => {
  const t = [titulo, 'Jorge Luis', '', estado, 'Media', '', id, ''];
  t[SUBTASKS] = subtareas;
  t[VIEW] = vista;
  return t;
};

// ── Qué nombre es el de un día ───────────────────────────────────────────
let c = montar();
assert.ok(c.isPendingDayTitle('MIÉRCOLES 11'), 'el nombre que escribe Jorge a mano');
assert.ok(c.isPendingDayTitle('sábado 14'), 'da igual cómo esté escrito');
assert.ok(c.isPendingDayTitle('LUNES'), 'el día sin número también vale');
assert.ok(!c.isPendingDayTitle('Miércoles de pauta'), 'un nombre propio que empieza por un día no');
assert.ok(!c.isPendingDayTitle('Reporte RB'), 'un proyecto cualquiera tampoco');
assert.ok(!c.isPendingDayTitle(''), 'sin nombre no hay día');

// ── El reparto automático mientras nadie elija ───────────────────────────
assert.equal(c.pendingTaskView(tablero('VIERNES 13')), 'dia');
assert.equal(c.pendingTaskView(tablero('Claude uso')), 'claude');
assert.equal(c.pendingTaskView(tablero('Reporte distribución de presupuesto RB')), 'proyectos');
// «claude» tiene que ser una palabra suelta: no basta con que aparezca dentro de otra.
assert.equal(c.pendingTaskView(tablero('Claudette joyería')), 'proyectos');

// ── Lo elegido a mano manda ──────────────────────────────────────────────
assert.equal(c.pendingTaskView(tablero('VIERNES 13', {vista: 'proyectos'})), 'proyectos');
assert.equal(c.pendingTaskView(tablero('Reporte RB', {vista: 'dia'})), 'dia');
assert.equal(c.pendingTaskView(tablero('Reporte RB', {vista: 'inventada'})), 'proyectos', 'un valor raro no cuenta');

// ── Al pasar el día ──────────────────────────────────────────────────────
const hoy = montar().pendingDayTitle();
const ayer = hoy === 'LUNES 1' ? 'MARTES 2' : 'LUNES 1';

const abierta = () => ({id: 's1', title: 'Pasar a las optimizaciones', status: 'Pendiente'});
const hecha = () => ({id: 's2', title: 'Reporte RB', status: 'Completado'});
const diaria = () => ({id: 's3', title: 'Enviar PPT por linkedin', status: 'Pendiente', daily: true});

c = montar([tablero(ayer, {subtareas: [abierta(), hecha(), diaria()]})]);
c.rollPendingDayBoards();
let [t] = c.tasks;
assert.equal(t[0], hoy, 'el tablero del día se llama como hoy');
assert.equal(t[SUBTASKS][0].carriedFrom, ayer, 'lo que quedó abierto se marca con el día del que viene');
assert.equal(t[SUBTASKS][1].carriedFrom, undefined, 'lo terminado no se arrastra');
assert.equal(t[SUBTASKS][2].carriedFrom, undefined, 'la diaria no se arrastra: se repite');
assert.deepEqual(c.guardados, ['dia-a-dia'], 'se guarda una vez');

// Segunda pasada el mismo día: no vuelve a guardar ni a tocar nada.
c.rollPendingDayBoards();
assert.deepEqual(c.guardados, ['dia-a-dia'], 'ya está al día, no se guarda otra vez');

// ── Lo que ya se arrastraba conserva su día de origen ────────────────────
const vieja = {id: 's1', title: 'Pasar a las optimizaciones', status: 'Pendiente', carriedFrom: 'MIÉRCOLES 11'};
c = montar([tablero(ayer, {subtareas: [vieja]})]);
c.rollPendingDayBoards();
assert.equal(c.tasks[0][SUBTASKS][0].carriedFrom, 'MIÉRCOLES 11', 'sigue diciendo desde cuándo se arrastra');

// ── Lo que no se toca ────────────────────────────────────────────────────
c = montar([
  tablero('Reporte distribución de presupuesto RB'),
  tablero(ayer, {vista: 'proyectos'}),
  tablero(ayer, {estado: 'Completado', id: 'cerrado'}),
  tablero('Pendientes de la semana', {vista: 'dia'}),
  tablero(ayer, {id: 'bloqueado'})
]);
c.rollPendingDayBoards();
assert.equal(c.tasks[0][0], 'Reporte distribución de presupuesto RB', 'un proyecto no se renombra');
assert.equal(c.tasks[1][0], ayer, 'sacado de «Día a día» a mano, se queda como está');
assert.equal(c.tasks[2][0], ayer, 'un tablero cerrado no se renombra');
assert.equal(c.tasks[3][0], 'Pendientes de la semana', 'en «Día a día» con nombre propio, conserva el suyo');

c = montar([tablero(ayer, {id: 'bloqueado'})], {bloqueadas: ['bloqueado']});
c.rollPendingDayBoards();
assert.equal(c.tasks[0][0], ayer, 'si la otra persona lo tiene tomado, se espera');
assert.deepEqual(c.guardados, [], 'y no se guarda nada');

console.log('✓ categorías del tablero: nombres de día, reparto, elección a mano y cambio de día');
