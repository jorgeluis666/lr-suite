// La tabla maestra del ACRM (acrm-leads.js): qué consultas arma, cómo junta la próxima acción de
// cada lead, y que sus tres escrituras —cambiar etapa, registrar un contacto, programar una tarea—
// hagan en la base lo que la pantalla promete. Las escrituras corren contra las migraciones reales
// en PGlite; las lecturas, contra un cliente que anota lo que se le pide, porque PGlite no imita el
// PostgREST que las resuelve.
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const dom = new JSDOM('', {runScripts: 'outside-only', url: 'https://example.test'});
dom.window.eval(readFileSync('../../src/modules/prospeccion/acrm-leads.js', 'utf8'));
const api = dom.window.LRACRMLeads;
const plano = (v) => JSON.parse(JSON.stringify(v));

// ── Reglas puras ───────────────────────────────────────────────────────────
assert.deepEqual(plano(api.etapasPosibles('nuevo')), ['nuevo', 'contactado', 'respondio', 'cotizado', 'ganado', 'perdido']);
assert.deepEqual(plano(api.etapasPosibles('cotizado')), ['cotizado', 'ganado', 'perdido'], 'el embudo no retrocede');
assert.deepEqual(plano(api.etapasPosibles('perdido')).length, 6, 'un perdido se puede reabrir');
assert.equal(api.telefonoDe('wa:111:51987654321'), '51987654321');
assert.equal(api.telefonoDe('li:https://www.linkedin.com/in/x'), '');
assert.equal(api.linkedinDe('li:https://www.linkedin.com/in/x'), 'https://www.linkedin.com/in/x');

// ── La página: lo que pide y cómo junta la próxima acción ─────────────────
const pedidos = [];
const lector = (respuestas) => ({
  from(tabla) {
    const p = {tabla, ops: []};
    pedidos.push(p);
    const q = new Proxy({}, {get: (_, op) => op === 'then'
      ? (ok) => ok(respuestas[tabla](p))
      : (...args) => { p.ops.push([op, ...args]); return q; }});
    return q;
  }
});
const embudo = [
  {captura: 'wa:111:51987654321', etapa: 'respondio', version: 3, cotizacion: null, monto: null, actualizado_en: '2026-11-09T12:00:00Z',
   lr_acrm_capturas: {clave: 'wa:111:51987654321', canal: 'meta_whatsapp', nombre: 'Ana Lead', capturado_en: '2026-11-09T10:00:00Z', consulta: '¿Precio?'}},
  {captura: 'li:https://www.linkedin.com/in/x', etapa: 'nuevo', version: 1, cotizacion: null, monto: null, actualizado_en: '2026-10-01T00:00:00Z',
   lr_acrm_capturas: {clave: 'li:https://www.linkedin.com/in/x', canal: 'linkedin', nombre: 'Equis', capturado_en: '2026-10-01T00:00:00Z', consulta: ''}}
];
const cliente = lector({
  lr_acrm_embudo: () => ({data: embudo, count: 120, error: null}),
  lr_acrm_acciones: () => ({data: [
    {captura: 'wa:111:51987654321', accion: 'Responder', vence_en: '2026-11-10T15:00:00Z'},
    {captura: 'wa:111:51987654321', accion: 'Después', vence_en: '2026-11-12T15:00:00Z'}
  ], error: null})
});
const r = await api.pagina(cliente, {filtro: 'cotizados', canal: 'linkedin', busqueda: '50%_off', pagina: 1});
const [pEmbudo, pAcciones] = pedidos;
const op = (p, nombre) => p.ops.filter((o) => o[0] === nombre);
assert.deepEqual(plano(op(pEmbudo, 'in')[0]), ['in', 'etapa', ['cotizado', 'ganado', 'perdido']], '«Con cotización» son las tres últimas etapas');
assert.deepEqual(plano(op(pEmbudo, 'eq')[0]), ['eq', 'lr_acrm_capturas.canal', 'linkedin']);
assert.deepEqual(plano(op(pEmbudo, 'ilike')[0]), ['ilike', 'lr_acrm_capturas.nombre', '%50\\%\\_off%'], 'los comodines del buscador se escapan');
assert.deepEqual(plano(op(pEmbudo, 'range')[0]), ['range', 50, 99], 'la página 1 trae de la 50 a la 99');
assert.equal(op(pEmbudo, 'order')[0][1], 'actualizado_en', 'arriba lo que se movió último');
assert.deepEqual(plano(op(pAcciones, 'in')[0]), ['in', 'captura', ['wa:111:51987654321', 'li:https://www.linkedin.com/in/x']], 'solo las acciones de lo que está en pantalla');
assert.equal(r.leads[0].proxima.accion, 'Responder', 'la próxima acción es la primera por fecha');
assert.equal(r.leads[1].proxima, null);
assert.equal(r.leads[0].telefono, '51987654321');
assert.equal(r.total, 120);
assert.equal(r.hayMas, true);

