// Las tres categorías de visualización del tablero: Claude uso, Día a día y Proyectos.
//
// Lo que se prueba aquí es lo que no se ve al mirar la pantalla un rato:
//   · Qué nombres cuentan como «pendiente del día» («MIÉRCOLES 11», no «Miércoles de pauta»).
//   · Que lo elegido a mano manda sobre la regla automática.
//   · Que un pendiente nuevo nace en Proyectos, y que los tableros de Claude y del día son
//     fijos: la regla por nombre ya solo alcanza a los que venían de antes.
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
const LIST = 15;
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
    TASK_LIST_INDEX: LIST,
    TASK_SUBTASKS_INDEX: SUBTASKS,
    TASK_UPDATED_AT_INDEX: 13,
    taskId: (task) => task[6] || task[0],
    isTaskLockedByOtherUser: (id) => bloqueadas.includes(id),
    isDailySubtask: (subtask) => Boolean(subtask?.daily),
    pendingTaskList: (task) => (task?.[LIST] && typeof task[LIST] === 'object' ? task[LIST] : null),
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
        "['dia', 'proyectos'];"
      ),
      extraer('normalizeText'),
      extraer('parseDayKey'),
      extraer('pendingDayTitle'),
      extraer('isPendingDayTitle'),
      extraer('pendingTaskStoredView'),
      extraer('pendingTaskAutoView'),
      extraer('pendingTaskView'),
      extraer('isPendingTaskViewFixed'),
      extraer('rollPendingDayBoards'),
      extraer('localDayKey'),
      extraer('subtaskCarriedFrom')
    ].join('\n'),
    contexto
  );
  contexto.guardados = guardados;
  return contexto;
}

