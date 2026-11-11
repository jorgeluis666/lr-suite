// Los dos mensajes del día del agente de Pendientes: el resumen al abrir la app y el análisis de
// las 7:30 p. m.
//
// Lo que se comprueba aquí es lo que no se ve mirando la pantalla una vez:
//   · Quién ve el trabajo de quién. Diego ve lo suyo; Jorge Luis ve lo de Diego y lo suyo. Si esto
//     se invierte, Diego se encuentra el tablero del otro sin haberlo pedido.
//   · Que las cifras salgan del historial y no de un recuento propio: las eliminadas no cuentan y
//     el día es el día de Lima, no el de UTC (un cierre de las 8 p. m. caía en el día siguiente).
//   · Que «el día anterior» sea ayer salvo que ayer esté vacío: un lunes, el resumen de un domingo
//     sin movimiento no le dice nada a nadie.
//   · Que el mensaje de cierre llegue a las 7:30 p. m. y no antes, y que ninguno de los dos se
//     repita en la misma jornada.
//   · Que los dos los escriba el navegador: ninguna llamada al modelo por abrir la app.
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

// Las constantes se leen del archivo y no se copian aquí: así la hora del cierre que se prueba es
// la que de verdad corre en la app.
function constante(nombre) {
  const linea = html.match(new RegExp(`\\n\\s*const ${nombre} = [^\\n]+`));
  assert.ok(linea, `no se encontró la constante ${nombre}`);
  return linea[0].trim();
}

// Un reloj detenido: las dos funciones miran la hora para decidir qué día resumen y si ya son las
// 7:30 p. m.
function relojEn(iso) {
  const Real = Date;
  return class Detenido extends Real {
    constructor(...args) {
      super(...(args.length ? args : [iso]));
    }
    static now() {
      return new Real(iso).getTime();
    }
  };
}

const HOY = '2026-11-10'; // martes
const AYER = '2026-11-09'; // lunes

// ── El tablero de la prueba ───────────────────────────────────────────────
// Un cierre de Diego de las 8 de la noche de Lima: en UTC ya es el día 10, y tiene que contar como
// del 9. Es el error que arrastraba el correo antes de control.js.
const HISTORIAL = [
  {
    title: 'Informe de Royal Baby', completedBy: 'Diego', completedAt: '2026-11-10T01:00:00Z',
    totalSeconds: 7500, dailySecondsByUser: {[AYER]: {diego: 7500}}, startDate: '2026-11-05'
  },
  {
    title: 'Pauta de TLM', completedBy: 'Jorge Luis', completedAt: '2026-11-09T15:00:00Z',
    totalSeconds: 1800, dailySecondsByUser: {[AYER]: {jorge: 1800}}, startDate: '2026-11-09'
  },
  {
    title: 'Carpeta que se borró', completedBy: 'Diego', completedAt: '2026-11-09T16:00:00Z',
    action: 'eliminada', totalSeconds: 99999, dailySecondsByUser: {[AYER]: {diego: 99999}}
  },
  // Cerrado hoy, arrastrado desde octubre: es el que más días tardó en terminarse.
  {
    title: 'Migración de la hoja vieja', completedBy: 'Diego', completedAt: '2026-11-10T14:00:00Z',
    totalSeconds: 5400, dailySecondsByUser: {[HOY]: {diego: 5400}}, startDate: '2026-10-28',
    subtasksDoneByUser: {[AYER]: {diego: 2}}
  },
  // De antes de que se guardara el tiempo por día: solo tiene total.
  {
    title: 'Revisión antigua', completedBy: 'Jorge Luis', completedAt: '2026-11-07T15:00:00Z',
    totalSeconds: 600, startDate: '2026-11-07'
  }
];

const ABIERTAS = [
  // [titulo, responsable, fin, estado, prioridad, inicio, ?, creado, ?, subtareas]
  ['Tablero de Global Beverages', 'Jorge Luis', '2026-11-12', 'En proceso', 'Alta', '2026-11-06', '', '2026-11-06T12:00:00Z', '', [
    {id: 's1', title: 'Armar las métricas', status: 'Completado', completedAt: '2026-11-09T18:00:00Z', completedBy: 'Jorge Luis'},
    {id: 's2', title: 'Publicar', status: 'Pendiente'}
  ]],
  ['Alertas de Meta por marca', 'Diego', '2026-11-05', 'Pendiente', 'Media', '2026-11-03', '', '2026-11-03T12:00:00Z', '', []]
];

