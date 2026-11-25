// Contratos y comportamiento del agente sobre las funciones reales del tablero. Sin red.
process.env.TZ = 'America/Lima';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import '../../src/modules/lista-pendientes/control.js';
import '../../src/modules/lista-pendientes/agente-catalogo.js';
import {test} from 'node:test';

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

function constante(nombre) {
  const inicio = html.indexOf(`const ${nombre} =`);
  assert.notEqual(inicio, -1, `no se encontró la constante ${nombre}`);
  const fin = html.indexOf(';', html.indexOf('=', inicio));
  return html.slice(inicio, fin + 1);
}

function indice(nombre) {
  const encontrado = html.match(new RegExp(`const ${nombre} = (\\d+);`));
  assert.ok(encontrado, `no se encontró el índice ${nombre}`);
  return Number(encontrado[1]);
}

const SUBTAREAS = indice('TASK_SUBTASKS_INDEX');

const FUNCIONES = [
  'normalizeText',
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
  'subtaskLinks',
  'normalizeSubtaskChecklistItem',
  'normalizeSubtaskChecklist',
  'subtaskChecklist',
  'subtaskChecklistDoneCount',
  'isDailySubtask',
  'subtaskDailyStamp',
  'mergeSubtaskDailyMark',
  'isClaudeSubtask',
  'subtaskClaudeStamp',
  'mergeSubtaskClaudeMark',
  'normalizeSubtaskProgress',
  'subtaskProgressStamp',
  'mergeSubtaskProgressMark',
  'normalizeSubtaskDailyLog',
  'mergeSubtaskDailyLogs',
  'subtaskDailyLog',
  'normalizePendingSubtask',
  'pendingSubtaskBlocks',
  'flattenPendingSubtaskBlocks',
  'pendingSubtasks',
  'mergePendingSubtaskLists',
  'findPendingTaskById',
  'localDayKey',
  'suitePersonKey',
  'subtaskSyncId',
  'findSyncedSubtaskPartner',
  'propagateSubtaskSync',
  'subtasksDoneByUserMap',
  'findPendingSubtaskForEdit',
  'savePendingSubtaskChecklist',
  'addPendingSubtaskChecklistItem',
  'togglePendingSubtaskChecklistItem',
  'renamePendingSubtaskChecklistItem',
  'deletePendingSubtaskChecklistItem',
  'togglePendingSubtask',
  'isSyncedSubtask', 'isSubtaskSyncCopy', 'removeSyncedSubtaskCopy', 'unsyncSubtaskPair',
  'deletePendingSubtask', 'restoreDeletedSubtask', 'togglePendingSubtaskDaily', 'togglePendingSubtaskClaude',
  'addPendingSubtaskLink', 'deletePendingSubtaskLink', 'addPendingSubtaskFollowUp',
  'restampPendingSubtaskOrder', 'reorderPendingSubtaskByDrop',
  'createPendingSubtask', 'renamePendingSubtask', 'toggleSubtaskBoardSync',
  'normalizePendingList', 'pendingListIdFromTitle', 'pendingLists', 'pendingListById',
  'createPendingList', 'deletePendingList', 'sendPendingTaskToList',
  'agentePagina', 'agenteValidarEntrada', 'agenteEjecutarExtendido', 'agenteEjecutar',
  'agenteDatosPendiente', 'agenteGruposDisponibles', 'agenteEtiquetaExtendida', 'agenteEtiquetaAccion'
];

