// Cuando alguien te asigna un pendiente, el agente lo cuenta en el chat y lo abre solo.
//
// La trampa de esta función: el historial del agente se manda tal cual a la API de Claude, y la
// API exige que el PRIMER mensaje sea del usuario. Si el aviso se guardara como un turno del
// asistente, una conversación podría empezar por ahí y la siguiente pregunta de la persona
// fallaría con un 400. Por eso los avisos viven fuera de `mensajes`, y eso es lo primero que se
// comprueba aquí.
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

const abiertos = [];
const dibujados = [];
const contexto = {
  Date, JSON, String, Number, Array, Object,
  state: {active: 'tasks'},
  agenteEstados: {},
  agenteUI: {montado: true, abierto: false, perfil: 'tasks'},
  AGENTE_PERFILES: {tasks: {id: 'tasks', apertura: 'PREGUNTA QUE CUESTA DINERO'}},
  agenteMontar: () => {},
  agenteSincronizarDock: () => {},
  agenteEnviar: () => { throw new Error('no se puede llamar al modelo al abrir por un aviso'); },
  agenteDibujar: () => dibujados.push(true),
  document: {querySelector: () => null},
  window: {setTimeout: () => {}},
  localDayKey: () => '2026-11-10',
  taskDateInputValue: (v) => String(v || '').slice(0, 10),
  notifDayLabel: (k) => {
    const m = String(k).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }
};
vm.createContext(contexto);
vm.runInContext(
  [extraer('agenteEstado'), extraer('agentePerfil'), extraer('agenteAbrir'),
    extraer('agenteAvisar'), extraer('textoAvisoAsignacion')].join('\n'),
  contexto
);
// agenteAbrir toca agenteUI.abierto: se observa ahí si el chat se abrió.
const {agenteAvisar, agenteEstado, textoAvisoAsignacion} = contexto;
// En el archivo, `agente` es la variable que apunta al estado del agente a la vista; la reapunta
// agenteSincronizarDock, que aquí es un simulacro.
contexto.agente = agenteEstado('tasks');

// ── El texto dice qué cambió, no solo que cambió algo ─────────────────────
const hoy = textoAvisoAsignacion({
  assignedBy: 'Jorge Luis', taskTitle: 'Activar campaña LR Meta ADs',
  taskDue: '2026-11-10', taskPriority: 'Alta'
});
assert.match(hoy, /Jorge Luis te asignó un pendiente: «Activar campaña LR Meta ADs»/);
assert.match(hoy, /vence hoy/);
assert.match(hoy, /prioridad alta/);

const tarde = textoAvisoAsignacion({assignedBy: 'Diego', taskTitle: 'X', taskDue: '2026-11-03', taskPriority: 'Media'});
assert.match(tarde, /vencido/, 'una fecha pasada se dice vencida, no se disimula');

const futuro = textoAvisoAsignacion({assignedBy: 'Diego', taskTitle: 'X', taskDue: '2026-11-20', taskPriority: ''});
assert.match(futuro, /vence el 20\/11\/2026/);
assert.doesNotMatch(futuro, /prioridad/, 'sin prioridad no se inventa una');

const pelado = textoAvisoAsignacion({taskTitle: 'Sin nada más'});
assert.match(pelado, /Otro usuario te asignó/, 'sin nombre, no sale «undefined»');
assert.doesNotMatch(pelado, /undefined|null|NaN/);

// ── El aviso no puede entrar en el historial de la API ────────────────────
const estado = agenteEstado('tasks');
// El array viene del contexto vm: deepStrictEqual compara prototipos y falla con dos
// arrays idénticos. Se mira la longitud, que es lo que importa.
assert.equal(estado.mensajes.length, 0);
agenteAvisar('tasks', 'assignment-1', 'Diego te asignó un pendiente.');
assert.equal(estado.avisos.length, 1);
assert.equal(estado.mensajes.length, 0, 'el historial que se manda a Claude sigue vacío');

// Dos veces el mismo aviso —un redibujo, una reconexión del canal— no lo duplica.
agenteAvisar('tasks', 'assignment-1', 'Diego te asignó un pendiente.');
assert.equal(estado.avisos.length, 1);
agenteAvisar('tasks', 'assignment-2', 'Y otro más.');
assert.equal(estado.avisos.length, 2);

// ── Se abre solo, y sin pagar una llamada al modelo ───────────────────────
// agenteEnviar revienta a propósito en este contexto: si agenteAvisar abriera con la apertura
// normal, esta prueba fallaría con «no se puede llamar al modelo».
assert.equal(contexto.agenteUI.abierto, true, 'el chat se abre solo');
assert.ok(dibujados.length >= 1, 'y se redibuja para que el aviso se vea');

// Abrirlo a mano sí lanza la apertura, que es lo de siempre.
contexto.agenteUI.abierto = false;
assert.throws(() => contexto.agenteAbrir(true), /no se puede llamar al modelo/,
  'abrir el chat a mano sigue entrando con la foto del módulo');

// ── En otro módulo queda esperando, no secuestra la pantalla ──────────────
contexto.state.active = 'clientes';
contexto.agenteUI.abierto = false;
const antesDibujos = dibujados.length;
agenteAvisar('tasks', 'assignment-3', 'Un tercero.');
assert.equal(agenteEstado('tasks').avisos.length, 3, 'el aviso se guarda igual');
assert.equal(contexto.agenteUI.abierto, false, 'pero no se abre encima de otro módulo');
assert.equal(dibujados.length, antesDibujos, 'ni se redibuja un chat que no está a la vista');

// ── Y se pinta como burbuja del agente ────────────────────────────────────
const pintado = extraer('agenteMensajesHtml');
assert.match(pintado, /\(agente\.avisos \|\| \[\]\)\.forEach\(\(aviso\) => piezas\.push\(agenteBurbuja\("agente", aviso\.texto\)\)\)/);

// Y el aviso sale del camino que ya existía, el de la asignación.
assert.match(extraer('receiveAssignmentNotification'),
  /agenteAvisar\("tasks", nextNotice\.id, textoAvisoAsignacion\(nextNotice\)\)/);
assert.match(extraer('createAssignmentNotice'), /taskDue: task\?\.\[2\]/);
assert.match(extraer('createAssignmentNotice'), /taskPriority: task\?\.\[4\]/);

console.log('PASS aviso de asignación: el agente cuenta quién te asignó qué, cuándo vence y con qué prioridad, abre el chat solo sin gastar una llamada al modelo, no se repite, no secuestra otro módulo, y el aviso nunca entra en el historial que se manda a la API.');