// El alta de un pendiente, con lo justo alrededor para ver en qué pestaña nace.
function montarAlta() {
  const contexto = {
    Array,
    String,
    Number,
    Date,
    Math,
    JSON,
    tasks: [],
    TASK_CATEGORY_INDEX: 8,
    TASK_COLOR_INDEX: 10,
    TASK_MANUAL_ORDER_INDEX: 11,
    TASK_VIEW_INDEX: VIEW,
    TASK_LIST_INDEX: LIST,
    state: {taskView: 'todos'},
    pendingListById: () => null,
    normalizePendingList: (lista) => (lista && lista.id ? lista : null),
    defaultPendingTaskColor: () => '#2563eb',
    topTaskManualOrder: () => 0,
    normalizePendingCategory: (categoria) => categoria || null,
    upsertPendingCategory: () => {},
    saveTaskState: () => {},
    notifyTaskAssignment: () => {}
  };
  vm.createContext(contexto);
  vm.runInContext(extraer('createPendingTask'), contexto);
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
assert.equal(c.pendingTaskView(tablero('Reporte distribución de presupuesto RB')), 'proyectos');
// El nombre ya no reparte más que el del día: la pestaña de Claude se fue y en su sitio
// están las listas que se crean a mano.
assert.equal(c.pendingTaskView(tablero('Claude uso')), 'proyectos');
assert.equal(c.pendingTaskView(tablero('Claudette joyería')), 'proyectos');

// ── Estar en una lista manda sobre todo ─────────────────────────────────
const enLista = tablero('Reporte RB', {vista: 'dia'});
enLista[LIST] = {id: 'lista-cierre-de-mes', title: 'Cierre de mes', createdAt: '2026-11-18T10:00:00.000Z'};
assert.equal(c.pendingTaskView(enLista), 'lista-cierre-de-mes', 'la lista es su pestaña');
assert.ok(!c.isPendingTaskViewFixed(enLista), 'y un pendiente en una lista siempre se puede mover');

// ── Lo elegido a mano manda ──────────────────────────────────────────────
assert.equal(c.pendingTaskView(tablero('VIERNES 13', {vista: 'proyectos'})), 'proyectos');
assert.equal(c.pendingTaskView(tablero('Reporte RB', {vista: 'dia'})), 'dia');
assert.equal(c.pendingTaskView(tablero('Reporte RB', {vista: 'inventada'})), 'proyectos', 'un valor raro no cuenta');

// ── El tablero fijo ──────────────────────────────────────────────────────
// El del día entró en su pestaña por su nombre: ahí se queda y su Vista no se cambia. Lo
// demás se mueve a mano, y lo que ya se movió alguna vez tampoco es fijo.
assert.ok(c.isPendingTaskViewFixed(tablero('VIERNES 13')), 'el tablero del día es fijo');
assert.ok(!c.isPendingTaskViewFixed(tablero('USO DE CLAUDE')), 'el de Claude ya no es fijo');
assert.ok(!c.isPendingTaskViewFixed(tablero('Reporte RB')), 'un proyecto se puede mover');
assert.ok(!c.isPendingTaskViewFixed(tablero('VIERNES 13', {vista: 'dia'})), 'elegido a mano, se puede volver a mover');

// ── Un pendiente nuevo nace en Proyectos ─────────────────────────────────
// Aunque se llame como un día: esa pestaña ya tiene su tablero.
const nuevo = montarAlta();
nuevo.createPendingTask({title: 'Reporte con Claude', owner: 'Jorge Luis', startDate: '2026-11-15', dueDate: '', priority: 'Media'});
nuevo.createPendingTask({title: 'LUNES 16', owner: 'Jorge Luis', startDate: '2026-11-16', dueDate: '', priority: 'Media'});
assert.equal(c.pendingTaskView(nuevo.tasks[1]), 'proyectos', 'el nombre con Claude ya no manda');
assert.equal(c.pendingTaskView(nuevo.tasks[0]), 'proyectos', 'el nombre de día tampoco');
assert.ok(!c.isPendingTaskViewFixed(nuevo.tasks[0]), 'y lo nuevo se puede mover a otra pestaña');

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

// ── La etiqueta no depende de haber estado en el salto de día ────────────
// `carriedFrom` se escribe UNA vez, en el instante del renombrado. Quien no estuvo ahí —la
// pestaña que lleva abierta desde ayer y recibe el tablero ya renombrado, el navegador que abrió
// después, una fusión que llegó con el hueco— se quedaba sin etiqueta. Pasó de verdad el martes
// 17: el tablero decía «MARTES 17» y ninguna tarea de ayer llevaba su marca.
// Ahora, en el tablero del día de HOY, lo que nació un día anterior y sigue abierto se arrastra
// aunque nadie le haya escrito el campo, y el día del que viene es el de su creación.
{
  const ctx = montar();
  const hoyKey = ctx.localDayKey();
  const ayerKey = ctx.localDayKey(Date.now() - 86400000);
  const hoyTitulo = ctx.pendingDayTitle();
  const ayerTitulo = ctx.pendingDayTitle(ayerKey);
  const deAyer = (extra = {}) => ({
    id: 's1',
    title: 'Crear un supabase con Performance',
    status: 'Pendiente',
    createdAt: `${ayerKey}T15:00:00.000Z`,
    ...extra
  });
  const hoyTablero = (subtarea, opciones = {}) => tablero(hoyTitulo, {subtareas: [subtarea], ...opciones});

  assert.equal(
    ctx.subtaskCarriedFrom(deAyer(), hoyTablero(deAyer())),
    ayerTitulo,
    'sin el campo escrito, el día del que viene sale de su fecha de creación'
  );
  assert.equal(
    ctx.subtaskCarriedFrom(deAyer({carriedFrom: 'MIÉRCOLES 11'}), hoyTablero(deAyer())),
    'MIÉRCOLES 11',
    'lo escrito manda: dice desde cuándo se arrastra de verdad'
  );
  assert.equal(
    ctx.subtaskCarriedFrom(deAyer({createdAt: `${hoyKey}T09:00:00.000Z`}), hoyTablero(deAyer())),
    '',
    'lo que nació hoy no se arrastra'
  );
  assert.equal(ctx.subtaskCarriedFrom(deAyer({daily: true}), hoyTablero(deAyer())), '', 'la diaria se repite, no se arrastra');
  assert.equal(
    ctx.subtaskCarriedFrom(deAyer({status: 'Completado'}), hoyTablero(deAyer())),
    '',
    'lo terminado tampoco'
  );
  assert.equal(ctx.subtaskCarriedFrom(deAyer({createdAt: ''}), hoyTablero(deAyer())), '', 'sin fecha de creación no se inventa nada');
  assert.equal(
    ctx.subtaskCarriedFrom(deAyer(), tablero('Reporte distribución de presupuesto RB', {subtareas: [deAyer()]})),
    '',
    'en un proyecto no hay arrastre de día'
  );
  assert.equal(
    ctx.subtaskCarriedFrom(deAyer(), tablero(ayerTitulo, {subtareas: [deAyer()]})),
    '',
    'en el tablero de ayer, que todavía no saltó, no se adelanta la etiqueta'
  );
}

console.log('✓ categorías del tablero: nombres de día, alta en Proyectos, tableros fijos y cambio de día');