function tablero(tareas, {usuario = 'Jorge Luis', bloqueado = false} = {}) {
  const contexto = {
    window: {LRControl: globalThis.LRControl},
    LRPendientesCatalogo: globalThis.LRPendientesCatalogo,
    agenteEliminaciones: new Map(),
    AGENTE_ESTADOS: ['Pendiente', 'En proceso', 'Bloqueado'],
    AGENTE_PRIORIDADES: ['Alta', 'Media', 'Baja'],
    bloqueadas: new Set(),
    activeTimerEntry: () => null,
    currentSuiteUserIsSuperadmin: () => false,
    agenteResponsables: () => ['Jorge Luis', 'Diego'],
    agenteResponsable: (nombre, respaldo) => nombre || respaldo || 'Jorge Luis',
    isSameSuitePerson: (a, b) => a === b,
    agenteLimpio: (texto, largo = 160) => String(texto || '').slice(0, largo),
    pendingTaskList: (task) => task[15] || null,
    pendingTaskCategory: (task) => task[8] || null,
    pendingTaskView: (task) => task[14] || 'proyectos',
    timerSecondsForTask: () => 0,
    taskMatchesMonth: (task, mes) => task[5].startsWith(mes),
    manualPendingCategories: [],
    document: {querySelectorAll: () => []},
    completedTasks: [],
    completedTaskKey: (item) => item.completedRecordId,
    loadArchivedCompletedTasks: async () => {},
    state: {active: 'tasks'},
    tasksModule: () => {},
    saveTimerState: () => {},
    offerSubtaskUndo: () => {},
    TASK_LIST_INDEX: 15,
    PENDING_LIST_TITLE_LIMIT: 40,
    PENDING_BOARD_VIEWS: [{id: 'todos'}, {id: 'dia'}, {id: 'proyectos'}],
    pendingListCatalog: [],
    savePendingListCatalog: () => {},
    SUBTASK_SYNC_BOARD_VIEWS: ['dia'],
    pendingBoardViewLabel: (id) => id,
    syncBoardTargets: () => [{key: 'dia'}],
    syncBoardFromDestino: (destino) => destino === 'dia' ? {task: contexto.tasks[1], taskIdValue: 'p2', label: 'Día a día'} : null,
    applySubtaskBoardSync: (id, subtaskId, destino) => contexto.toggleSubtaskBoardSync(id, subtaskId, destino),
    TASK_COLOR_INDEX: 10,
    taskTimer: {elapsedById: {}, elapsedEditedAt: {}, presetById: {}, durationById: {}},
    formatTimer: (numero) => String(numero),
    isTaskLockedByOtherUser: (id) => bloqueado || contexto.bloqueadas.has(id),

    Number,
    String,
    Boolean,
    Object,
    JSON,
    Math,
    Date,
    URL,
    Set,
    console,
    TASK_SUBTASKS_INDEX: SUBTAREAS,
    TASK_UPDATED_AT_INDEX: indice('TASK_UPDATED_AT_INDEX'),
    SUBTASK_FOLLOWUP_TITLE_LIMIT: indice('SUBTASK_FOLLOWUP_TITLE_LIMIT'),
    SUBTASK_PROGRESS_STEP: indice('SUBTASK_PROGRESS_STEP'),
    SUBTASK_SYNC_TITLE_LIMIT: indice('SUBTASK_SYNC_TITLE_LIMIT'),
    SUBTASK_LINKS_LIMIT: indice('SUBTASK_LINKS_LIMIT'),
    SUBTASK_LINK_LABEL_LIMIT: indice('SUBTASK_LINK_LABEL_LIMIT'),
    SUBTASK_LINK_SCHEMES: ['http:', 'https:', 'mailto:'],
    tasks: tareas,
    lastTaskStamp: 0,
    guardados: [],
    lapidas: {},
    taskTombstones() {
      return contexto.lapidas;
    },
    currentSuiteUserName: () => usuario,
    canCurrentUserControlTask: (id) => !bloqueado && !contexto.bloqueadas.has(id),
    saveTaskState: (motivo) => contexto.guardados.push(motivo?.reason || '')
  };
  vm.createContext(contexto);
  vm.runInContext(
    [
      constante('SUBTASK_CHECKLIST_LIMIT'),
      constante('SUBTASK_CHECKLIST_TITLE_LIMIT'),
      constante('SUBTASK_DAILY_LOG_DAYS'),
      constante('SUBTASK_SYNC_FIELDS'),
      ...FUNCIONES.map(extraer)
    ].join('\n'),
    contexto
  );
  return contexto;
}

