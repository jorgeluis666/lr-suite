// La tarea de un proyecto que además hay que hacer hoy, o que se trabaja con Claude: una sola
// tarea en dos tableros.
//
// Antes se copiaba a mano al pendiente del día o al de Claude y a partir de ahí eran dos tareas
// distintas: se terminaban dos veces, se renombraban dos veces y nadie sabía cuál mandaba. Ahora
// el botón de la fila la comparte y las dos filas llevan el mismo `syncId`.
//
// Lo que se prueba aquí es justo lo que hacía falta para que no se repita el trabajo:
//   · Compartir crea UNA fila en el tablero elegido, con el nombre del pendiente de origen.
//   · Los dos destinos funcionan, y una tarea del día se puede mandar al de Claude.
//   · Terminar o renombrar cualquiera de las dos mueve a la otra.
//   · Quitar borra la copia y deja la del proyecto limpia.
//   · Borrar la del proyecto no deja media tarea huérfana.
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
const LISTA = indice('TASK_LIST_INDEX');

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
  'normalizeSubtaskChecklistItem',
  'normalizeSubtaskChecklist',
  'subtaskChecklist',
  'isDailySubtask',
  'subtaskDailyStamp',
  'mergeSubtaskDailyMark',
  'isClaudeSubtask',
  'subtaskClaudeStamp',
  'mergeSubtaskClaudeMark',
  'normalizeSubtaskDailyLog',
  'mergeSubtaskDailyLogs',
  'subtaskDailyLog',
  'normalizePendingSubtask',
  'pendingSubtaskBlocks',
  'flattenPendingSubtaskBlocks',
  'pendingSubtasks',
  'findPendingTaskById',
  'pendingDayTitle',
  'isPendingDayTitle',
  'pendingBoardViewLabel',
  'pendingTaskStoredView',
  'pendingTaskAutoView',
  'pendingTaskView',
  'subtaskSyncId',
  'isSyncedSubtask',
  'isSubtaskSyncCopy',
  'findSyncedSubtaskPartner',
  'syncBoardTask',
  'syncListBoards',
  'syncBoardTargets',
  'syncBoardFromDestino',
  'propagateSubtaskSync',
  'removeSyncedSubtaskCopy',
  'unsyncSubtaskPair',
  'toggleSubtaskBoardSync',
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
    TASK_LIST_INDEX: LISTA,
    // Las listas del tablero: el catálogo vive en el navegador y la lista viaja pegada a cada
    // pendiente que la usa. Aquí basta con las dos piezas que miran los destinos.
    listas: [],
    pendingTaskList: (task) => (Array.isArray(task) && task[LISTA] ? task[LISTA] : null),
    pendingLists: () => contexto.listas,
    pendingListById: (id) => contexto.listas.find((l) => l.id === id) || null,
    SUBTASK_FOLLOWUP_TITLE_LIMIT: indice('SUBTASK_FOLLOWUP_TITLE_LIMIT'),
    SUBTASK_SYNC_TITLE_LIMIT: indice('SUBTASK_SYNC_TITLE_LIMIT'),
    SUBTASK_LINKS_LIMIT: indice('SUBTASK_LINKS_LIMIT'),
    SUBTASK_LINK_LABEL_LIMIT: indice('SUBTASK_LINK_LABEL_LIMIT'),
    SUBTASK_LINK_SCHEMES: ['http:', 'https:', 'mailto:'],
    PENDING_BOARD_VIEW_IDS: ['dia', 'proyectos'],
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
    [
      constante('PENDING_BOARD_VIEWS'),
      constante('PENDING_WEEKDAY_TITLES'),
      constante('SUBTASK_CHECKLIST_LIMIT'),
      constante('SUBTASK_CHECKLIST_TITLE_LIMIT'),
      constante('SUBTASK_DAILY_LOG_DAYS'),
      constante('SUBTASK_SYNC_BOARD_VIEWS'),
      constante('SUBTASK_SYNC_FIELDS'),
      ...FUNCIONES.map(extraer)
    ].join('\n'),
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
const copiaEn = (contexto, id, salvo) => subtareasDe(contexto, id).find((s) => s.id !== salvo);
// Array.from saca la lista del contexto del VM: sin eso, deepEqual compara dos Array de
// realms distintos y falla aunque el contenido sea el mismo.
const destinos = (contexto, id) => Array.from(contexto.syncBoardTargets(id), (b) => b.view);

