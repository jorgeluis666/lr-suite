// El reloj de avance de una tarea interna: «¿cuánto va de esto?».
//
// El tablero solo sabía decir «pendiente» o «hecha», y una tarea de tres semanas estaba igual de
// pendiente el primer día que el penúltimo. Ahora cada tarea interna lleva un reloj al lado del
// robot: se pulsa, sale un deslizador de 0 a 100 % y el anillo se llena como la aguja de un reloj.
//
// Lo que se prueba aquí es lo que no se ve moviendo el deslizador una vez:
//   · El avance se guarda en saltos de 5 y recortado a 0-100: nada de 7.3 ni de 140 %.
//   · Soltar el deslizador donde ya estaba no estampa la tarea (eso despertaría una sincronización
//     por nada y pondría esta versión por delante de la del otro usuario al fusionar).
//   · Marcar «Hecho» pone el reloj al 100 % y apunta en qué iba, así que reabrirla lo devuelve.
//     Un 100 % puesto a mano no deja nada apuntado y aguanta la reapertura.
//   · La diaria que se desmarca sola al día siguiente también recupera su avance.
//   · Una tarea compartida con otro tablero enseña el mismo reloj en las dos filas.
//   · Al fusionar manda el último movimiento del deslizador, NO la versión más nueva de la tarea:
//     es la misma trampa que ya se arregló con la marca de diaria y la del robot.
//   · El anillo que se dibuja: la vuelta entera del CSS y la del guion tienen que ser la misma,
//     porque están escritas en dos sitios.
process.env.TZ = 'America/Lima';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
// La diaria que se desmarca sola apunta quién la cerró, y esa cuenta vive en el control.
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
  'normalizeSubtaskChecklistItem',
  'normalizeSubtaskChecklist',
  'subtaskChecklist',
  'isDailySubtask',
  'subtaskDailyStamp',
  'mergeSubtaskDailyMark',
  'isClaudeSubtask',
  'subtaskClaudeStamp',
  'mergeSubtaskClaudeMark',
  'normalizeSubtaskProgress',
  'normalizeSubtaskProgressBack',
  'completeSubtaskProgress',
  'reopenSubtaskProgress',
  'subtaskProgressStamp',
  'mergeSubtaskProgressMark',
  'subtaskProgressLabel',
  'subtaskGaugeTip',
  'subtaskGaugeOffset',
  'pendingSubtaskGaugeIcon',
  'normalizeSubtaskDailyLog',
  'mergeSubtaskDailyLogs',
  'subtaskDailyLog',
  'normalizePendingSubtask',
  'pendingSubtaskBlocks',
  'flattenPendingSubtaskBlocks',
  'pendingSubtasks',
  'localDayKey',
  'suitePersonKey',
  'findPendingTaskById',
  'subtaskSyncId',
  'findSyncedSubtaskPartner',
  'propagateSubtaskSync',
  'setPendingSubtaskProgress',
  'togglePendingSubtask',
  'resetDailySubtaskChecklist',
  'resetDailySubtasks',
  'mergePendingSubtaskLists'
];

// El reloj de la prueba: hoy es el martes 10 de noviembre de 2026 en Lima.
const HOY = '2026-11-10';
const AYER = '2026-11-09';

