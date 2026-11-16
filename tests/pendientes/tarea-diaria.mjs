// La tarea diaria se desmarca sola al día siguiente.
//
// Una diaria es la que se hace todos los días («Enviar PPT por LinkedIn»), así que su check vale
// solo para el día en que se puso: a la mañana siguiente tiene que volver a salir pendiente sin
// que nadie le dé a «Reabrir». Antes se quedaba tachada hasta que alguien se acordaba, y el
// tablero del día decía que ya estaba hecha.
//
// Lo que se prueba aquí es lo que no se ve marcando la casilla una vez:
//   · El check de AYER se borra; el de HOY no se toca.
//   · Lo que se borra no se pierde: queda anotado en `dailyLog` con el día y la persona, para que
//     el control del mes —el del tablero y el del correo de la 1 y las 5— siga contando esa tarea
//     en el día en que se hizo. Sin esto, la diaria no sumaba nada al mes.
//   · Solo le pasa a las diarias: una tarea interna normal terminada ayer sigue terminada.
//   · Si la diaria está compartida con otro tablero, la otra fila se desmarca igual.
//   · Al fusionar con el estado del otro navegador, los días cerrados se suman, no se pisan.
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
  'isDailySubtask',
  'normalizeSubtaskDailyLog',
  'mergeSubtaskDailyLogs',
  'subtaskDailyLog',
  'normalizePendingSubtask',
  'pendingSubtaskBlocks',
  'flattenPendingSubtaskBlocks',
  'pendingSubtasks',
  'localDayKey',
  'suitePersonKey',
  'subtaskSyncId',
  'findSyncedSubtaskPartner',
  'propagateSubtaskSync',
  'subtasksDoneByUserMap',
  'resetDailySubtasks'
];

// El reloj de la prueba: hoy es el martes 10 de noviembre de 2026 en Lima.
const HOY = '2026-11-10';
const AYER = '2026-11-09';
const ANTEAYER = '2026-11-08';

function tablero(tareas) {
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
    // Ningún cronómetro ajeno: lo que bloquea una tarea se prueba en su propia suite.
    isTaskLockedByOtherUser: () => false,
    currentSuiteUserName: () => 'Jorge Luis',
    saveTaskState: (motivo) => contexto.guardados.push(motivo?.reason || '')
  };
  vm.createContext(contexto);
  vm.runInContext(
    [constante('SUBTASK_DAILY_LOG_DAYS'), constante('SUBTASK_SYNC_FIELDS'), ...FUNCIONES.map(extraer)].join('\n'),
    contexto
  );
  return contexto;
}

// Un pendiente del tablero: [título, responsable, prioridad, estado, …, subtareas].
function pendiente(titulo, subtareas) {
  const task = ['LUNES 9', 'Jorge Luis', 'Alta', 'Pendiente', '', '', '', '', '', []];
  task[SUBTAREAS] = subtareas;
  task[0] = titulo;
  return task;
}

// ── El check de ayer se borra, el de hoy se queda ──────────────────────────
{
  const tareas = [
    pendiente('MARTES 10', [
      {
        id: 'ppt',
        title: 'Enviar PPT por LinkedIn',
        daily: true,
        status: 'Completado',
        completedAt: `${AYER}T14:00:00-05:00`,
        completedBy: 'Jorge Luis'
      },
      {
        id: 'reportes',
        title: 'Revisar los reportes de Resultados',
        daily: true,
        status: 'Completado',
        completedAt: `${HOY}T09:30:00-05:00`,
        completedBy: 'Diego'
      },
      {
        id: 'normal',
        title: 'Cerrar la propuesta de Royal Baby',
        status: 'Completado',
        completedAt: `${AYER}T16:00:00-05:00`,
        completedBy: 'Diego'
      }
    ])
  ];
  const contexto = tablero(tareas);
  contexto.Date = class extends Date {
    constructor(...args) {
      super(...(args.length ? args : [`${HOY}T11:00:00-05:00`]));
    }
    static now() {
      return new Date(`${HOY}T11:00:00-05:00`).getTime();
    }
  };
  vm.runInContext('resetDailySubtasks();', contexto);

  const subtareas = vm.runInContext('pendingSubtasks(tasks[0])', contexto);
  const porId = Object.fromEntries(subtareas.map((s) => [s.id, s]));

  assert.equal(porId.ppt.status, 'Pendiente', 'la diaria marcada ayer tiene que volver a salir pendiente');
  assert.equal(porId.ppt.completedAt, '', 'y sin fecha de cierre, como si nadie la hubiera marcado hoy');
  assert.equal(porId.ppt.completedBy, '');
  assert.deepEqual(porId.ppt.dailyLog, {[AYER]: 'jorge'}, 'el cierre de ayer queda anotado, no se tira');

  assert.equal(porId.reportes.status, 'Completado', 'el check de HOY no se toca');
  assert.equal(porId.reportes.completedAt, `${HOY}T09:30:00-05:00`);

  assert.equal(porId.normal.status, 'Completado', 'una tarea interna normal terminada ayer sigue terminada');

  assert.deepEqual(contexto.guardados, ['diaria-reabierta'], 'el cambio se guarda una sola vez');

  // Sin nada que desmarcar, no se vuelve a guardar: un guardado por render sería ruido en la BBDD.
  contexto.guardados.length = 0;
  vm.runInContext('resetDailySubtasks();', contexto);
  assert.deepEqual(contexto.guardados, [], 'una segunda pasada del mismo día no guarda nada');
}

