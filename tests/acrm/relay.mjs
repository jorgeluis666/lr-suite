// El webhook único de WhatsApp (acrm-meta): Meta llama solo aquí. Con el lead ya guardado en el
// ACRM, el mismo mensaje —cuerpo y firma intactos— se reenvía al bot (función whatsapp).
//
// La función es de Deno; aquí se empaqueta con esbuild y corre en Node con un Deno, un Supabase y
// un fetch de mentira, para probar el código real: qué responde a Meta, cuándo reenvía y qué manda.
import {build} from 'esbuild';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'relay-'));
writeFileSync(join(dir, 'supabase.js'), `export function createClient(){return globalThis.__supabase;}`);
const salida = join(dir, 'acrm-meta.mjs');
await build({
  entryPoints: [new URL('../../supabase/functions/acrm-meta/index.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'neutral', outfile: salida, logLevel: 'silent',
  alias: {'npm:@supabase/supabase-js@2.105.3': join(dir, 'supabase.js')}
});

let handler = null;
const entorno = {META_APP_SECRET: 'secreto-de-prueba', WHATSAPP_VERIFY_TOKEN: 'v', WHATSAPP_PHONE_ID: '123456789',
  SUPABASE_URL: 'https://proyecto.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key'};
globalThis.Deno = {serve: (fn) => { handler = fn; }, env: {get: (k) => entorno[k]}};
const pendientes = [];
globalThis.EdgeRuntime = {waitUntil: (p) => pendientes.push(p)};
const rpcs = [];
let falla = false;
globalThis.__supabase = {rpc: (nombre, args) => ({abortSignal: async () => { rpcs.push([nombre, args]); return {error: falla ? {message: 'x'} : null}; }})};
const reenvios = [];
globalThis.fetch = async (url, init) => { reenvios.push({url, init}); return {ok: true, status: 200}; };
await import(pathToFileURL(salida).href);
assert.ok(handler, 'la función se registra con Deno.serve');

const firmar = async (cuerpo) => {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(entorno.META_APP_SECRET), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return 'sha256=' + Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(cuerpo))), (x) => x.toString(16).padStart(2, '0')).join('');
};
const payload = (texto) => JSON.stringify({object: 'whatsapp_business_account', entry: [{changes: [{field: 'messages', value: {
  metadata: {phone_number_id: '123456789'}, contacts: [{wa_id: '51987654321', profile: {name: 'Ana'}}],
  messages: [{from: '51987654321', id: 'wamid.' + texto.length, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: {body: texto},
    referral: {source_type: 'ad', source_id: 'ad-9'}}]}}]}]});
const llamar = async (cuerpo, firma) => handler(new Request('https://proyecto.test/functions/v1/acrm-meta', {
  method: 'POST', headers: {'x-hub-signature-256': firma, 'content-type': 'application/json'}, body: cuerpo}));

// ── Un mensaje de un anuncio: se guarda, Meta recibe su 200 y el bot lo recibe igual ──
const cuerpo = payload('¿Cuánto cuesta Meta Ads?');
const firma = await firmar(cuerpo);
let r = await llamar(cuerpo, firma);
assert.equal(r.status, 200);
assert.equal(rpcs[0][0], 'lr_acrm_recibir_meta', 'el lead se guarda en el ACRM antes del 200');
assert.equal(rpcs[0][1].p_evento.anuncio_id, 'ad-9');
await Promise.all(pendientes);
assert.equal(reenvios.length, 1, 'y el mensaje pasa al bot');
const {url, init} = reenvios[0];
assert.equal(url, 'https://proyecto.test/functions/v1/whatsapp');
assert.equal(init.body, cuerpo, 'con el cuerpo intacto');
assert.equal(init.headers['x-hub-signature-256'], firma, 'y la misma firma de Meta, que el bot vuelve a comprobar');
assert.equal(init.headers.authorization, 'Bearer service-key', 'con la clave del servidor, que nunca sale de Supabase');

// ── Si guardar falla, Meta reintenta y el bot no habla todavía ──
falla = true; reenvios.length = 0;
r = await llamar(cuerpo, firma);
assert.equal(r.status, 503);
assert.equal(reenvios.length, 0, 'sin lead guardado no se reenvía: el reintento de Meta lo traerá');
falla = false;

// ── Firma falsa: ni se guarda ni se reenvía ──
reenvios.length = 0; rpcs.length = 0;
r = await llamar(cuerpo, 'sha256=' + '0'.repeat(64));
assert.equal(r.status, 403);
assert.deepEqual([rpcs.length, reenvios.length], [0, 0]);

// ── ACRM_BOT=off apaga el bot sin tocar Meta ──
entorno.ACRM_BOT = 'off';
r = await llamar(cuerpo, firma);
assert.equal(r.status, 200);
assert.equal(reenvios.length, 0, 'con el bot apagado, el lead entra al ACRM y nadie responde');
delete entorno.ACRM_BOT;

// ── Un aviso de entrega (sin mensajes) no despierta al bot ──
const estados = JSON.stringify({object: 'whatsapp_business_account', entry: [{changes: [{field: 'messages', value: {
  metadata: {phone_number_id: '123456789'}, statuses: [{id: 'wamid.x', status: 'read'}]}}]}]});
r = await llamar(estados, await firmar(estados));
assert.equal(r.status, 200);
assert.equal(reenvios.length, 0, 'leído, entregado o enviado no son mensajes: no se reenvían');

console.log('PASS webhook único: guarda el lead antes del 200 y reenvía al bot el mismo cuerpo con la misma firma; si guardar falla, 503 y sin bot; firma falsa, nada; ACRM_BOT=off, solo ACRM; los avisos de entrega no despiertan al bot.');