// ── El destino disponible desde un proyecto ──────────────────────────────
// Sin ninguna lista creada, el único destino es el tablero del día.
let c = banco();
assert.deepEqual(destinos(c, 'task-proyecto'), ['dia'], 'un proyecto puede mandar al tablero del día');
assert.deepEqual(destinos(c, 'task-dia'), [], 'el tablero del día no se ofrece a sí mismo');

// ── Compartir con el día: una fila nueva, ninguna de más en el proyecto ───
let r = c.toggleSubtaskBoardSync('task-proyecto', 'sub-1', 'dia');
assert.equal(r.estado, 'compartida');
assert.equal(r.tablero, c.pendingDayTitle(), 'el aviso nombra el tablero del día');
assert.equal(subtareasDe(c, 'task-proyecto').length, 2, 'el proyecto no gana filas');
assert.equal(subtareasDe(c, 'task-dia').length, 2, 'el día gana exactamente una');
let origen = buscar(c, 'task-proyecto', 'sub-1');
let copia = copiaEn(c, 'task-dia', 'sub-dia');
assert.ok(origen.syncId, 'la del proyecto queda marcada');
assert.equal(copia.syncId, origen.syncId, 'las dos llevan el mismo enlace');
assert.equal(copia.title, 'Revisar presupuestos');
assert.equal(copia.owner, 'Diego', 'el responsable viaja con la tarea');
assert.equal(copia.syncFromTaskId, 'task-proyecto');
assert.equal(copia.syncFromTitle, 'OPTIMIZACIÓN META ADS NOVIEMBRE', 'la copia dice de dónde viene');
assert.equal(c.isSubtaskSyncCopy(copia), true);
assert.equal(c.isSubtaskSyncCopy(origen), false, 'la del proyecto es el original, no la copia');
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

// ── Quitar: se va la copia y la del proyecto queda limpia ────────────────
r = c.toggleSubtaskBoardSync('task-proyecto', 'sub-1');
assert.equal(r.estado, 'quitada');
assert.equal(subtareasDe(c, 'task-dia').length, 1, 'la copia desaparece del día');
origen = buscar(c, 'task-proyecto', 'sub-1');
assert.equal(origen.syncId, '', 'la del proyecto pierde la marca');
assert.equal(origen.title, 'Revisar presupuestos de Meta', 'pero conserva lo trabajado');

// ── La segunda tarea del proyecto va al mismo tablero del día ────────────
c = banco();
r = c.toggleSubtaskBoardSync('task-proyecto', 'sub-2', 'dia');
assert.equal(r.estado, 'compartida');
copia = copiaEn(c, 'task-dia', 'sub-dia');
assert.equal(copia.title, 'Subir creatividades');
assert.equal(copia.syncFromTitle, 'OPTIMIZACIÓN META ADS NOVIEMBRE');
c.togglePendingSubtask('task-dia', copia.id);
assert.equal(buscar(c, 'task-proyecto', 'sub-2').status, 'Completado', 'también se termina una sola vez');

// ── También se quita desde la fila copiada ───────────────────────────────
c = banco();
c.toggleSubtaskBoardSync('task-proyecto', 'sub-1', 'dia');
copia = copiaEn(c, 'task-dia', 'sub-dia');
r = c.toggleSubtaskBoardSync('task-dia', copia.id);
assert.equal(r.estado, 'quitada');
assert.equal(subtareasDe(c, 'task-dia').length, 1);
assert.equal(buscar(c, 'task-proyecto', 'sub-1').syncId, '');

// ── Borrar la del proyecto no deja la copia huérfana ─────────────────────
c = banco();
c.toggleSubtaskBoardSync('task-proyecto', 'sub-1', 'dia');
c.deletePendingSubtask('task-proyecto', 'sub-1');
assert.equal(subtareasDe(c, 'task-proyecto').length, 1, 'se fue del proyecto');
assert.equal(subtareasDe(c, 'task-dia').length, 1, 'y con ella la del día');

// ── Una fila no se manda a su propio tablero ─────────────────────────────
c = banco();
assert.equal(c.toggleSubtaskBoardSync('task-dia', 'sub-dia', 'dia').estado, 'ya-esta-ahi');

// ── Sin tablero abierto, se avisa en vez de inventar uno ─────────────────
c = banco();
c.tasks = c.tasks.filter((t) => t[6] !== 'task-dia');
r = c.toggleSubtaskBoardSync('task-proyecto', 'sub-1', 'dia');
assert.equal(r.estado, 'sin-tablero');
assert.equal(r.destinoLabel, 'Día a día', 'el aviso dice qué tablero falta');
assert.deepEqual(destinos(c, 'task-proyecto'), []);