pedidos.length = 0;
const conteos = {lr_acrm_capturas: [4073, 4050, 1, 22], lr_acrm_embudo: [4000]};
const contador = lector({
  lr_acrm_capturas: (p) => ({count: conteos.lr_acrm_capturas[{undefined: 0, linkedin: 1, meta_whatsapp: 2, directo: 3}[op(p, 'eq')[0]?.[2]]], error: null}),
  lr_acrm_embudo: () => ({count: 4000, error: null})
});
const res = await api.resumen(contador);
assert.deepEqual(plano(res), {total: 4073, porCanal: {linkedin: 4050, meta_whatsapp: 1, directo: 22}, sinTocar: 4000, contactados: 73});
assert.ok(pedidos.every((p) => op(p, 'select')[0][2]?.head), 'los conteos no bajan filas');

// ── Las escrituras, contra la base ─────────────────────────────────────────
const db = new PGlite();
const uid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${uid(1)}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.lr_pros_colaboradores(usuario_id uuid PRIMARY KEY,nombre text,activo boolean);
INSERT INTO public.lr_pros_colaboradores VALUES('${uid(1)}','Jorge Luis',true);
CREATE FUNCTION public.lr_pros_usuario_habilitado() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.lr_pros_colaboradores WHERE usuario_id=auth.uid() AND activo) $$;
CREATE TABLE public.lr_pros_contactos_propios(usuario_id uuid,linkedin_url text,nombre text,apellido text,primera_carga_en timestamptz);
CREATE VIEW public.lr_pros_contactos_unificados AS SELECT DISTINCT linkedin_url FROM public.lr_pros_contactos_propios;
GRANT SELECT ON public.lr_pros_colaboradores,public.lr_pros_contactos_unificados TO authenticated,service_role;
CREATE PUBLICATION supabase_realtime;
CREATE TABLE public.lr_suite_private_data(key text primary key, payload jsonb);`);
for (const name of [
  '20261109083029_acrm_contacto_compartido.sql', '20261109084815_acrm_pacing_acciones.sql',
  '20261109090317_acrm_atribucion_orden_eventos.sql', '20261109213000_acrm_embudo_mensajes.sql',
  '20261110010000_acrm_cotizaciones.sql', '20261110020000_acrm_cotizaciones_campos.sql'
]) await db.exec(readFileSync('../../supabase/migrations/' + name, 'utf8'));
await db.exec(`INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en) VALUES('li:https://www.linkedin.com/in/x','linkedin','Equis',now())`);
await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid(1)}',false);SET ROLE authenticated;`);
const escritor = {async rpc(nombre, args) {
  assert.equal(nombre, 'lr_acrm_operar');
  try {
    const q = await db.query('SELECT public.lr_acrm_operar($1,$2) AS r', [args.p_accion, JSON.stringify(args.p_datos)]);
    return {data: q.rows[0].r, error: null};
  } catch (error) { return {data: null, error: {message: error.message}}; }
}};
const etapa = async () => (await db.query(`SELECT etapa,version FROM public.lr_acrm_embudo WHERE captura='li:https://www.linkedin.com/in/x'`)).rows[0];
const lead = {captura: 'li:https://www.linkedin.com/in/x', ...(await etapa())};

await api.registrarContacto(escritor, lead, 'Le escribí por LinkedIn');
assert.equal((await etapa()).etapa, 'contactado', 'registrar un contacto lo saca de «Sin tocar»');
assert.equal((await db.query(`SELECT count(*)::int n FROM public.lr_acrm_mensajes WHERE direccion='enviado'`)).rows[0].n, 1, 'y queda en el hilo, contando para la racha');

await api.programar(escritor, lead, {accion: 'Llamar el jueves', venceEn: '2026-11-12T15:00:00Z', responsable: uid(1)});
assert.equal((await db.query(`SELECT accion FROM public.lr_acrm_acciones WHERE captura='li:https://www.linkedin.com/in/x' AND estado='pendiente'`)).rows[0].accion, 'Llamar el jueves');

await assert.rejects(api.cambiarEtapa(escritor, {...lead, version: 1}, 'respondio'), /cambió/, 'con la versión vieja se rechaza: otra persona lo movió');
await api.cambiarEtapa(escritor, {...lead, ...(await etapa())}, 'respondio');
assert.equal((await etapa()).etapa, 'respondio');
await assert.rejects(api.cambiarEtapa(escritor, {...lead, ...(await etapa())}, 'contactado'), /no retrocede/);

console.log('PASS leads: etapas hacia delante, filtros y buscador escapado, página 50 en 50 desde el embudo, próxima acción por fecha, conteos sin filas, y contacto, tarea y etapa escritos en la base con su control de versión.');
dom.window.close();
await db.close();
