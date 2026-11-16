// La tarea de un proyecto que además hay que hacer hoy: una sola tarea en dos tableros.
//
// Antes se copiaba a mano al pendiente del día y a partir de ahí eran dos tareas distintas: se
// terminaban dos veces, se renombraban dos veces y nadie sabía cuál mandaba. Ahora el botón de
// la fila la comparte con el «Día a día» y las dos filas llevan el mismo `syncId`.
//
// Lo que se prueba aquí es justo lo que hacía falta para que no se repita el trabajo:
//   · Compartir crea UNA fila en el tablero del día, con el nombre del pendiente de origen.
//   · Terminar o renombrar cualquiera de las dos mueve a la otra.
//   · Quitar del día borra la copia y deja la del proyecto limpia.
//   · Borrar la del proyecto no deja media tarea huérfana en el día.
//   · Y al desenlazar, el estado viejo de la BBDD no vuelve a enlazarlas al fusionar.
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

// Una const de varias líneas que termina en «;»: se lee del archivo para probar la lista real.
function constante(nombre) {
  const inicio = html.indexOf(`const ${nombre} =`);
  assert.notEqual(inicio, -1, `no se encontró la constante ${nombre}`);
  const fin = html.indexOf(';', html.indexOf('=', inicio));
  return html.slice(inicio, fin + 1);
}

// Los índices del array de un pendiente se leen del archivo para que no se queden atrás.
function indice(nombre) {
  const encontrado = html.match(new RegExp(`const ${nombre} = (\\d+);`));
  assert.ok(encontrado, `no se encontró el índice ${nombre}`);
  return Number(encontrado[1]);
}

const SUBTAREAS = indice('TASK_SUBTASKS_INDEX');
const VISTA = indice('TASK_VIEW_INDEX');

const FUNCIONES = [
  'normalizeText',
  'parseDayKey',
  'taskDateInputValue',
  'taskTimeInputValue',
  'taskId',
  'taskEditStamp',
  'nextTaskStamp',
  'pendingSubtaskStamp',
  'nextSubtaskStamp',
  'generatedTaskId',
  'legacySubtaskId',
  'safeSubtaskLinkUrl',
  'subtaskLinkLabelFromUrl',
  'normalizeSubtaskLink',
  'normalizeSubtaskLinks',
  'isDailySubtask',
  'normalizePendingSubtask',
  'pendingSubtaskBlocks',
  'flattenPendingSubtaskBlocks',
  'pendingSubtasks',
  'findPendingTaskById',
  'pendingDayTitle',
  'isPendingDayTitle',
  'pendingTaskStoredView',
  'pendingTaskAutoView',
  'pendingTaskView',
  'subtaskSyncId',
  'isSyncedSubtask',
  'isDaySyncCopy',
  'findSyncedSubtaskPartner',
  'currentDayBoardTask',
  'propagateSubtaskSync',
  'removeSyncedSubtaskCopy',
  'unsyncSubtaskPair',
  'toggleSubtaskDaySync',
  'togglePendingSubtask',
  'renamePendingSubtask',
  'deletePendingSubtask',
  'mergePendingSubtaskLists'
];

function montar(tareas) {
  const contexto = {
    Array,
    Number,
    String,
    Boolean,
    Object,
    JSON,
    Math,
    Date,
    URL,
    console,
    TASK_SUBTASKS_INDEX: SUBTAREAS,
    TASK_UPDATED_AT_INDEX: indice('TASK_UPDATED_AT_INDEX'),
    TASK_VIEW_INDEX: VISTA,
    SUBTASK_FOLLOWUP_TITLE_LIMIT: indice('SUBTASK_FOLLOWUP_TITLE_LIMIT'),
    SUBTASK_SYNC_TITLE_LIMIT: indice('SUBTASK_SYNC_TITLE_LIMIT'),
    SUBTASK_LINKS_LIMIT: indice('SUBTASK_LINKS_LIMIT'),
    SUBTASK_LINK_LABEL_LIMIT: indice('SUBTASK_LINK_LABEL_LIMIT'),
    SUBTASK_LINK_SCHEMES: ['http:', 'https:', 'mailto:'],
    PENDING_BOARD_VIEW_IDS: ['claude', 'dia', 'proyectos'],
    tasks: tareas,
    lastTaskStamp: 0,
    lapidas: {},
    guardados: [],
    taskTombstones() {
      return contexto.lapidas;
    },
    currentSuiteUserName: () => 'Jorge Luis',
    canCurrentUserControlTask: () => true,
    // El aviso de «Deshacer» es pantalla: aquí solo interesa qué quedó en los datos.
    offerSubtaskUndo: () => {},
    saveTaskState: (motivo) => contexto.guardados.push(motivo?.reason || ''),
    saveTimerState: () => {}
  };
  vm.createContext(contexto);
  vm.runInContext(
    [constante('PENDING_WEEKDAY_TITLES'), constante('SUBTASK_SYNC_FIELDS'), ...FUNCIONES.map(extraer)].join('\n'),
    contexto
  );
  return contexto;
}