function tablero(tareas) {
  const contexto = {
    window: {LRControl: globalThis.LRControl},
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
    SUBTASK_FOLLOWUP_TITLE_LIMIT: indice('SUBTASK_FOLLOWUP_TITLE_LIMIT'),
    SUBTASK_SYNC_TITLE_LIMIT: indice('SUBTASK_SYNC_TITLE_LIMIT'),
    SUBTASK_LINKS_LIMIT: indice('SUBTASK_LINKS_LIMIT'),
    SUBTASK_LINK_LABEL_LIMIT: indice('SUBTASK_LINK_LABEL_LIMIT'),
    SUBTASK_LINK_SCHEMES: ['http:', 'https:', 'mailto:'],
    tasks: tareas,
    lastTaskStamp: 0,
    guardados: [],
    // Ningún cronómetro ajeno ni nada borrado: eso se prueba en sus propias suites.
    isTaskLockedByOtherUser: () => false,
    canCurrentUserControlTask: () => true,
    currentSuiteUserName: () => 'Jorge Luis',
    taskTombstones: () => ({}),
    saveTaskState: (motivo) => contexto.guardados.push(motivo?.reason || '')
  };
  vm.createContext(contexto);
  vm.runInContext(
    [
      constante('SUBTASK_CHECKLIST_LIMIT'),
      constante('SUBTASK_CHECKLIST_TITLE_LIMIT'),
      constante('SUBTASK_DAILY_LOG_DAYS'),
      constante('SUBTASK_PROGRESS_STEP'),
      constante('SUBTASK_GAUGE_RADIUS'),
      constante('SUBTASK_GAUGE_LENGTH'),
      constante('SUBTASK_SYNC_FIELDS'),
      ...FUNCIONES.map(extraer)
    ].join('\n'),
    contexto
  );
  return contexto;
}

// Un pendiente del tablero: [título, responsable, prioridad, estado, …, id, …, subtareas].
function pendiente(id, titulo, subtareas) {
  const tarea = ['', 'Jorge Luis', 'Alta', 'Pendiente', '', '', id, '2026-11-09T10:00:00.000Z', '', []];
  tarea[0] = titulo;
  tarea[SUBTAREAS] = subtareas;
  return tarea;
}

function porId(contexto, indiceTarea = 0) {
  const subtareas = vm.runInContext(`pendingSubtasks(tasks[${indiceTarea}])`, contexto);
  return Object.fromEntries(subtareas.map((s) => [s.id, s]));
}

// ── El deslizador guarda un número limpio ─────────────────────────────────
{
  const contexto = tablero([
    pendiente('proyecto', 'OPTIMIZAR LAS VENTAS', [{id: 'modulo', title: 'Termina el Módulo Pérdidas y Ganancias'}])
  ]);
  const mover = (valor) =>
    vm.runInContext(`setPendingSubtaskProgress('proyecto', 'modulo', ${JSON.stringify(valor)})`, contexto);

  assert.equal(mover(55), true, 'mover el deslizador cambia la tarea');
  assert.equal(porId(contexto).modulo.progress, 55);
  assert.deepEqual(contexto.guardados, ['subtarea-avance'], 'y se guarda una sola vez');

  // Soltarlo donde ya estaba no es un cambio: estampar la tarea por nada la pondría por delante
  // de la del otro usuario al fusionar, y despertaría una sincronización que no hace falta.
  contexto.guardados.length = 0;
  assert.equal(mover(55), false, 'soltar el deslizador en el mismo sitio no cambia nada');
  assert.deepEqual(contexto.guardados, [], 'y no se guarda');

  // El deslizador va de 5 en 5; lo que llegue de otra parte se endereza igual.
  assert.equal(mover(37), true);
  assert.equal(porId(contexto).modulo.progress, 35, 'el avance se redondea al salto de 5');
  mover(999);
  assert.equal(porId(contexto).modulo.progress, 100, 'más de 100 % no existe');
  mover(-40);
  assert.equal(porId(contexto).modulo.progress, 0, 'ni menos de 0 %');

  // Datos sucios de un estado viejo: el reloj nunca se queda con un NaN dentro.
  const limpiar = vm.runInContext('normalizeSubtaskProgress', contexto);
  assert.equal(limpiar(undefined), 0);
  assert.equal(limpiar(''), 0);
  assert.equal(limpiar('mitad'), 0);
  assert.equal(limpiar('65'), 65, 'un número que llega como texto sí vale');

  // La fecha propia del avance: es lo que manda al fusionar.
  mover(80);
  assert.ok(porId(contexto).modulo.progressAt, 'el movimiento deja su propia fecha');
  assert.equal(
    porId(contexto).modulo.progressAt,
    porId(contexto).modulo.updatedAt,
    'la fecha del avance es la del movimiento, no una inventada'
  );
}

