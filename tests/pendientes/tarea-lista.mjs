// La lista de hitos: el tercer nivel del tablero (pendiente › tarea interna › lista).
//
// Dentro de una tarea como «Revisar los reportes» hay un punto por marca. Antes había que
// partirla en tres tareas internas —y entonces el control contaba tres trabajos donde había
// uno— o llevar la cuenta de memoria. Ahora la tarea lleva su propia lista.
//
// Lo que se prueba aquí es lo que no se ve marcando un hito una vez:
//   · Agregar, marcar, renombrar y borrar hitos, y el tope de la lista.
//   · Que un hito NO sea una tarea interna: no cuenta en el control de cada persona ni en lo
//     que el pendiente se lleva al historial. Si contara, una tarea partida en cinco puntos
//     valdría por cinco y el que no parte nada parecería no cerrar nada.
//   · Que marcar un hito no toque el estado de la tarea, ni al revés: la tarea se cierra con
//     su «Hecho», tenga o no la lista completa.
//   · Que la lista viaje a la otra fila cuando la tarea está compartida con otro tablero.
//   · Que al fusionar con el estado del otro navegador no vuelva un hito ya borrado.
//   · Que una tarea diaria sí pueda tener lista: lo bloqueado en ella es la fila, no lo de dentro.
process.env.TZ = 'America/Lima';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import '../../src/modules/lista-pendientes/control.js';

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
  'togglePendingSubtask'
];