// Un pendiente: [título, responsable, ..., estado, ..., id, creado].
function pendiente(id, titulo, vista, subtareas = []) {
  const tarea = [titulo, 'Jorge Luis', '', 'Pendiente', 'Alta', '', id, '2026-11-16T10:00:00.000Z'];
  tarea[SUBTAREAS] = subtareas;
  tarea[VISTA] = vista;
  return tarea;
}

function banco() {
  const contexto = montar([]);
  const hoy = vm.runInContext('pendingDayTitle()', contexto);
  contexto.tasks.push(
    pendiente('task-proyecto', 'OPTIMIZACIÓN META ADS NOVIEMBRE', 'proyectos', [
      {id: 'sub-1', title: 'Revisar presupuestos', owner: 'Diego', status: 'Pendiente', order: 0},
      {id: 'sub-2', title: 'Subir creatividades', owner: 'Jorge Luis', status: 'Pendiente', order: 1}
    ]),
    pendiente('task-dia', hoy, 'dia', [
      {id: 'sub-dia', title: 'Llamar al cliente', owner: 'Jorge Luis', status: 'Pendiente', order: 0}
    ])
  );
  return contexto;
}

const subtareasDe = (contexto, id) => contexto.tasks.find((t) => t[6] === id)[SUBTAREAS];
const buscar = (contexto, id, subId) => subtareasDe(contexto, id).find((s) => s.id === subId);

// ── Compartir: una fila nueva en el día, ninguna de más en el proyecto ────
let c = banco();
let r = c.toggleSubtaskDaySync('task-proyecto', 'sub-1');
assert.equal(r.estado, 'compartida');
assert.equal(subtareasDe(c, 'task-proyecto').length, 2, 'el proyecto no gana filas');
assert.equal(subtareasDe(c, 'task-dia').length, 2, 'el día gana exactamente una');
let origen = buscar(c, 'task-proyecto', 'sub-1');
let copia = subtareasDe(c, 'task-dia').find((s) => s.id !== 'sub-dia');
assert.ok(origen.syncId, 'la del proyecto queda marcada');
assert.equal(copia.syncId, origen.syncId, 'las dos llevan el mismo enlace');
assert.equal(copia.title, 'Revisar presupuestos');
assert.equal(copia.owner, 'Diego', 'el responsable viaja con la tarea');
assert.equal(copia.syncFromTaskId, 'task-proyecto');
assert.equal(copia.syncFromTitle, 'OPTIMIZACIÓN META ADS NOVIEMBRE', 'la copia dice de dónde viene');
assert.equal(c.isDaySyncCopy(copia), true);
assert.equal(c.isDaySyncCopy(origen), false, 'la del proyecto es el original, no la copia');
assert.equal(copia.order < subtareasDe(c, 'task-dia')[1].order, true, 'entra primera en el día');