function pendiente(id = 'p1', internas = []) {
  const task = ['Proyecto ' + id, 'Jorge Luis', '2026-11-30', 'Pendiente', 'Media', '2026-11-01', id];
  task[SUBTAREAS] = internas;
  return task;
}
const interna = (id = 's1', extras = {}) => ({id, title: 'Revisar ' + id, owner: 'Jorge Luis', status: 'Pendiente', ...extras});
const datos = (c, i = 0) => c.pendingSubtasks(c.tasks[i]);
const llamar = (c, nombre, entrada = {}) => c.agenteEjecutar(nombre, entrada);
const ids = {tarea_id: 'p1', tarea_interna_id: 's1'};

test('un catálogo, nombres únicos y solo consultas automáticas', () => {
  const catalogo = globalThis.LRPendientesCatalogo;
  const names = catalogo.herramientas.map((item) => item.name);
  assert.equal(names.length, new Set(names).size);
  assert.equal(names.length, 48);
  assert.ok(catalogo.consultas.every((name) => name === 'ver_agenda' || name.startsWith('consultar_')));
  for (const name of names.filter((name) => !['ver_agenda', 'agendar_reunion'].includes(name))) {
    assert.match(extraer('agenteEjecutar') + extraer('agenteEjecutarExtendido'), new RegExp('"' + name + '"'), name + ' debe tener ejecutor');
  }
  const edge = readFileSync(new URL('../../supabase/functions/pendientes-agente/index.ts', import.meta.url), 'utf8');
  assert.match(edge, /import "\.\.\/\.\.\/\.\.\/src\/modules\/lista-pendientes\/agente-catalogo\.js"/);
  assert.match(html, /sinConfirmar: new Set\(LRPendientesCatalogo.consultas\)/);
});

test('no escribe con IDs ajenos, parámetros inválidos o responsables inventados', async () => {
  const c = tablero([pendiente('p1', [interna()]), pendiente('p2', [interna('otra')])]);
  for (const [nombre, entrada] of [
    ['eliminar_tarea_interna', {...ids, tarea_interna_id: 'otra'}],
    ['eliminar_tarea_interna', {...ids, tarea_id: 'ausente'}],
    ['eliminar_tarea_interna', {tarea_id: 'p1'}],
    ['marcar_tarea_interna', {...ids, hecha: 'false'}],
    ['configurar_tarea_diaria', {...ids, diaria: null}],
    ['cambiar_tarea_interna', {...ids, responsable: 'Inventado'}],
    ['cambiar_tarea_interna', {...ids, responsable: 'Todos'}],
    ['cambiar_tarea_interna', {...ids, inicio: '2026-02-30'}],
    ['cambiar_tarea_interna', {...ids, hora_inicio: '25:00'}],
    ['ajustar_tiempo', {tarea_id: 'p1', segundos: -1}],
    ['eliminar_tarea_interna', {...ids, inesperado: true}],
    ['herramienta_inventada', {}]
  ]) assert.equal((await llamar(c, nombre, entrada)).ok, false, nombre);
  assert.equal(c.guardados.length, 0);
  assert.equal(datos(c).length, 1);
  assert.equal(datos(c, 1).length, 1);
});