const guardado = {};
const avisos = [];
const contexto = {
  Date: relojEn(`${HOY}T10:00:00-05:00`),
  JSON, String, Number, Array, Object, Math, Boolean, Intl, RegExp,
  console: {warn: () => {}},
  window: {LRControl: globalThis.LRControl, setInterval: () => 1},
  document: {addEventListener: () => {}, hidden: false},
  tasks: ABIERTAS,
  completedTasks: HISTORIAL,
  taskTimer: {dailyById: {'id-0': {[HOY]: {jorge: 10800}}}},
  // Quien está mirando la pantalla. La prueba lo cambia para ver los dos casos.
  quien: 'Diego',
  currentSuiteUserName: () => contexto.quien,
  hasSuiteAccess: () => true,
  agenteResponsables: () => ['Diego', 'Jorge Luis'],
  suitePersonKey: (valor) => globalThis.LRControl.persona(valor),
  isSameSuitePerson: (izquierda, derecha) => {
    const a = globalThis.LRControl.persona(izquierda);
    const b = globalThis.LRControl.persona(derecha);
    return Boolean(a && b && a === b);
  },
  normalizeText: (valor) => String(valor ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase(),
  pendingSubtasks: (task) => (Array.isArray(task?.[9]) ? task[9] : []),
  taskId: (task, indice) => `id-${indice}`,
  // Nadie tiene cronómetro corriendo: lo que se trabajó hoy está en taskTimer.dailyById.
  activeTimerEntry: () => null,
  timerEntryMatchesUser: () => false,
  timerDailySegments: () => ({}),
  timerSecondsForTask: (id) => (id === 'id-0' ? 18000 : 0),
  openTasksDailySecondsForUser: (nombre, dia) =>
    globalThis.LRControl.persona(nombre) === 'jorge' && dia === HOY ? 10800 : 0,
  activeDailySecondsForUser: () => 0,
  readStoredJson: (clave, respaldo) => (clave in guardado ? JSON.parse(guardado[clave]) : respaldo),
  writeStoredJson: (clave, valor) => {
    guardado[clave] = JSON.stringify(valor);
  },
  agenteAvisar: (perfil, id, texto) => avisos.push({perfil, id, texto}),
  agenteEnviar: () => {
    throw new Error('ningún mensaje del día puede costar una llamada al modelo');
  }
};
vm.createContext(contexto);
vm.runInContext(
  [
    constante('AGENTE_RESUMEN_CLAVE'), constante('AGENTE_CIERRE_MINUTOS'),
    constante('AGENTE_RESUMEN_DIAS_ATRAS'), constante('AGENTE_RESUMEN_MAX_FILAS'),
    constante('AGENTE_RESUMEN_VE_TODO'),
    extraer('agenteLimpio'), extraer('agenteDuracion'), extraer('localDayKey'),
    extraer('parseDayKey'), extraer('sumarDias'), extraer('taskDateInputValue'),
    extraer('agenteResumenMarcas'), extraer('agenteResumenMarcado'), extraer('agenteResumenMarcar'),
    extraer('agenteResumenPersonas'), extraer('agenteDiasEntre'), extraer('agenteDiaTexto'),
    extraer('agenteSegundosDelDia'), extraer('agenteTrabajoDePersona'), extraer('agenteDiaConTrabajo'),
    extraer('agenteDiaDelResumen'), extraer('agenteResumenAperturaTexto'), extraer('agenteCierreFilas'),
    extraer('agenteCierrePromedioMes'), extraer('agenteCierreTexto'), extraer('agenteResumenLineasContexto'),
    extraer('agenteResumenDiarioRevisar')
  ].join('\n'),
  contexto
);
const {
  agenteTrabajoDePersona, agenteDiaDelResumen, agenteResumenAperturaTexto, agenteCierreTexto,
  agenteResumenLineasContexto, agenteResumenDiarioRevisar, agenteCierreFilas
} = contexto;

const sinBasura = (texto, donde) =>
  assert.doesNotMatch(texto, /undefined|null|NaN|\[object/, `${donde}: se escapó un valor sin formatear`);

// ── El día de Lima, no el de UTC ──────────────────────────────────────────
assert.equal(agenteDiaDelResumen(), AYER, 'ayer tuvo movimiento: el resumen es de ayer');
const ayerDiego = agenteTrabajoDePersona('Diego', AYER);
assert.deepEqual(ayerDiego.pendientes.map((p) => p.titulo), ['Informe de Royal Baby'],
  'el cierre de las 8 p. m. es del 9 en Lima, y la tarea eliminada no cuenta');
assert.equal(ayerDiego.internasTotal, 2, 'las tareas internas que el pendiente se llevó al cerrarse sí cuentan');
assert.equal(ayerDiego.segundos, 7500, 'el tiempo sale del historial, no de la tarea cerrada hoy');

const ayerJorge = agenteTrabajoDePersona('Jorge Luis', AYER);
assert.deepEqual(ayerJorge.pendientes.map((p) => p.titulo), ['Pauta de TLM']);
// El array lo creó el contexto del vm: deepStrictEqual compara prototipos y falla con dos arrays
// idénticos, así que se comparan como texto.
assert.equal([...ayerJorge.internas].join(' | '), 'Armar las métricas',
  'las subtareas marcadas en un pendiente abierto se nombran una por una');

// ── Diego ve lo suyo ──────────────────────────────────────────────────────
contexto.quien = 'Diego';
const paraDiego = agenteResumenAperturaTexto(AYER);
assert.match(paraDiego, /Buen día, Diego/);
assert.match(paraDiego, /ayer lunes, 9 de noviembre/, 'dice de qué día habla');
assert.match(paraDiego, /«Informe de Royal Baby» · 2 h 5 min/);
assert.doesNotMatch(paraDiego, /Pauta de TLM|Jorge/,
  'a Diego no le llega el trabajo de Jorge Luis: pidió lo suyo');
assert.doesNotMatch(paraDiego, /Carpeta que se borró/, 'borrar algo no es haberlo hecho');
sinBasura(paraDiego, 'resumen de Diego');

// ── Jorge Luis ve a los dos, y primero al otro ────────────────────────────
contexto.quien = 'Jorge Luis';
const paraJorge = agenteResumenAperturaTexto(AYER);
assert.match(paraJorge, /Buen día, Jorge Luis/);
assert.ok(paraJorge.indexOf('Diego') < paraJorge.indexOf('Jorge Luis**'),
  'lo del otro va primero: lo propio ya se vivió');
assert.match(paraJorge, /«Informe de Royal Baby»/);
assert.match(paraJorge, /«Pauta de TLM»/);
assert.match(paraJorge, /«Armar las métricas»/);
// Lo de hoy, para que el mensaje no se quede en el pasado: su pendiente abierto y los vencidos.
assert.match(paraJorge, /Hoy te quedan 1 pendiente abierto\./);
sinBasura(paraJorge, 'resumen de Jorge Luis');

// ── Un lunes con el domingo vacío busca hacia atrás ───────────────────────
// Sin nada el 9 ni el 8 —ni cierres, ni tareas internas, ni cronómetro—, el último día con
// movimiento es el 7, y el texto deja de decir «ayer».
contexto.completedTasks = HISTORIAL.filter((r) => r.title === 'Revisión antigua');
contexto.tasks = [[...ABIERTAS[0]], ABIERTAS[1]];
contexto.tasks[0][9] = [{id: 's2', title: 'Publicar', status: 'Pendiente'}];
contexto.openTasksDailySecondsForUser = () => 0;
assert.equal(agenteDiaDelResumen(), '2026-11-07', 'si ayer no hubo nada, se mira hacia atrás');
const delSabado = agenteResumenAperturaTexto('2026-11-07');
assert.match(delSabado, /el sábado, 7 de noviembre/);
assert.doesNotMatch(delSabado, /ayer/, 'no llama «ayer» a un día que no lo es');
sinBasura(delSabado, 'resumen de un día anterior');

// Y con el historial entero vacío lo dice en vez de quedarse en blanco.
contexto.completedTasks = [];
assert.match(agenteResumenAperturaTexto('2026-11-07'), /no registra movimiento/);

// ── El cierre de las 7:30 p. m. ───────────────────────────────────────────
contexto.completedTasks = HISTORIAL;
contexto.tasks = ABIERTAS;
contexto.openTasksDailySecondsForUser = (nombre, dia) =>
  globalThis.LRControl.persona(nombre) === 'jorge' && dia === HOY ? 10800 : 0;
const filas = agenteCierreFilas(HOY);
assert.equal(filas[0].titulo, 'Tablero de Global Beverages', 'manda el que más cronómetro tuvo hoy');
assert.equal(filas[0].segundosHoy, 10800);
assert.ok(filas.some((f) => f.titulo === 'Migración de la hoja vieja' && f.estado === 'cerrado'));
assert.equal(filas.some((f) => f.titulo === 'Carpeta que se borró'), false);

const cierre = agenteCierreTexto(HOY);
assert.match(cierre, /Cierre del martes, 10 de noviembre/);
assert.match(cierre, /«Tablero de Global Beverages» · 3 h hoy · Jorge Luis · sigue en proceso · abierto desde hace 4 días/);
assert.match(cierre, /«Migración de la hoja vieja»/);
assert.match(cierre, /13 días desde su inicio/, 'lo que más tardó en terminarse se mide en días');
assert.match(cierre, /Cronómetro del día: Diego 1 h 30 min · Jorge Luis 3 h\./);
sinBasura(cierre, 'cierre del día');

// Un día sin cronómetro no se inventa un ranking.
contexto.taskTimer = {dailyById: {}};
contexto.openTasksDailySecondsForUser = () => 0;
assert.match(agenteCierreTexto('2026-11-08'), /no quedó tiempo cronometrado/);
contexto.taskTimer = {dailyById: {'id-0': {[HOY]: {jorge: 10800}}}};
contexto.openTasksDailySecondsForUser = (nombre, dia) =>
  globalThis.LRControl.persona(nombre) === 'jorge' && dia === HOY ? 10800 : 0;

// ── Cuándo se lanza cada uno, y una sola vez ──────────────────────────────
avisos.length = 0;
agenteResumenDiarioRevisar();
assert.equal(avisos.length, 1, 'al abrir la app sale el resumen del día anterior');
assert.equal(avisos[0].perfil, 'tasks');
assert.equal(avisos[0].id, `resumen-apertura-${HOY}`);
assert.match(avisos[0].texto, /Buen día/);

// A las 10 de la mañana todavía no toca el cierre, y el resumen no se repite.
agenteResumenDiarioRevisar();
assert.equal(avisos.length, 1, 'ni se repite el resumen ni se adelanta el cierre');

// A las 7:29 p. m. sigue sin tocar: la hora es la hora.
contexto.Date = relojEn(`${HOY}T19:29:00-05:00`);
agenteResumenDiarioRevisar();
assert.equal(avisos.length, 1, 'a las 7:29 p. m. el cierre todavía no sale');

contexto.Date = relojEn(`${HOY}T19:30:00-05:00`);
agenteResumenDiarioRevisar();
assert.equal(avisos.length, 2, 'a las 7:30 p. m. sale el análisis del día');
assert.equal(avisos[1].id, `resumen-cierre-${HOY}`);
assert.match(avisos[1].texto, /Cierre del martes, 10 de noviembre/);
agenteResumenDiarioRevisar();
assert.equal(avisos.length, 2, 'y tampoco se repite');

// Al día siguiente vuelven a tocar los dos: el cierre de ayer no tapa el resumen de hoy.
contexto.Date = relojEn('2026-11-11T20:00:00-05:00');
agenteResumenDiarioRevisar();
assert.equal(avisos.length, 4, 'el 11 salen otra vez los dos');
assert.deepEqual(avisos.slice(2).map((a) => a.id), ['resumen-apertura-2026-11-11', 'resumen-cierre-2026-11-11']);

// Sin sesión no se escribe nada: el resumen es de una persona, no de la pantalla.
contexto.Date = relojEn('2026-11-12T09:00:00-05:00');
contexto.hasSuiteAccess = () => false;
agenteResumenDiarioRevisar();
assert.equal(avisos.length, 4);
contexto.hasSuiteAccess = () => true;

// La marca es por persona: Diego entrando en el mismo navegador recibe el suyo.
contexto.quien = 'Diego';
agenteResumenDiarioRevisar();
assert.equal(avisos.length, 5, 'la marca de Jorge Luis no silencia el resumen de Diego');
assert.doesNotMatch(avisos[4].texto, /Pauta de TLM/);

// ── Enganchado donde tiene que estar ──────────────────────────────────────
// El historial ya está en memoria cuando se lanza: antes, el resumen de ayer habría salido vacío.
assert.match(extraer('initSharedPendingDb'), /agenteResumenDiarioInstalar\(\);/,
  'el resumen se lanza cuando la BBDD de pendientes acabó de cargar');
// Cada minuto y al volver a la pestaña: a las 7:30 p. m. la pestaña suele estar en segundo plano.
const instalar = extraer('agenteResumenDiarioInstalar');
assert.match(instalar, /setInterval\(agenteResumenDiarioRevisar, 60000\)/);
assert.match(instalar, /visibilitychange/);
// Y las mismas cifras viajan en el contexto del agente, para que pueda hablar de ellas.
assert.match(extraer('agenteTablero'), /\.\.\.agenteResumenLineasContexto\(\)/);
contexto.Date = relojEn(`${HOY}T19:00:00-05:00`);
contexto.quien = 'Jorge Luis';
const contextoLineas = [...agenteResumenLineasContexto()].join('\n');
assert.match(contextoLineas, /Diego: 1 pendiente cerrado, 2 tareas internas/, 'sin plurales de más');
assert.match(contextoLineas, /Último día con movimiento antes de hoy/);
assert.match(contextoLineas, /Lo que más cronómetro lleva hoy/);
sinBasura(contextoLineas, 'contexto del agente');

// ── Al entrar al módulo, el aviso sin leer abre la tarjeta ────────────────
// La app abre en el último módulo que se usó, así que el resumen casi siempre llega estando en
// otra pantalla. Sin esto se quedaba dentro del icono flotante y nadie lo veía.
const dock = {
  Boolean, Object,
  agenteUI: {montado: true, abierto: false, perfil: ''},
  agenteEstados: {},
  // Los agentes que existen, para que agenteAvisoPendiente sepa por cuáles preguntar. Y los
  // objetivos del día quedan fuera a propósito: cuestan una llamada al modelo y tienen su propia
  // prueba (objetivos-del-dia.mjs); aquí lo que se mira es que la tarjeta se abra.
  AGENTE_PERFILES: {tasks: {id: 'tasks', titulo: 'Agente IA'}, gasto: {id: 'gasto', titulo: 'Agente de Gasto'}},
  agenteObjetivosRevisar: () => {},
  hasSuiteAccess: () => true,
  perfilActivo: {id: 'tasks', titulo: 'Agente IA', tono: 'pendientes', subtitulo: 'x'},
  agentePerfil: () => dock.perfilActivo,
  agenteMontar: () => {},
  agenteCabeceraDom: () => {},
  dibujos: 0,
  agenteDibujar: () => {
    dock.dibujos += 1;
  },
  // Un nodo de mentira que sirve para la zona, la tarjeta, el punto y la burbuja: lo que el dock
  // les hace es poner clases, esconderlas y rotular la burbuja.
  document: {getElementById: () => ({classList: {toggle: () => {}}, hidden: false, title: '', setAttribute: () => {}})}
};
vm.createContext(dock);
vm.runInContext([extraer('agenteEstado'), extraer('agenteAvisoPendiente'), extraer('agenteSincronizarDock')].join('\n'), dock);
dock.agente = dock.agenteEstado('tasks');
// Estando en otro módulo, el aviso entró sin que nadie lo viera (es lo que hace agenteAvisar).
dock.agenteEstado('tasks').avisos.push({id: `resumen-apertura-${HOY}`, texto: 'Buen día…'});
dock.perfilActivo = null;
dock.agenteSincronizarDock();
assert.equal(dock.agenteUI.abierto, false, 'en un módulo sin agente no se abre nada');

dock.perfilActivo = {id: 'tasks', titulo: 'Agente IA', tono: 'pendientes', subtitulo: 'x'};
dock.agenteSincronizarDock();
assert.equal(dock.agenteUI.abierto, true, 'al entrar a Pendientes la tarjeta se abre con el resumen');
assert.ok(dock.dibujos >= 1);
assert.equal(dock.agenteEstado('tasks').avisos[0].visto, true, 'ya está en pantalla: queda leído');

// Y minimizarla no la vuelve a abrir en el siguiente redibujo.
dock.agenteUI.abierto = false;
dock.agenteSincronizarDock();
assert.equal(dock.agenteUI.abierto, false, 'lo leído no reabre la tarjeta sola');

console.log('PASS resumen diario: al abrir la app el agente cuenta lo del día anterior (Diego lo suyo, Jorge Luis lo de los dos), a las 7:30 p. m. analiza qué tomó más tiempo y qué tardó más días, cuenta los días en hora de Lima, ignora lo eliminado, busca hacia atrás cuando ayer está vacío, no se repite en la jornada y no gasta una llamada al modelo.');