function tablero(tareas, {usuario = 'Jorge Luis', bloqueado = false} = {}) {
  const contexto = {
    window: {LRControl: globalThis.LRControl},
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
    canCurrentUserControlTask: () => !bloqueado,
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

function pendiente(titulo, subtareas) {
  const task = [titulo, 'Jorge Luis', 'Alta', 'Pendiente', '', '', '', '', '', []];
  task[SUBTAREAS] = subtareas;
  return task;
}

// Lo que se ve de la lista desde fuera del vm.
function lista(contexto, indiceTarea = 0, indiceSubtarea = 0) {
  return JSON.parse(
    vm.runInContext(`JSON.stringify(subtaskChecklist(pendingSubtasks(tasks[${indiceTarea}])[${indiceSubtarea}]))`, contexto)
  );
}

// ── Agregar, marcar, renombrar y borrar ───────────────────────────────────
{
  const tareas = [pendiente('Reportes', [{id: 'revisar', title: 'Revisar los reportes de Resultados'}])];
  const contexto = tablero(tareas);
  const llamar = (codigo) => vm.runInContext(codigo, contexto);

  assert.equal(llamar(`addPendingSubtaskChecklistItem('task-001', 'revisar', 'Reporte Amador')`), 'ok');
  assert.equal(llamar(`addPendingSubtaskChecklistItem('task-001', 'revisar', 'Reporte RB')`), 'ok');
  assert.equal(llamar(`addPendingSubtaskChecklistItem('task-001', 'revisar', 'Reporte Aquarius')`), 'ok');
  // Un hito vacío no entra: la lista no se llena de filas sin nombre.
  assert.equal(llamar(`addPendingSubtaskChecklistItem('task-001', 'revisar', '   ')`), 'vacio');

  let hitos = lista(contexto);
  assert.deepEqual(
    hitos.map((h) => h.title),
    ['Reporte Amador', 'Reporte RB', 'Reporte Aquarius'],
    'los hitos se guardan en el orden en que se escriben'
  );
  assert.ok(
    hitos.every((h) => h.done === false && h.id),
    'cada hito nace abierto y con su propio id'
  );

  const idRB = hitos[1].id;
  assert.equal(llamar(`togglePendingSubtaskChecklistItem('task-001', 'revisar', '${idRB}')`), true);
  hitos = lista(contexto);
  assert.equal(hitos[1].done, true);
  assert.equal(hitos[1].doneBy, 'Jorge Luis', 'queda quién lo marcó, como en la tarea');
  assert.ok(hitos[1].doneAt, 'y cuándo');
  assert.equal(vm.runInContext(`subtaskChecklistDoneCount(pendingSubtasks(tasks[0])[0])`, contexto), 1);

  // El mismo botón lo desmarca, y entonces no queda firma de nadie.
  llamar(`togglePendingSubtaskChecklistItem('task-001', 'revisar', '${idRB}')`);
  hitos = lista(contexto);
  assert.equal(hitos[1].done, false);
  assert.equal(hitos[1].doneBy, '');
  assert.equal(hitos[1].doneAt, '');

  assert.equal(llamar(`renamePendingSubtaskChecklistItem('task-001', 'revisar', '${idRB}', 'Reporte Royal Baby')`), true);
  assert.equal(lista(contexto)[1].title, 'Reporte Royal Baby');
  // Un nombre vacío no borra el hito: se queda como estaba.
  assert.equal(llamar(`renamePendingSubtaskChecklistItem('task-001', 'revisar', '${idRB}', '  ')`), false);
  assert.equal(lista(contexto)[1].title, 'Reporte Royal Baby');

  assert.equal(llamar(`deletePendingSubtaskChecklistItem('task-001', 'revisar', '${idRB}')`), true);
  assert.deepEqual(
    lista(contexto).map((h) => h.title),
    ['Reporte Amador', 'Reporte Aquarius']
  );
  assert.equal(llamar(`deletePendingSubtaskChecklistItem('task-001', 'revisar', '${idRB}')`), false, 'borrar dos veces no hace nada');

  assert.ok(
    contexto.guardados.every((motivo) => motivo === 'subtarea-lista'),
    'cada cambio de la lista se guarda con su propio motivo'
  );
}

// ── El tope de la lista y el largo del hito ───────────────────────────────
{
  const tareas = [pendiente('Reportes', [{id: 'revisar', title: 'Revisar los reportes'}])];
  const contexto = tablero(tareas);
  const tope = vm.runInContext('SUBTASK_CHECKLIST_LIMIT', contexto);
  const largo = vm.runInContext('SUBTASK_CHECKLIST_TITLE_LIMIT', contexto);
  for (let i = 0; i < tope; i += 1) {
    assert.equal(vm.runInContext(`addPendingSubtaskChecklistItem('task-001', 'revisar', 'Hito ${i}')`, contexto), 'ok');
  }
  assert.equal(
    vm.runInContext(`addPendingSubtaskChecklistItem('task-001', 'revisar', 'Uno de más')`, contexto),
    'limite',
    'la lista tiene tope: el estado compartido se baja entero en cada sincronización'
  );
  const largoDeMas = 'x'.repeat(largo + 50);
  const otro = tablero([pendiente('Reportes', [{id: 'revisar', title: 'Revisar'}])]);
  vm.runInContext(`addPendingSubtaskChecklistItem('task-001', 'revisar', ${JSON.stringify(largoDeMas)})`, otro);
  assert.equal(lista(otro)[0].title.length, largo, 'un hito larguísimo se recorta');
}

// ── Un hito no es una tarea interna: no cuenta en el control ──────────────
{
  const tareas = [
    pendiente('Reportes', [
      {
        id: 'revisar',
        title: 'Revisar los reportes',
        owner: 'Jorge Luis',
        status: 'Completado',
        completedAt: '2026-11-16T14:00:00-05:00',
        completedBy: 'Jorge Luis',
        checklist: [
          {id: 'h1', title: 'Reporte Amador', done: true, doneAt: '2026-11-16T10:00:00-05:00', doneBy: 'Jorge Luis'},
          {id: 'h2', title: 'Reporte RB', done: true, doneAt: '2026-11-16T11:00:00-05:00', doneBy: 'Jorge Luis'},
          {id: 'h3', title: 'Reporte Aquarius', done: false}
        ]
      }
    ])
  ];
  const contexto = tablero(tareas);
  const control = globalThis.LRControl.contar(
    {cerrados: [], tareas, subtareas: (t) => vm.runInContext('pendingSubtasks', contexto)(t)},
    'Jorge Luis',
    '2026-11-16',
    '2026-11'
  );
  assert.equal(control.tareasDia, 1, 'la tarea vale por una, no por sus hitos');
  assert.equal(control.tareasMes, 1);

  const llevado = JSON.parse(vm.runInContext('JSON.stringify(subtasksDoneByUserMap(tasks[0]))', contexto));
  assert.deepEqual(llevado, {'2026-11-16': {jorge: 1}}, 'al historial tampoco viajan los hitos como trabajos');
}

// ── La lista y el estado de la tarea no se arrastran ──────────────────────
{
  const tareas = [
    pendiente('Reportes', [
      {
        id: 'revisar',
        title: 'Revisar los reportes',
        checklist: [{id: 'h1', title: 'Reporte Amador'}, {id: 'h2', title: 'Reporte RB'}]
      }
    ])
  ];
  const contexto = tablero(tareas);
  // Marcar todos los hitos no cierra la tarea sola: el «Hecho» sigue siendo de quien trabaja.
  vm.runInContext(`togglePendingSubtaskChecklistItem('task-001', 'revisar', 'h1')`, contexto);
  vm.runInContext(`togglePendingSubtaskChecklistItem('task-001', 'revisar', 'h2')`, contexto);
  assert.equal(vm.runInContext(`pendingSubtasks(tasks[0])[0].status`, contexto), 'Pendiente');

  // Y cerrar la tarea no toca los hitos: la lista queda como quedó.
  vm.runInContext(`togglePendingSubtask('task-001', 'revisar')`, contexto);
  assert.equal(vm.runInContext(`pendingSubtasks(tasks[0])[0].status`, contexto), 'Completado');
  assert.deepEqual(lista(contexto).map((h) => h.done), [true, true]);
}

// ── Una tarea compartida lleva su lista a la otra fila ────────────────────
{
  const tareas = [
    pendiente('Proyecto de Reportes', [
      {id: 'origen', title: 'Revisar los reportes', syncId: 'par-1'}
    ]),
    pendiente('LUNES 16', [
      {
        id: 'copia',
        title: 'Revisar los reportes',
        syncId: 'par-1',
        syncFromTaskId: 'task-001',
        syncFromTitle: 'Proyecto de Reportes'
      }
    ])
  ];
  const contexto = tablero(tareas);
  vm.runInContext(`addPendingSubtaskChecklistItem('task-001', 'origen', 'Reporte Amador')`, contexto);
  const enLaCopia = lista(contexto, 1);
  assert.deepEqual(enLaCopia.map((h) => h.title), ['Reporte Amador'], 'la lista llega a la otra fila');

  // Y marcar el hito en la copia se ve en el original: es la misma tarea en dos tableros.
  const idHito = enLaCopia[0].id;
  vm.runInContext(`togglePendingSubtaskChecklistItem('task-002', 'copia', '${idHito}')`, contexto);
  assert.equal(lista(contexto, 0)[0].done, true);
}

// ── Al fusionar, un hito borrado no revive ────────────────────────────────
{
  const contexto = tablero([]);
  const viejo = [
    {
      id: 'revisar',
      title: 'Revisar los reportes',
      updatedAt: '2026-11-16T10:00:00.000Z',
      checklist: [{id: 'h1', title: 'Reporte Amador'}, {id: 'h2', title: 'Reporte RB'}]
    }
  ];
  const nuevo = [
    {
      id: 'revisar',
      title: 'Revisar los reportes',
      updatedAt: '2026-11-16T12:00:00.000Z',
      checklist: [{id: 'h1', title: 'Reporte Amador'}]
    }
  ];
  const fusionado = JSON.parse(
    vm.runInContext(
      `JSON.stringify(mergePendingSubtaskLists(${JSON.stringify(viejo)}, ${JSON.stringify(nuevo)}))`,
      contexto
    )
  );
  assert.deepEqual(
    fusionado[0].checklist.map((h) => h.id),
    ['h1'],
    'manda la versión editada más tarde: el hito borrado no vuelve con el estado viejo de la BBDD'
  );
}

// ── Una tarea diaria sí tiene lista ───────────────────────────────────────
{
  const tareas = [pendiente('LUNES 16', [{id: 'ppt', title: 'Enviar PPT por LinkedIn', daily: true}])];
  const contexto = tablero(tareas);
  assert.equal(
    vm.runInContext(`addPendingSubtaskChecklistItem('task-001', 'ppt', 'Copiar el mensaje en un doc')`, contexto),
    'ok',
    'lo bloqueado en una diaria es la fila (nombre, orden, borrado), no lo que lleva dentro'
  );
  assert.equal(lista(contexto).length, 1);
}

// ── Con el pendiente abierto por el otro usuario no se toca nada ──────────
{
  const tareas = [pendiente('Reportes', [{id: 'revisar', title: 'Revisar', checklist: [{id: 'h1', title: 'Uno'}]}])];
  const contexto = tablero(tareas, {bloqueado: true});
  assert.equal(vm.runInContext(`addPendingSubtaskChecklistItem('task-001', 'revisar', 'Dos')`, contexto), 'bloqueada');
  assert.equal(vm.runInContext(`togglePendingSubtaskChecklistItem('task-001', 'revisar', 'h1')`, contexto), false);
  assert.equal(vm.runInContext(`deletePendingSubtaskChecklistItem('task-001', 'revisar', 'h1')`, contexto), false);
  assert.deepEqual(contexto.guardados, [], 'nada se guarda');
}

console.log('ok · tarea-lista: la tarea interna lleva su lista de hitos, que no cuenta como trabajo aparte');