// ── El control del mes sigue contando lo que la diaria cerró ───────────────
{
  const subtarea = {
    id: 'ppt',
    title: 'Enviar PPT por LinkedIn',
    daily: true,
    owner: 'Jorge Luis',
    dailyLog: {[AYER]: 'jorge', [ANTEAYER]: 'jorge'},
    status: 'Completado',
    completedAt: `${HOY}T09:00:00-05:00`,
    completedBy: 'Jorge Luis'
  };
  const tareas = [pendiente('MARTES 10', [subtarea])];
  const contexto = tablero(tareas);

  const control = globalThis.LRControl.contar(
    {cerrados: [], tareas, subtareas: (t) => vm.runInContext('pendingSubtasks', contexto)(t)},
    'Jorge Luis',
    HOY,
    '2026-11'
  );
  assert.equal(control.tareasDia, 1, 'hoy cuenta una sola vez: el check de hoy, no los del historial');
  assert.equal(control.tareasMes, 3, 'en el mes cuentan los tres días que la diaria se cerró');

  // Lo que el pendiente se lleva al historial cuando se cierra: los tres días, no solo hoy.
  // JSON de por medio: lo que sale del vm vive en otro realm y no es deepStrictEqual a un objeto de aquí.
  const llevado = JSON.parse(vm.runInContext('JSON.stringify(subtasksDoneByUserMap(tasks[0]))', contexto));
  assert.deepEqual(llevado, {[ANTEAYER]: {jorge: 1}, [AYER]: {jorge: 1}, [HOY]: {jorge: 1}});
}

// ── Una diaria compartida con otro tablero se desmarca en las dos filas ────
{
  const tareas = [
    pendiente('Proyecto de TLM', [
      {
        id: 'origen',
        title: 'Enviar PPT por LinkedIn',
        daily: true,
        syncId: 'par-1',
        status: 'Completado',
        completedAt: `${AYER}T14:00:00-05:00`,
        completedBy: 'Jorge Luis'
      }
    ]),
    pendiente('MARTES 10', [
      {
        id: 'copia',
        title: 'Enviar PPT por LinkedIn',
        syncId: 'par-1',
        syncFromTaskId: 'proyecto-tlm',
        syncFromTitle: 'Proyecto de TLM',
        status: 'Completado',
        completedAt: `${AYER}T14:00:00-05:00`,
        completedBy: 'Jorge Luis'
      }
    ])
  ];
  const contexto = tablero(tareas);
  contexto.Date = class extends Date {
    constructor(...args) {
      super(...(args.length ? args : [`${HOY}T11:00:00-05:00`]));
    }
    static now() {
      return new Date(`${HOY}T11:00:00-05:00`).getTime();
    }
  };
  vm.runInContext('resetDailySubtasks();', contexto);

  const copia = vm.runInContext('pendingSubtasks(tasks[1])[0]', contexto);
  assert.equal(copia.status, 'Pendiente', 'la otra fila de la tarea compartida se desmarca igual');
  assert.equal(copia.completedAt, '');
}

// ── Al fusionar, los días cerrados se suman y no se pisan ──────────────────
{
  const contexto = tablero([]);
  const unidos = vm.runInContext(
    `mergeSubtaskDailyLogs({'${ANTEAYER}': 'jorge'}, {'${AYER}': 'diego'})`,
    contexto
  );
  assert.deepEqual(unidos, {[AYER]: 'diego', [ANTEAYER]: 'jorge'});

  // El estado compartido se baja entero en cada sincronización: el historial no puede crecer sin fin.
  const tope = vm.runInContext('SUBTASK_DAILY_LOG_DAYS', contexto);
  const largo = {};
  for (let i = 0; i < tope + 40; i += 1) {
    largo[`2026-${String(1 + (i % 9)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`] = 'jorge';
  }
  const recortado = vm.runInContext('normalizeSubtaskDailyLog', contexto)(largo);
  assert.ok(Object.keys(recortado).length <= tope, 'el historial de la diaria se recorta a los últimos días');

  // Basura de un estado viejo: ni días inventados ni personas vacías.
  const limpio = vm.runInContext('normalizeSubtaskDailyLog', contexto)({
    'ayer': 'jorge',
    [AYER]: '',
    [HOY]: 'diego'
  });
  assert.deepEqual(limpio, {[HOY]: 'diego'});
}

console.log('ok · tarea-diaria: el check de la diaria se borra solo al día siguiente y el cierre sigue contando');
