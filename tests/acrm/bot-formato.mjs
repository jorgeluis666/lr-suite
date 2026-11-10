// El prompt comercial del bot, convertido en reglas que no dependen del modelo:
//   · las banderas [FLAG: …] nunca llegan al cliente; [FLAG: PAUSE_BOT] transfiere de verdad;
//   · transferir_a_humano responde la frase fija de la agencia y el bot deja de atender;
//   · el filtro frena el markdown (# y **) y más de 2 horarios ofrecidos.
//
// asistente.ts es de Deno; se empaqueta con esbuild con Claude y Supabase de mentira, para probar
// el código real sin llamar a nadie.
import {build} from 'esbuild';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'bot-formato-'));
writeFileSync(join(dir, 'anthropic.js'), `export default class { constructor(){ this.messages = {create: (p) => globalThis.__claude(p)}; } }`);
writeFileSync(join(dir, 'supabase.js'), `export function createClient(){ return globalThis.__db; }`);
const salida = join(dir, 'asistente.mjs');
await build({
  // fileURLToPath, no .pathname: en Windows .pathname deja la barra de delante y el %20 del
  // espacio de «Proyectos IA», y esbuild no encuentra el archivo.
  entryPoints: [fileURLToPath(new URL('../../supabase/functions/_shared/asistente.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'neutral', outfile: salida, logLevel: 'silent',
  alias: {'@anthropic-ai/sdk': join(dir, 'anthropic.js'), '@supabase/supabase-js': join(dir, 'supabase.js')}
});
globalThis.Deno = {env: {get: (k) => ({ANTHROPIC_API_KEY: 'x', SUPABASE_URL: 'https://p.test', SUPABASE_SERVICE_ROLE_KEY: 'k'})[k]}};
const escrito = [];
const tabla = (nombre) => {
  const q = {insert: (fila) => { escrito.push([nombre, 'insert', fila]); return Promise.resolve({error: null}); },
    update: (fila) => ({eq: () => { escrito.push([nombre, 'update', fila]); return Promise.resolve({error: null}); }}),
    select: () => q, eq: () => q, order: () => q, limit: () => Promise.resolve({data: [], error: null})};
  return q;
};
globalThis.__db = {from: tabla, rpc: async () => ({data: null, error: null})};
const A = await import(pathToFileURL(salida).href);

const ctx = (extra = {}) => ({
  conversacion: {wa_id: '51987654321', etapa: 'diagnostico', resumen: '', estado: 'bot'},
  config: {zona_horaria: 'America/Lima', tipos: [], duracion_default_min: 30, modelo_conversacion: 'm', modelo_validacion: 'm'},
  estandares: {idioma: 'español', largo_max: 700, requisitos_cita: [], siempre: [], nunca: [], derivar_si: [], tono: '', limites: {}, respuesta_segura: 'Te escribe una persona del equipo.'},
  conocimiento: [{tipo: 'servicio', titulo: 'Google Ads', contenido: 'Gestión enfocada en conversión.'}],
  citaCreada: null, huecosOfrecidos: [], ...extra
});

// ── El prompt lleva lo que pidió la agencia ──
const prompt = A.promptSistema(ctx());
for (const frase of ['Agente Comercial Senior', 'llamada\nde exploración de 30 minutos con nuestro equipo (Diego)', 'como máximo 2 horarios', 'Máximo 2 a 3 oraciones', 'ÚNICAMENTE', 'transferir_a_humano'])
  assert.ok(prompt.includes(frase), `el prompt incluye «${frase}»`);

// ── Banderas: fuera del texto ──
assert.deepEqual(A.sinBanderas('Perfecto, te agendé el jueves a las 15:00. [FLAG: SCHEDULED_SUCCESS]'), {texto: 'Perfecto, te agendé el jueves a las 15:00.', pausa: false});
assert.equal(A.sinBanderas('Te paso con un asesor [flag: pause_bot]').pausa, true);

// ── Filtro: markdown y horarios ──
const reglas = (t, extra) => A.reglasDuras(t, ctx(extra));
assert.deepEqual(reglas('¿Te queda mejor el jueves a las 10:00 am o a las 3:30 pm?'), [], 'dos horarios pasan');
assert.match(reglas('Tengo 10:00 am, 11:30 am o 3:30 pm.').join(), /máximo es 2/);
assert.match(reglas('## Servicios\nHacemos **Google Ads**.').join(), /markdown/);
assert.deepEqual(reglas('Hacemos *Google Ads* enfocado en conversión.'), [], 'la negrita de WhatsApp con un * pasa');

// ── Transferir: la herramienta ──
escrito.length = 0;
let llamadas = 0;
globalThis.__claude = async () => (++llamadas === 1
  ? {stop_reason: 'tool_use', content: [{type: 'tool_use', id: 't1', name: 'transferir_a_humano', input: {motivo: 'Pidió hablar con una persona'}}]}
  : {stop_reason: 'end_turn', content: [{type: 'text', text: 'Claro, ya te paso.'}]});
let c = ctx();
let r = await A.responder(c, [{rol: 'cliente', texto: 'Quiero hablar con una persona'}]);
assert.deepEqual([r.texto, r.transferido, r.veredicto], [A.TRANSFERENCIA, true, 'aprobado'], 'responde la frase fija de la agencia');
assert.ok(escrito.some(([t, op, f]) => t === 'lr_suite_agenda_conversaciones' && op === 'update' && f.estado === 'humano'), 'y el bot deja de atender');
assert.ok(escrito.some(([t, op, f]) => t === 'lr_suite_agenda_solicitudes' && /Pidió hablar con una persona/.test(f.detalle)), 'el motivo queda para el equipo');

// ── Transferir: la bandera escrita en el texto hace lo mismo ──
escrito.length = 0;
globalThis.__claude = async () => ({stop_reason: 'end_turn', content: [{type: 'text', text: 'Voy a transferir tu consulta. [FLAG: PAUSE_BOT]'}]});
r = await A.responder(ctx(), [{rol: 'cliente', texto: 'Esto es un desastre'}]);
assert.deepEqual([r.texto, r.transferido], [A.TRANSFERENCIA, true]);
assert.ok(escrito.some(([, op, f]) => op === 'update' && f.estado === 'humano'));

// ── En modo prueba del panel, transferir no toca nada ──
escrito.length = 0; llamadas = 0;
globalThis.__claude = async () => (++llamadas === 1
  ? {stop_reason: 'tool_use', content: [{type: 'tool_use', id: 't1', name: 'transferir_a_humano', input: {motivo: 'x'}}]}
  : {stop_reason: 'end_turn', content: [{type: 'text', text: ''}]});
r = await A.responder(ctx({prueba: true}), [{rol: 'cliente', texto: 'Quiero una persona'}]);
assert.equal(r.texto, A.TRANSFERENCIA);
assert.equal(escrito.length, 0, 'probar en el panel no transfiere de verdad');

console.log('PASS bot-formato: el prompt lleva el rol comercial, la llamada de 30 min con Diego, 2 horarios y 2-3 oraciones; las banderas no llegan al cliente; PAUSE_BOT y transferir_a_humano responden la frase fija y callan al bot; el filtro frena markdown y más de 2 horarios.');
