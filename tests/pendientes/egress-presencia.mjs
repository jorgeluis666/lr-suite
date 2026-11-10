// Lote 10, primera parte: que la presencia deje de pagarse en egress.
//
// La presencia viaja por broadcast, que es instantáneo y no se cobra. Pero además se metía en la
// fila compartida, así que subía en cada guardado y bajaba en cada lectura dentro del mismo
// paquete que el tablero entero. Encima el latido salía cada 10 s por pestaña —también con la
// pestaña en segundo plano— y tasksModule publicaba otra vez en cada redibujo.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

// Ojo: hay que saltarse la lista de argumentos antes de buscar la llave del cuerpo. Con un
// parámetro por defecto como `(overrides = {})` o `({ latido = false } = {})`, la primera llave
// que aparece es la del parámetro, y contar desde ahí devuelve una función de dos caracteres.
function extraer(nombre) {
  const inicio = html.indexOf(`function ${nombre}(`);
  assert.notEqual(inicio, -1, `no se encontró la función ${nombre}`);
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

// ── La fila compartida ya no lleva presencia ──────────────────────────────
const payload = extraer('sharedPendingPayload');
assert.match(payload, /presence: \{\}/, 'la fila tiene que ir con la presencia vacía');
assert.doesNotMatch(payload, /readStoredJson\(PRESENCE_STORAGE_KEY/, 'ya no se lee el mapa para subirlo');
// Y tampoco se pide al leer: cada columna de menos es menos egress en cada lectura.
for (const select of html.match(/\.select\("[^"]*state_version[^"]*"\)/g) || []) {
  assert.equal(select.includes('presence'), false, `este select sigue pidiendo presence: ${select}`);
}
assert.equal(/row\.presence/.test(html), false, 'ya no hay que fusionar la presencia que venía en la fila');
// Lo que sí sigue: la presencia por broadcast, que es por donde viaja ahora.
assert.ok(html.includes('"broadcast", { event: "presence" }'), 'el canal de presencia sigue ahí');
assert.ok(html.includes('mergePendingPresence'), 'y la fusión de lo que llega por broadcast también');

// ── El latido ─────────────────────────────────────────────────────────────
// Se ejecuta de verdad: lo que importa es cuántos envíos salen, no cómo está escrito.
const publicados = [];
const almacen = {};
const contexto = {
  applyingPresenceSync: false,
  pendingSessionId: 's1',
  PRESENCE_STORAGE_KEY: 'p',
  PRESENCE_MAX_AGE_MS: 600000,
  JSON, Date, Object, Number, String,
  currentSuiteUserName: () => 'Jorge',
  readStoredJson: (k, d) => almacen[k] || d,
  writeStoredJson: (k, v) => (almacen[k] = v),
  publishPresenceSync: (e) => publicados.push(e)
};
vm.createContext(contexto);
// La firma vive fuera de la función, en el mismo ámbito; se trae tal cual del archivo.
const declaracionFirma = (html.match(/^\s*let ultimaFirmaPresencia = "";$/m) || [])[0];
assert.ok(declaracionFirma, 'no se encontró la variable que recuerda la última firma');
vm.runInContext(
  [declaracionFirma, extraer('currentPendingPresenceEntry'), extraer('prunePresenceMap'),
    extraer('writePendingPresence')].join('\n'),
  contexto
);
const {writePendingPresence} = contexto;

// Lo que hacía tasksModule en cada redibujo: diez llamadas idénticas, un solo envío.
for (let i = 0; i < 10; i++) writePendingPresence(null);
assert.equal(publicados.length, 1, 'diez redibujos sin cambios tienen que ser un solo envío');

// Empezar a editar sí es un cambio, y dejar de editar también.
writePendingPresence({id: 't1', title: 'Tarea', action: 'Editando'});
assert.equal(publicados.length, 2);
writePendingPresence({id: 't1', title: 'Tarea', action: 'Editando'});
assert.equal(publicados.length, 2, 'seguir editando lo mismo no se reenvía');
writePendingPresence(null);
assert.equal(publicados.length, 3);

// El latido siempre sale aunque no haya cambiado nada: si no, los demás nos darían por
// desconectados al pasar la tolerancia del lector.
writePendingPresence(null, {latido: true});
writePendingPresence(null, {latido: true});
assert.equal(publicados.length, 5, 'el latido no se puede silenciar');

// ── Los tiempos tienen que ser coherentes entre sí ────────────────────────
// Si el latido fuera más lento que la tolerancia del lector, la gente parpadearía.
const cadencia = Number((html.match(/\}, (\d+)\);\s*\n\s*window\.setInterval\(renderPresenceFromSync/) || [])[1]);
const tolerancia = Number((html.match(/now - Number\(entry\.updatedAt \|\| 0\) < (\d+)/) || [])[1]);
assert.equal(cadencia, 30000, 'el latido pasó a 30 s');
assert.equal(tolerancia, 75000);
assert.ok(tolerancia > cadencia * 2, 'la tolerancia tiene que aguantar al menos dos latidos perdidos');

// Con la pestaña oculta no se late: nadie está mirando esa pantalla.
// Hay otro `}, 30000);` antes en el archivo, así que el intervalo del latido se busca por su
// contenido, no por el primer 30000 que aparezca.
const cuerpoDelLatido = (html.match(/window\.setInterval\(\(\) => \{[\s\S]{0,700}?\}, 30000\);/g) || [])
  .find((bloque) => bloque.includes('writePendingPresence'));
assert.ok(cuerpoDelLatido, 'no se encontró el intervalo de 30 s que publica la presencia');
assert.match(cuerpoDelLatido, /visibilityState === "hidden" \|\| !getSuiteAccessSession\(\)\) return;/);
assert.match(cuerpoDelLatido, /\{ latido: true \}/, 'el latido se marca como tal para que no lo deduplique la firma');

// ── Un aviso de cambio con la pestaña oculta no consulta nada ─────────────
const avisoChanged = html.slice(html.indexOf('"broadcast", { event: "changed" }'), html.indexOf('"broadcast", { event: "presence" }'));
assert.match(avisoChanged, /visibilityState === "hidden"/);
assert.ok(avisoChanged.indexOf('sharedPendingRemoteDirty = true') < avisoChanged.indexOf('checkSharedPendingRemote()'),
  'la salida por pestaña oculta va antes de la consulta');
assert.match(html, /let sharedPendingRemoteDirty = false;/, 'declarada, no una global suelta');

// Al volver se revisa y se avisa de que seguimos aquí.
const resume = html.slice(html.indexOf('const resume = () => {'));
assert.match(resume.slice(0, 500), /sharedPendingRemoteDirty = false;/);
assert.match(resume.slice(0, 500), /writePendingPresence\(null, \{ latido: true \}\)/);

console.log('PASS egress de presencia: fuera de la fila compartida y de los dos select, el latido pasa de 10 a 30 s con 75 s de tolerancia y se detiene con la pestaña oculta, diez redibujos son un envío en vez de diez, y un aviso de cambio en segundo plano ya no baja el tablero.');