// ── «Hecho» pone el reloj al 100 %, y reabrir lo devuelve ─────────────────
{
  const contexto = tablero([
    pendiente('proyecto', 'OPTIMIZAR LAS VENTAS', [
      {id: 'medicion', title: 'Presentación servicio de medición', progress: 55}
    ])
  ]);
  const check = () => vm.runInContext(`togglePendingSubtask('proyecto', 'medicion')`, contexto);

  check();
  let tarea = porId(contexto).medicion;
  assert.equal(tarea.status, 'Completado');
  assert.equal(tarea.progress, 100, 'una tarea hecha no se queda marcando el 55 %');
  assert.equal(tarea.progressBack, 55, 'pero se apunta en qué iba, por si fue un clic sin querer');

  check();
  tarea = porId(contexto).medicion;
  assert.equal(tarea.status, 'Pendiente');
  assert.equal(tarea.progress, 55, 'al reabrirla el reloj vuelve a donde estaba');
  assert.equal(tarea.progressBack, null, 'y lo apuntado se borra, que ya se usó');
}

// ── Un 100 % puesto a mano aguanta la reapertura ──────────────────────────
// Si lo subió una persona con el deslizador no hay nada que devolver: la tarea vuelve a estar
// abierta al 100 %, que es justo lo que esa persona dijo.
{
  const contexto = tablero([
    pendiente('proyecto', 'OPTIMIZAR LAS VENTAS', [{id: 'pyg', title: 'Termina el Módulo', progress: 100}])
  ]);
  vm.runInContext(`togglePendingSubtask('proyecto', 'pyg')`, contexto);
  assert.equal(porId(contexto).pyg.progressBack, null, 'nada que apuntar: ya estaba al 100 %');
  vm.runInContext(`togglePendingSubtask('proyecto', 'pyg')`, contexto);
  assert.equal(porId(contexto).pyg.progress, 100, 'reabrirla la deja al 100 %, como estaba');
}

// ── Una tarea en 0 % vuelve a 0 %, no se queda en 100 ─────────────────────
// El cero es un avance como cualquier otro: si el hueco apuntado se confundiera con «no hay nada
// apuntado», una tarea sin empezar que se marca y se reabre se quedaría terminada para siempre.
{
  const contexto = tablero([
    pendiente('proyecto', 'OPTIMIZAR LAS VENTAS', [{id: 'cero', title: 'Plan de comunicación'}])
  ]);
  vm.runInContext(`togglePendingSubtask('proyecto', 'cero')`, contexto);
  assert.equal(porId(contexto).cero.progress, 100);
  assert.equal(porId(contexto).cero.progressBack, 0, 'el 0 % se apunta como cualquier otro avance');
  vm.runInContext(`togglePendingSubtask('proyecto', 'cero')`, contexto);
  assert.equal(porId(contexto).cero.progress, 0, 'y la tarea reabierta vuelve a estar sin empezar');
}

// ── El seguimiento no lleva reloj ─────────────────────────────────────────
// Se dibuja dentro de la fila de su origen, así que no tiene botón: tampoco debe ensuciarse con
// un avance al terminarse.
{
  const contexto = tablero([
    pendiente('proyecto', 'OPTIMIZAR LAS VENTAS', [
      {id: 'origen', title: 'Gancho Auditoría Google Ads'},
      {id: 'seguimiento', title: 'Revisar la actualización', followUpOf: 'origen', followUpTitle: 'Gancho Auditoría'}
    ])
  ]);
  vm.runInContext(`togglePendingSubtask('proyecto', 'seguimiento')`, contexto);
  const seguimiento = porId(contexto).seguimiento;
  assert.equal(seguimiento.status, 'Completado');
  assert.equal(seguimiento.progress, 0, 'el seguimiento no se queda con un avance que no enseña');
  assert.equal(seguimiento.progressBack, null);
}