test('borrado usa lápidas, respeta diarias y permite deshacer una vez con ID nuevo', async () => {
  const c = tablero([pendiente('p1', [interna('s1', {daily: true}), interna('s2')])]);
  assert.equal((await llamar(c, 'eliminar_tarea_interna', ids)).ok, false);
  assert.equal((await llamar(c, 'configurar_tarea_diaria', {...ids, diaria: false})).ok, true);
  const borrado = await llamar(c, 'eliminar_tarea_interna', ids);
  assert.equal(borrado.ok, true);
  assert.deepEqual(Array.from(datos(c), (item) => item.id), ['s2']);
  assert.equal(c.lapidas.s1.action, 'subtarea-borrada');
  const restaurada = await llamar(c, 'restaurar_tarea_interna', {eliminacion_id: borrado.eliminacion_id});
  assert.equal(restaurada.ok, true);
  assert.notEqual(restaurada.tarea_interna_id, 's1');
  assert.equal(datos(c).length, 2);
  assert.equal((await llamar(c, 'restaurar_tarea_interna', {eliminacion_id: borrado.eliminacion_id})).ok, false);
});

function compartidas() {
  return tablero([pendiente('p1', [interna('s1', {syncId: 'sync'})]), pendiente('p2', [interna('copia', {syncId: 'sync', syncFromTaskId: 'p1'})])]);
}

test('bloqueos del origen y de la copia impiden borrar o modificar', async () => {
  const c = compartidas();
  c.bloqueadas.add('p2');
  for (const nombre of ['eliminar_tarea_interna', 'marcar_tarea_interna', 'cambiar_tarea_interna']) {
    const entrada = nombre === 'marcar_tarea_interna' ? {...ids, hecha: true} : nombre === 'cambiar_tarea_interna' ? {...ids, responsable: 'Diego'} : ids;
    assert.equal((await llamar(c, nombre, entrada)).ok, false);
  }
  assert.equal(c.guardados.length, 0);
  c.bloqueadas.clear();
  c.bloqueadas.add('p1');
  assert.equal((await llamar(c, 'eliminar_tarea_interna', ids)).ok, false);
  assert.equal((await llamar(c, 'desbloquear_pendiente', {tarea_id: 'p1'})).ok, false);
  assert.equal((await llamar(c, 'consultar_pendiente', {tarea_id: 'p1'})).ok, true);
});

test('eliminar compartida borra las dos filas sin dejar enlaces huérfanos', async () => {
  const c = compartidas();
  assert.equal((await llamar(c, 'eliminar_tarea_interna', ids)).ok, true);
  assert.equal(datos(c).length, 0);
  assert.equal(datos(c, 1).length, 0);
  assert.ok(c.lapidas.s1);
  assert.ok(c.lapidas.copia);
});

test('edición atómica de fechas, horas y responsable persiste y viaja a la copia', async () => {
  const c = compartidas();
  const cambios = {...ids, responsable: 'Diego', inicio: '2026-11-23', fin: '2026-11-24', hora_inicio: '22:00', hora_fin: '02:00'};
  assert.equal((await llamar(c, 'cambiar_tarea_interna', cambios)).ok, true);
  for (let i = 0; i < 2; i++) {
    const [item] = datos(c, i);
    assert.equal(item.owner, 'Diego');
    assert.equal(item.startTime, '22:00');
    assert.equal(item.endTime, '02:00');
    assert.equal(item.startDate, '2026-11-23');
    assert.equal(item.endDate, '2026-11-24');
  }
  const antes = JSON.stringify(c.tasks);
  assert.equal((await llamar(c, 'cambiar_tarea_interna', {...ids, responsable: 'Jorge Luis', fin: '2026-11-22'})).ok, false);
  assert.equal(JSON.stringify(c.tasks), antes, 'ningún campo válido se guarda si otro es inválido');
  assert.equal((await llamar(c, 'cambiar_tarea_interna', {...ids, inicio: '', fin: '', hora_inicio: '', hora_fin: ''})).ok, true);
  assert.equal(datos(c)[0].endDate, '');
  assert.equal(datos(c, 1)[0].endTime, '');
});

