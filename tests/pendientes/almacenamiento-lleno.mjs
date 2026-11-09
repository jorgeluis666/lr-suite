// Lote 6 de la auditoría: con el almacenamiento del navegador lleno, la sincronización de
// Pendientes se congelaba sin avisar.
//
// El mecanismo era este: mergePendingPresence escribía con localStorage.setItem a pelo, y se la
// llama desde applySharedPendingRow entre `sharedPendingApplying = true` y `= false`. Si la
// escritura lanzaba QuotaExceededError, la bandera se quedaba en true y a partir de ahí nada
// subía a Supabase, mientras la etiqueta seguía diciendo «BBDD verificada».
//
// Esta prueba saca las funciones reales del index.html y las corre con un localStorage que tiene
// cuota. No necesita navegador ni red.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

// Saca `function nombre(...) { ... }` contando llaves, que es lo único fiable en un archivo de
// 26.000 líneas sin módulos.
function extraer(nombre) {
  const inicio = html.indexOf(`function ${nombre}(`);
  assert.notEqual(inicio, -1, `no se encontró la función ${nombre} en index.html`);
  let i = html.indexOf('{', inicio);
  let nivel = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') nivel++;
    else if (html[i] === '}' && --nivel === 0) break;
  }
  return html.slice(inicio, i + 1);
}

// localStorage con cuota, como el de un navegador lleno.
function almacenamiento(limite) {
  const datos = new Map();
  const peso = () => [...datos].reduce((total, [k, v]) => total + k.length + v.length, 0);
  return {
    datos,
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    removeItem: (k) => datos.delete(k),
    setItem(k, v) {
      const previo = datos.get(k) || '';
      if (peso() - previo.length - k.length + k.length + String(v).length > limite) {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      }
      datos.set(k, String(v));
    }
  };
}

function entorno(limite) {
  const localStorage = almacenamiento(limite);
  const contexto = {
    localStorage,
    window: {localStorage},
    console: {warn() {}, error() {}},
    JSON,
    Date,
    Object,
    Array,
    Number,
    String,
    PRESENCE_STORAGE_KEY: 'lr-presencia',
    TASK_BACKUP_STORAGE_KEY: 'lr-respaldos',
    MAX_LOCAL_PENDING_BACKUPS: 5,
    // El mismo valor que declara el index.html, leído de ahí para que la prueba no se quede con
    // un número inventado si alguien lo cambia.
    PRESENCE_MAX_AGE_MS: Number(/const PRESENCE_MAX_AGE_MS = (\d+);/.exec(html)?.[1])
  };
  assert.ok(contexto.PRESENCE_MAX_AGE_MS > 0, 'no se encontró PRESENCE_MAX_AGE_MS en index.html');
  vm.createContext(contexto);
  const fuente = [
    'isStorageQuotaError',
    'readStoredJson',
    'compactLocalPendingBackup',
    'compactLocalPendingBackups',
    'freeLocalStorageSpace',
    'writeStoredValue',
    'writeStoredJson',
    'prunePresenceMap',
    'mergePendingPresence'
  ].map(extraer).join('\n');
  vm.runInContext(fuente, contexto);
  return contexto;
}

// ── La poda ────────────────────────────────────────────────────────────────
const solo = entorno(1_000_000);
const ahora = Date.now();
const podado = solo.prunePresenceMap({
  viva: {id: 'viva', updatedAt: ahora - 5000},
  vieja: {id: 'vieja', updatedAt: ahora - 3_600_000},
  sinFecha: {id: 'sinFecha'}
});
assert.deepEqual(Object.keys(podado), ['viva'], 'solo sobrevive la presencia reciente');

// Sin poda, cada carga de página dejaba una entrada para siempre. Con ella, el mapa deja de
// crecer aunque pasen cien sesiones.
const muchas = {};
for (let i = 0; i < 100; i++) muchas['s' + i] = {id: 's' + i, updatedAt: ahora - 7_200_000};
muchas.actual = {id: 'actual', updatedAt: ahora};
solo.localStorage.setItem('lr-presencia', JSON.stringify({}));
solo.mergePendingPresence(muchas);
assert.deepEqual(
  Object.keys(JSON.parse(solo.localStorage.getItem('lr-presencia'))),
  ['actual'],
  'el mapa guardado no arrastra las cien sesiones viejas'
);

// ── Con el almacenamiento lleno ────────────────────────────────────────────
const lleno = entorno(200);
lleno.localStorage.datos.set('relleno', 'x'.repeat(190));

// Antes del lote 6 esto lanzaba QuotaExceededError y dejaba trabada la sincronización.
let fallo = null;
try {
  lleno.mergePendingPresence({uno: {id: 'uno', updatedAt: Date.now()}});
} catch (error) {
  fallo = error;
}
assert.equal(fallo, null, 'con el navegador lleno, guardar la presencia no puede lanzar');

// Y la bandera que congelaba todo: se comprueba sobre el código real, porque reconstruir
// applySharedPendingRow entero aquí pediría medio index.html.
const aplicar = extraer('applySharedPendingRow');
assert.match(aplicar, /finally\s*\{\s*\n?\s*sharedPendingApplying = false;/,
  'applySharedPendingRow tiene que devolver la bandera a false en un finally');
assert.doesNotMatch(aplicar.replace(/finally\s*\{[\s\S]*?\}/g, ''), /sharedPendingApplying = false;/,
  'no puede quedar ninguna asignación suelta fuera del finally');
const vivo = extraer('applySharedLivePayload');
assert.match(vivo, /finally\s*\{\s*\n?\s*sharedPendingApplying = false;/,
  'applySharedLivePayload igual');

// Las tres escrituras que el lote 6 vino a proteger.
assert.doesNotMatch(html, /localStorage\.setItem\(PRESENCE_STORAGE_KEY/,
  'la presencia se guarda con writeStoredJson');
assert.doesNotMatch(html, /localStorage\.setItem\(COMPLETED_STORAGE_KEY/,
  'el historial se guarda con writeStoredJson');

console.log('PASS almacenamiento lleno: la presencia se poda, guardarla no lanza con la cuota llena, y la bandera de sincronización vuelve a false en un finally.');