// ── La diaria que se desmarca sola también recupera su avance ─────────────
{
  const contexto = tablero([
    pendiente('dia', 'MARTES 10', [
      {
        id: 'ppt',
        title: 'Enviar PPT por LinkedIn',
        daily: true,
        progress: 100,
        progressBack: 30,
        status: 'Completado',
        completedAt: `${AYER}T14:00:00-05:00`,
        completedBy: 'Jorge Luis'
      }
    ])
  ]);
  contexto.Date = class extends Date {
    constructor(...args) {
      super(...(args.length ? args : [`${HOY}T11:00:00-05:00`]));
    }
    static now() {
      return new Date(`${HOY}T11:00:00-05:00`).getTime();
    }
  };
  vm.runInContext('resetDailySubtasks();', contexto);
  const ppt = porId(contexto).ppt;
  assert.equal(ppt.status, 'Pendiente', 'la diaria vuelve a salir pendiente');
  assert.equal(ppt.progress, 30, 'y su reloj no amanece en 100 %');
  assert.equal(ppt.progressBack, null);
}

// ── La tarea compartida enseña el mismo reloj en los dos tableros ─────────
{
  const contexto = tablero([
    pendiente('proyecto', 'Proyecto de TLM', [
      {id: 'origen', title: 'Armar la presentación', syncId: 'par-1'}
    ]),
    pendiente('dia', 'MARTES 10', [
      {
        id: 'copia',
        title: 'Armar la presentación',
        syncId: 'par-1',
        syncFromTaskId: 'proyecto',
        syncFromTitle: 'Proyecto de TLM'
      }
    ])
  ]);

  vm.runInContext(`setPendingSubtaskProgress('proyecto', 'origen', 45)`, contexto);
  assert.equal(porId(contexto, 1).copia.progress, 45, 'mover el reloj en el proyecto lo mueve en el día');

  // Y al terminarla desde la fila del día, las dos llegan al 100 % con el mismo respaldo.
  vm.runInContext(`togglePendingSubtask('dia', 'copia')`, contexto);
  assert.equal(porId(contexto, 0).origen.progress, 100);
  assert.equal(porId(contexto, 0).origen.progressBack, 45, 'el respaldo viaja también: se reabre desde cualquiera');

  vm.runInContext(`togglePendingSubtask('proyecto', 'origen')`, contexto);
  assert.equal(porId(contexto, 1).copia.progress, 45, 'reabrir en el proyecto devuelve el reloj en el día');
}

// ── Al fusionar manda el último movimiento del deslizador ─────────────────
// La trampa de siempre: la fusión se queda con la versión de la tarea editada más tarde. Una
// pestaña con el estado viejo estampa la tarea por otra cosa (el salto de día, el orden) y, por ser
// más nueva, borraba el avance que nadie había tocado. Por eso el avance lleva su propia fecha.
{
  const contexto = tablero([]);
  const fusionar = (...listas) => vm.runInContext('mergePendingSubtaskLists', contexto)(...listas);

  const movida = {
    id: 'modulo',
    title: 'Termina el Módulo',
    progress: 70,
    progressAt: `${AYER}T09:00:00.000Z`,
    updatedAt: `${AYER}T09:00:00.000Z`
  };
  const arrastrada = {
    id: 'modulo',
    title: 'Termina el Módulo',
    carriedFrom: 'LUNES 9',
    updatedAt: `${HOY}T06:00:00.000Z`
  };

  assert.equal(fusionar([movida], [arrastrada])[0].progress, 70, 'el avance aguanta a una versión más nueva');
  assert.equal(fusionar([arrastrada], [movida])[0].progress, 70, 'da igual en qué orden lleguen');
  assert.equal(fusionar([movida], [arrastrada])[0].carriedFrom, 'LUNES 9', 'el resto de la versión nueva sí entra');

  // Bajarlo a mano sí se respeta: el deslizador deja su fecha, y la más nueva manda.
  const bajada = {
    id: 'modulo',
    title: 'Termina el Módulo',
    progress: 20,
    progressAt: `${HOY}T08:00:00.000Z`,
    updatedAt: `${HOY}T08:00:00.000Z`
  };
  assert.equal(fusionar([movida], [bajada])[0].progress, 20, 'bajar el avance con el deslizador sí lo baja');
  assert.equal(fusionar([bajada], [movida])[0].progress, 20, 'y no vuelve a subir porque llegue el estado viejo');

  // Datos de antes de este campo: sin ninguna fecha que comparar se queda el avance mayor, que es
  // trabajo hecho que nadie pidió deshacer.
  const vieja = {id: 'modulo', title: 'Termina el Módulo', progress: 60, updatedAt: `${AYER}T09:00:00.000Z`};
  const sinAvance = {id: 'modulo', title: 'Termina el Módulo', updatedAt: `${HOY}T06:00:00.000Z`};
  assert.equal(fusionar([vieja], [sinAvance])[0].progress, 60, 'un avance de antes del cambio tampoco se pierde');
  assert.equal(fusionar([sinAvance], [vieja])[0].progress, 60);
}