// ── Terminar una termina la otra, en los dos sentidos ─────────────────────
c.togglePendingSubtask('task-dia', copia.id);
assert.equal(buscar(c, 'task-proyecto', 'sub-1').status, 'Completado', 'marcar en el día tacha el proyecto');
assert.ok(buscar(c, 'task-proyecto', 'sub-1').completedAt, 'y con su fecha de cierre');
c.togglePendingSubtask('task-proyecto', 'sub-1');
assert.equal(buscar(c, 'task-dia', copia.id).status, 'Pendiente', 'reabrir en el proyecto reabre el día');
assert.equal(buscar(c, 'task-dia', copia.id).completedAt, '', 'sin fecha de cierre colgando');
assert.equal(buscar(c, 'task-proyecto', 'sub-2').status, 'Pendiente', 'la tarea de al lado no se toca');

// ── Renombrar viaja ───────────────────────────────────────────────────────
c.renamePendingSubtask('task-proyecto', 'sub-1', 'Revisar presupuestos de Meta');
assert.equal(buscar(c, 'task-dia', copia.id).title, 'Revisar presupuestos de Meta');

// ── Quitar del día: se va la copia y la del proyecto queda limpia ─────────
r = c.toggleSubtaskDaySync('task-proyecto', 'sub-1');
assert.equal(r.estado, 'quitada');
assert.equal(subtareasDe(c, 'task-dia').length, 1, 'la copia desaparece del día');
origen = buscar(c, 'task-proyecto', 'sub-1');
assert.equal(origen.syncId, '', 'la del proyecto pierde la marca');
assert.equal(origen.title, 'Revisar presupuestos de Meta', 'pero conserva lo trabajado');

// ── También se quita desde la fila del día ────────────────────────────────
c = banco();
c.toggleSubtaskDaySync('task-proyecto', 'sub-1');
copia = subtareasDe(c, 'task-dia').find((s) => s.id !== 'sub-dia');
r = c.toggleSubtaskDaySync('task-dia', copia.id);
assert.equal(r.estado, 'quitada');
assert.equal(subtareasDe(c, 'task-dia').length, 1);
assert.equal(buscar(c, 'task-proyecto', 'sub-1').syncId, '');

// ── Borrar la del proyecto no deja la del día huérfana ────────────────────
c = banco();
c.toggleSubtaskDaySync('task-proyecto', 'sub-1');
c.deletePendingSubtask('task-proyecto', 'sub-1');
assert.equal(subtareasDe(c, 'task-proyecto').length, 1, 'se fue del proyecto');
assert.equal(subtareasDe(c, 'task-dia').length, 1, 'y con ella la del día');

// ── Una fila del propio tablero del día no se manda a sí misma ────────────
c = banco();
assert.equal(c.toggleSubtaskDaySync('task-dia', 'sub-dia').estado, 'ya-es-dia');

// ── Sin tablero del día abierto, se avisa en vez de inventar uno ──────────
c = banco();
c.tasks = c.tasks.filter((t) => t[6] !== 'task-dia');
assert.equal(c.toggleSubtaskDaySync('task-proyecto', 'sub-1').estado, 'sin-tablero');

// ── El tablero del día cerrado no cuenta ──────────────────────────────────
c = banco();
c.tasks.find((t) => t[6] === 'task-dia')[3] = 'Completado';
assert.equal(c.toggleSubtaskDaySync('task-proyecto', 'sub-1').estado, 'sin-tablero');

// ── Al fusionar, desenlazar gana al estado viejo de la BBDD ───────────────
// La versión de la nube todavía dice que la tarea está compartida. Si el hueco se rellenara con
// «||», volvería a salir enlazada a una copia que ya no existe.
c = banco();
c.toggleSubtaskDaySync('task-proyecto', 'sub-1');
const vieja = JSON.parse(JSON.stringify(buscar(c, 'task-proyecto', 'sub-1')));
c.toggleSubtaskDaySync('task-proyecto', 'sub-1');
const nueva = buscar(c, 'task-proyecto', 'sub-1');
assert.ok(c.pendingSubtaskStamp(nueva) > c.pendingSubtaskStamp(vieja), 'la edición nueva es posterior');
const fusionada = c.mergePendingSubtaskLists([vieja], [nueva]).find((s) => s.id === 'sub-1');
assert.equal(fusionada.syncId, '', 'la tarea no vuelve a enlazarse sola');
assert.equal(fusionada.syncFromTitle, '');

console.log('✓ la tarea compartida con el Día a día es una sola tarea en dos tableros');