// ── El tablero cerrado no cuenta ─────────────────────────────────────────
c = banco();
c.tasks.find((t) => t[6] === 'task-dia')[3] = 'Completado';
assert.equal(c.toggleSubtaskBoardSync('task-proyecto', 'sub-1', 'dia').estado, 'sin-tablero');

// ── Al fusionar, desenlazar gana al estado viejo de la BBDD ──────────────
// La versión de la nube todavía dice que la tarea está compartida. Si el hueco se rellenara con
// «||», volvería a salir enlazada a una copia que ya no existe.
c = banco();
c.toggleSubtaskBoardSync('task-proyecto', 'sub-1', 'dia');
const vieja = JSON.parse(JSON.stringify(buscar(c, 'task-proyecto', 'sub-1')));
c.toggleSubtaskBoardSync('task-proyecto', 'sub-1');
const nueva = buscar(c, 'task-proyecto', 'sub-1');
assert.ok(c.pendingSubtaskStamp(nueva) > c.pendingSubtaskStamp(vieja), 'la edición nueva es posterior');
const fusionada = c.mergePendingSubtaskLists([vieja], [nueva]).find((s) => s.id === 'sub-1');
assert.equal(fusionada.syncId, '', 'la tarea no vuelve a enlazarse sola');
assert.equal(fusionada.syncFromTitle, '');

// ── Las listas hechas a mano también son destino ─────────────────────────
// El fallo: una lista creada con «Crear lista» salía como pestaña pero no en el selector de la
// fila, que solo miraba las vistas fijas. Ahora los destinos se leen vivos de pendingLists(),
// así que una lista recién creada se ofrece sin recargar la página.
c = banco();
c.listas = [{id: 'lista-atencion', title: 'Atención al Cliente', createdAt: '2026-11-18T10:00:00.000Z'}];
assert.deepEqual(destinos(c, 'task-proyecto'), ['dia', 'lista-atencion'], 'la lista vacía también se ofrece');
let claves = Array.from(c.syncBoardTargets('task-proyecto'), (b) => b.key);
assert.deepEqual(
  claves,
  ['dia', 'lista:lista-atencion'],
  'una lista vacía todavía no tiene pendiente al que mandar la tarea'
);

// Con un pendiente dentro, el destino es ese pendiente —la lista no guarda tareas internas—
// y el aviso nombra la lista.
c.tasks.push(pendiente('task-reclamos', 'RECLAMOS', 'proyectos'));
c.tasks.find((t) => t[6] === 'task-reclamos')[LISTA] = c.listas[0];
claves = Array.from(c.syncBoardTargets('task-proyecto'), (b) => b.key);
assert.deepEqual(claves, ['dia', 'task-reclamos'], 'el destino es el pendiente de la lista, no la lista');
r = c.toggleSubtaskBoardSync('task-proyecto', 'sub-1', 'task-reclamos');
assert.equal(r.estado, 'compartida');
assert.equal(r.tablero, 'RECLAMOS', 'el aviso dice en qué pendiente cayó');
assert.equal(r.destinoLabel, 'Atención al Cliente', 'y en qué lista está ese pendiente');
assert.equal(subtareasDe(c, 'task-reclamos').length, 1, 'la tarea entró en el pendiente de la lista');
assert.equal(subtareasDe(c, 'task-reclamos')[0].syncFromTaskId, 'task-proyecto');
c.togglePendingSubtask('task-reclamos', subtareasDe(c, 'task-reclamos')[0].id);
assert.equal(buscar(c, 'task-proyecto', 'sub-1').status, 'Completado', 'también se termina una sola vez');

// Dos pendientes en la misma lista: dos destinos, cada uno con su nombre.
c.tasks.push(pendiente('task-consultas', 'CONSULTAS', 'proyectos'));
c.tasks.find((t) => t[6] === 'task-consultas')[LISTA] = c.listas[0];
claves = Array.from(c.syncBoardTargets('task-proyecto'), (b) => b.key);
assert.deepEqual(claves, ['dia', 'task-reclamos', 'task-consultas'], 'cada pendiente de la lista es un destino');

// Un pendiente que no vive en ninguna lista no se alcanza por su id: el día va por «dia».
assert.equal(c.toggleSubtaskBoardSync('task-proyecto', 'sub-2', 'task-dia').estado, 'sin-tablero');

// Y el pendiente de la lista no se ofrece a sí mismo.
claves = Array.from(c.syncBoardTargets('task-reclamos'), (b) => b.key);
assert.deepEqual(claves, ['dia', 'task-consultas']);

console.log('✓ la tarea compartida es una sola tarea en dos tableros: el del día y los de las listas');