// ── El anillo que se dibuja ───────────────────────────────────────────────
{
  const contexto = tablero([]);
  const hueco = vm.runInContext('subtaskGaugeOffset', contexto);
  const vuelta = vm.runInContext('SUBTASK_GAUGE_LENGTH', contexto);
  const radio = vm.runInContext('SUBTASK_GAUGE_RADIUS', contexto);

  assert.equal(Number(hueco(0)), vuelta, 'en 0 % el anillo está entero sin pintar');
  assert.equal(Number(hueco(100)), 0, 'en 100 % no queda hueco');
  assert.ok(Math.abs(Number(hueco(50)) - vuelta / 2) < 0.01, 'la mitad es media vuelta');

  // La aguja arranca a las 12 y gira como un reloj: 25 % son las 3, 50 % las 6.
  // Lo que sale del vm vive en otro realm, así que se comparan los campos, no el objeto.
  const punta = (valor) => {
    const p = vm.runInContext('subtaskGaugeTip', contexto)(valor);
    return `${p.x},${p.y}`;
  };
  assert.equal(punta(0), `12.00,${(12 - radio).toFixed(2)}`, 'el 0 % está a las 12');
  assert.equal(punta(25), `${(12 + radio).toFixed(2)},12.00`, 'el 25 % está a las 3');
  assert.equal(punta(50), `12.00,${(12 + radio).toFixed(2)}`, 'el 50 % está a las 6');
  assert.equal(punta(75), `${(12 - radio).toFixed(2)},12.00`, 'el 75 % está a las 9');

  // La vuelta entera está escrita dos veces —aquí y en el CSS del botón— porque el anillo se
  // dibuja con CSS. Si alguien cambia el radio y se olvida de la otra, el anillo queda cortado.
  const enElCss = html.match(/--gauge-length:\s*([\d.]+)/);
  assert.ok(enElCss, 'el CSS del reloj tiene que declarar --gauge-length');
  assert.equal(Number(enElCss[1]), vuelta, 'la vuelta del CSS y la del guion tienen que ser la misma');
  assert.ok(Math.abs(vuelta - 2 * Math.PI * radio) < 0.01, 'y las dos tienen que ser la vuelta real del radio');

  // El número de dentro: el porcentaje, y un visto al llegar a 100 porque tres cifras no caben.
  const icono = vm.runInContext('pendingSubtaskGaugeIcon', contexto);
  assert.match(icono(40), />40</, 'el reloj enseña el número dentro');
  assert.match(icono(100), />✓</, 'y un visto cuando está terminado');
  assert.match(icono(0), /gauge-track/, 'el aro de fondo se dibuja siempre');

  // Lo que se lee al pasar el ratón.
  const texto = vm.runInContext('subtaskProgressLabel', contexto);
  assert.match(texto(0), /pulsa y mueve el deslizador/i);
  assert.match(texto(40), /40 %/);
  assert.match(texto(100), /terminado/i);
}

console.log('ok · tarea-avance: el reloj de cada tarea interna se guarda, sigue al check y no se cae al fusionar');
