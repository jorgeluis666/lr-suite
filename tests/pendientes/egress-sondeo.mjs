// Lote 10, segunda parte: dejar de preguntar lo que ya se sabe.
//
// Dos derroches distintos:
//   · validateSharedPendingState corría cada 5 s SIEMPRE, también en Clientes o en UTM Builder, y
//     terminaba consultando updated_at. Con el canal en vivo suscrito, un cambio ajeno llega solo
//     por el aviso «changed»: esa consulta no aportaba nada fuera de Pendientes.
//   · archiveCompletedTask bajaba la fila entera, la fusionaba y la volvía a subir entera antes de
//     insertar el registro, justo después de que saveTaskState() hubiera hecho ya ese mismo
//     guardado —y fusionando con lo remoto—. Tres viajes y dos copias del tablero por tarea.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

// Se lleva el `async` de delante cuando lo hay: sin él, el cuerpo no compila al ejecutarlo.
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

// ── El sondeo fuera de Pendientes ─────────────────────────────────────────
const validar = extraer('validateSharedPendingState');
assert.match(validar, /\{ force = false \} = \{\}/, 'tiene que poder forzarse');
assert.match(validar, /state\.active !== "tasks"/);
assert.match(validar, /sharedLiveSubscribed/, 'solo se ahorra la consulta si el canal en vivo está suscrito');
assert.match(validar, /Date\.now\(\) - lastSharedPendingCheckAt < 180000/);
// El orden importa: el canal se revive y la pestaña oculta se descarta ANTES del freno, o una
// pestaña en otro módulo se quedaría sin reconectar el tiempo real.
assert.ok(validar.indexOf('ensureSharedRealtimeAlive()') < validar.indexOf('lastSharedPendingCheckAt'),
  'el canal se revive antes de decidir si se consulta');
assert.ok(validar.indexOf('visibilityState === "hidden"') < validar.indexOf('lastSharedPendingCheckAt'));
// Dentro de Pendientes no se toca la cadencia: los 5 s los eligió el dueño.
assert.match(html, /const PENDING_BACKUP_VALIDATION_MS = 5000;/);
assert.match(html, /let lastSharedPendingCheckAt = 0;/, 'declarada, no una global suelta');
assert.match(extraer('checkSharedPendingRemote'), /lastSharedPendingCheckAt = Date\.now\(\);/,
  'la marca se pone cuando la consulta sale bien');
// El botón de sincronizar y la entrada a Pendientes no esperan a los tres minutos.
assert.match(extraer('forcePendingSync'), /validateSharedPendingState\(\{ force: true \}\)/);
assert.match(html, /if \(nextModule === "tasks"\) checkSharedPendingRemote\(\);/);

// Se ejecuta de verdad y se cuentan las consultas, que es lo que se paga.
const codigo = extraer('validateSharedPendingState');
let consultas = 0;
const contexto = {
  Date, document: {visibilityState: 'visible'},
  state: {active: 'clientes'},
  sharedPendingApplying: false,
  sharedLiveSubscribed: true,
  sharedBackupRecoveryTried: true,
  tasks: [{}],
  lastSharedPendingCheckAt: 0,
  getSuiteAccessSession: () => 'jorge',
  ensureSharedPendingConnection: async () => true,
  updateSharedPendingHealth: () => {},
  ensureSharedRealtimeAlive: () => {},
  recoverSharedPendingBackups: async () => false,
  renderTasksIfActive: () => {},
  saveTaskState: () => {},
  checkSharedPendingRemote: async () => {
    consultas += 1;
    contexto.lastSharedPendingCheckAt = Date.now();
  }
};
vm.createContext(contexto);
vm.runInContext(codigo, contexto);
const validate = contexto.validateSharedPendingState;

// Doce vueltas del temporizador de 5 s en otro módulo = un minuto. Antes eran doce consultas.
for (let i = 0; i < 12; i++) await validate();
assert.equal(consultas, 1, 'en otro módulo, un minuto de temporizador tiene que ser una sola consulta');

// Mirando el tablero sí se consulta en cada vuelta: ahí los 5 s son a propósito.
contexto.state.active = 'tasks';
consultas = 0;
for (let i = 0; i < 12; i++) await validate();
assert.equal(consultas, 12, 'dentro de Pendientes la cadencia no cambia');

// Sin canal en vivo no hay quien avise, así que se vuelve a consultar siempre.
contexto.state.active = 'clientes';
contexto.sharedLiveSubscribed = false;
consultas = 0;
for (let i = 0; i < 5; i++) await validate();
assert.equal(consultas, 5, 'si el canal no está suscrito, el sondeo es la única red');

// Y con la pestaña oculta no se consulta nunca.
contexto.sharedLiveSubscribed = true;
contexto.document.visibilityState = 'hidden';
consultas = 0;
for (let i = 0; i < 5; i++) await validate();
assert.equal(consultas, 0);

// ── El archivado ──────────────────────────────────────────────────────────
const archivar = extraer('archiveCompletedTask');
assert.equal(/\.upsert\(/.test(archivar), false, 'ya no vuelve a subir la fila entera');
assert.equal(/\.select\(/.test(archivar), false, 'ni la baja antes');
assert.equal(/publishSharedChangedPing/.test(archivar), false, 'el aviso lo manda el guardado normal');
// El comentario sí lo nombra; lo que no puede haber es una asignación.
assert.equal(/sharedPendingError\s*=/.test(archivar), false,
  'un fallo del historial no puede pintarse como un fallo de la sincronización del tablero');
assert.equal((archivar.match(/await sharedPendingClient/g) || []).length, 1, 'un solo viaje a Supabase');
assert.match(archivar, /SHARED_PENDING_HISTORY_TABLE/);
assert.match(archivar, /\.insert\(/);
// Los tres códigos que no son un fallo del cierre.
for (const codigoError of ['23505', 'PGRST205', '42P01']) {
  assert.ok(archivar.includes(codigoError), `falta tratar el código ${codigoError}`);
}

// Lo que sí tiene que seguir pasando antes de llamar aquí: el merge local y el guardado normal,
// que es lo que de verdad sube el registro y la lápida.
const cierre = html.slice(html.indexOf('taskTombstones()[id] = {'), html.indexOf('void archiveCompletedTask('));
assert.match(cierre, /completedTasks = mergeCompletedTaskHistory\(completedTasks, \[completedRecord\]\)/);
assert.match(cierre, /saveTaskState\(\{ reason: action \}\)/);

console.log('PASS sondeo y archivado: en otro módulo un minuto de temporizador es una consulta en vez de doce, dentro de Pendientes siguen siendo doce, con la pestaña oculta ninguna, y cerrar una tarea cuesta un viaje a Supabase en vez de tres.');