test('enlaces, hitos y seguimientos se ejecutan con IDs reales', async () => {
  const c = tablero([pendiente('p1', [interna()])]);
  assert.equal((await llamar(c, 'agregar_enlace', {...ids, url: 'javascript:alert(1)'})).ok, false);
  assert.equal((await llamar(c, 'agregar_enlace', {...ids, url: 'https://example.com', etiqueta: 'Informe'})).ok, true);
  let detalle = await llamar(c, 'consultar_pendiente', {tarea_id: 'p1'});
  const enlace = detalle.tareas_internas.filas[0].links[0].id;
  assert.equal((await llamar(c, 'eliminar_enlace', {...ids, enlace_id: enlace})).ok, true);
  assert.equal((await llamar(c, 'agregar_hito', {...ids, titulo: 'Revisar cifras'})).ok, true);
  const hito = datos(c)[0].checklist[0].id;
  assert.equal((await llamar(c, 'marcar_hito', {...ids, hito_id: hito, hecho: true})).ok, true);
  const guardados = c.guardados.length;
  assert.equal((await llamar(c, 'marcar_hito', {...ids, hito_id: hito, hecho: true})).ok, true);
  assert.equal(c.guardados.length, guardados, 'repetir estado deseado no lo invierte');
  assert.equal((await llamar(c, 'editar_hito', {...ids, hito_id: hito, titulo: 'Cifras verificadas'})).ok, true);
  assert.equal((await llamar(c, 'eliminar_hito', {...ids, hito_id: hito})).ok, true);
  assert.equal((await llamar(c, 'crear_seguimiento', {...ids, titulo: 'Validar mañana'})).ok, false);
  assert.equal((await llamar(c, 'marcar_tarea_interna', {...ids, hecha: true})).ok, true);
  assert.equal((await llamar(c, 'crear_seguimiento', {...ids, titulo: 'Validar mañana'})).ok, true);
  assert.equal(datos(c)[1].followUpOf, 's1');
});

test('orden respeta bloques y marcas diaria y Claude son idempotentes', async () => {
  const c = tablero([pendiente('p1', [interna('s1'), interna('s2')])]);
  assert.equal((await llamar(c, 'mover_tarea_interna', {...ids, referencia_id: 's2', posicion: 'despues'})).ok, true);
  assert.equal(datos(c)[1].id, 's1');
  for (let i = 0; i < 2; i++) {
    assert.equal((await llamar(c, 'configurar_tarea_diaria', {...ids, diaria: true})).ok, true);
    assert.equal((await llamar(c, 'marcar_claude', {...ids, activa: true})).ok, true);
  }
  assert.equal(datos(c)[0].id, 's1');
  assert.equal(datos(c)[0].daily, true);
  assert.equal(datos(c)[0].claude, true);
  assert.equal((await llamar(c, 'mover_tarea_interna', {...ids, referencia_id: 's2', posicion: 'despues'})).ok, false);
});

test('consulta paginada descubre tareas e internas fuera del contexto inicial', async () => {
  const c = tablero(Array.from({length: 45}, (_, i) => pendiente('p' + i, Array.from({length: 43}, (_, j) => interna('s' + j)))));
  let salida = await llamar(c, 'consultar_pendientes');
  assert.equal(salida.total, 45);
  assert.equal(salida.filas.length, 20);
  assert.equal(salida.siguiente, 20);
  salida = await llamar(c, 'consultar_pendientes', {desde: 40});
  assert.equal(salida.filas.length, 5);
  assert.equal(salida.siguiente, null);
  salida = await llamar(c, 'consultar_pendiente', {tarea_id: 'p44', desde: 40});
  assert.equal(salida.tareas_internas.filas.length, 3);
  assert.equal(salida.tareas_internas.filas[2].id, 's42');
  assert.equal(c.guardados.length, 0);
});

test('fechas de pendiente se pueden quitar y rechazan rangos imposibles al crear internas', async () => {
  const c = tablero([pendiente('p1')]);
  assert.equal((await llamar(c, 'cambiar_campos', {tarea_id: 'p1', inicio: '', fin: ''})).ok, true);
  assert.equal(c.tasks[0][5], '');
  assert.equal(c.tasks[0][2], '');
  assert.equal((await llamar(c, 'crear_tarea_interna', {tarea_id: 'p1', titulo: 'Nueva', inicio: '2026-11-25', fin: '2026-11-24'})).ok, false);
  assert.equal(datos(c).length, 0);
});

test('confirmación identifica la tarea y la consecuencia de eliminar compartidas', () => {
  const c = compartidas();
  const texto = c.agenteEtiquetaAccion({name: 'eliminar_tarea_interna', input: ids});
  assert.match(texto, /Revisar s1/);
  assert.match(texto, /Proyecto p1/);
  assert.match(texto, /copia compartida/);
});

test('compartir usa el destino real y repetir la orden no desvincula', async () => {
  const c = tablero([pendiente('p1', [interna()]), pendiente('p2')]);
  assert.equal((await llamar(c, 'compartir_tarea_interna', {...ids, compartir: true, destino: 'inventado'})).ok, false);
  assert.equal(datos(c, 1).length, 0);
  assert.equal((await llamar(c, 'compartir_tarea_interna', {...ids, compartir: true, destino: 'dia'})).ok, true);
  assert.equal(datos(c, 1).length, 1);
  assert.ok(datos(c)[0].syncId);
  assert.equal((await llamar(c, 'compartir_tarea_interna', {...ids, compartir: true, destino: 'dia'})).ok, true);
  assert.equal(datos(c, 1).length, 1);
  assert.equal((await llamar(c, 'compartir_tarea_interna', {...ids, compartir: false})).ok, true);
  assert.equal(datos(c, 1).length, 0);
  assert.equal(datos(c)[0].syncId, '');
});

test('listas: prevalidación impide escrituras parciales y borrarlas conserva pendientes', async () => {
  const c = tablero([pendiente('p1'), pendiente('p2')]);
  c.bloqueadas.add('p2');
  assert.equal((await llamar(c, 'crear_lista', {titulo: 'Clientes', tareas_ids: ['p1', 'p2']})).ok, false);
  assert.equal(c.pendingListCatalog.length, 0);
  assert.equal(c.tasks[0][15], undefined);
  c.bloqueadas.clear();
  const creada = await llamar(c, 'crear_lista', {titulo: 'Clientes', tareas_ids: ['p1', 'p2']});
  assert.equal(creada.ok, true);
  assert.equal(creada.movidos, 2);
  c.bloqueadas.add('p2');
  assert.equal((await llamar(c, 'eliminar_lista', {lista_id: creada.lista_id})).ok, false);
  assert.equal(c.tasks[0][15].id, creada.lista_id);
  c.bloqueadas.clear();
  assert.equal((await llamar(c, 'asignar_lista', {tarea_id: 'p1', lista_id: ''})).ok, true);
  assert.equal(c.tasks[0][15], '');
  assert.equal((await llamar(c, 'eliminar_lista', {lista_id: creada.lista_id})).ok, true);
  assert.equal(c.tasks.length, 2);
  assert.equal(c.tasks[1][15], '');
});

test('Deshacer visual consume la restauración del agente para evitar duplicados', async () => {
  const c = tablero([pendiente('p1', [interna()])]);
  const borrado = await llamar(c, 'eliminar_tarea_interna', ids);
  const record = c.agenteEliminaciones.get(borrado.eliminacion_id);
  c.restoreDeletedSubtask(record.tarea_id, record.subtask, record.index);
  assert.equal((await llamar(c, 'restaurar_tarea_interna', {eliminacion_id: borrado.eliminacion_id})).ok, false);
  assert.equal(datos(c).length, 1);
});

test('el mapa documentado incluye todas las funciones registradas', () => {
  const mapa = readFileSync(new URL('../../src/modules/lista-pendientes/AGENTE-FUNCIONES.md', import.meta.url), 'utf8');
  for (const item of LRPendientesCatalogo.herramientas) assert.ok(mapa.includes('| `' + item.name + '` |'), item.name);
});
