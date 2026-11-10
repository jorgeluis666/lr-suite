// El ACRM absorbe Cotizaciones: la cotización pasa a ser una fila al lado del prospecto y su
// contactabilidad —los ocho toques— se convierte en acciones de la misma cola que todo lo demás.
//
// Lo que se prueba aquí es lo que no se ve hasta que falla: que las 22 cotizaciones viejas
// entren con su prospecto y su etapa, que haya un solo toque pendiente por cotización (y no los
// ocho), que completarlo avance el contador y programe el siguiente, y que al aprobarla o
// perderla el seguimiento se detenga.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const uid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${uid(1)}'),('${uid(2)}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.lr_pros_colaboradores(usuario_id uuid PRIMARY KEY,nombre text,activo boolean);
INSERT INTO public.lr_pros_colaboradores VALUES('${uid(1)}','Jorge Luis',true),('${uid(2)}','Diego',true);
CREATE FUNCTION public.lr_pros_usuario_habilitado() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.lr_pros_colaboradores WHERE usuario_id=auth.uid() AND activo) $$;
CREATE TABLE public.lr_pros_contactos_propios(usuario_id uuid,linkedin_url text,nombre text,apellido text,primera_carga_en timestamptz);
CREATE VIEW public.lr_pros_contactos_unificados AS SELECT DISTINCT linkedin_url FROM public.lr_pros_contactos_propios;
GRANT SELECT ON public.lr_pros_colaboradores,public.lr_pros_contactos_unificados TO authenticated,service_role;
CREATE PUBLICATION supabase_realtime;
-- La fila de cotizaciones que hoy vive en el bloque JSON, con tres casos distintos.
CREATE TABLE public.lr_suite_private_data(key text primary key, payload jsonb);
INSERT INTO public.lr_suite_private_data VALUES('quotes', $q$[
 {"id":"cot-01","cliente":"Oskar Valle","contacto":"Oskar","telefono":"+51 949 037 970","emailContacto":"",
  "servicio":"Gestión Google Ads","montoCotizado":650,"montoFacturado":0,"fechaEnvio":"2026-11-01",
  "estado":"Enviada","contactosRealizados":0},
 {"id":"cot-02","cliente":"Juris Group","servicio":"Auditoría Google","montoCotizado":450,
  "montoFacturado":450,"fechaEnvio":"2026-10-20","estado":"Aprobado","contactosRealizados":3},
 {"id":"cot-03","cliente":"Sin fecha","servicio":"Meta Ads","montoCotizado":900,"fechaEnvio":"","estado":"En revisión"},
 {"id":"cot-99","cliente":"De Febrero","servicio":"Google Ads","montoCotizado":300,
  "fechaEnvio":"2026-02-06","estado":"Enviada","contactosRealizados":0}
]$q$::jsonb);`);

for (const name of [
  '20261109083029_acrm_contacto_compartido.sql',
  '20261109084815_acrm_pacing_acciones.sql',
  '20261109090317_acrm_atribucion_orden_eventos.sql',
  '20261109213000_acrm_embudo_mensajes.sql',
  '20261110010000_acrm_cotizaciones.sql'
]) await db.exec(readFileSync('../../supabase/migrations/' + name, 'utf8'));

const user = async (n) => db.exec(`RESET ROLE;SELECT set_config('request.jwt.claim.sub','${uid(n)}',false);SET ROLE authenticated;`);
const op = async (a, data = {}) => (await db.query('SELECT public.lr_acrm_operar($1,$2) AS r', [a, JSON.stringify(data)])).rows[0].r;
const fila = async (sql, params = []) => (await db.query(sql, params)).rows;
const cot = async (id) => (await fila('SELECT * FROM public.lr_acrm_cotizaciones WHERE id=$1', [id]))[0];
const emb = async (clave) => (await fila('SELECT * FROM public.lr_acrm_embudo WHERE captura=$1', [clave]))[0];
const pendientes = async (clave) =>
  fila("SELECT accion,vence_en::date::text AS dia FROM public.lr_acrm_acciones WHERE captura=$1 AND tipo='cotizacion' AND estado='pendiente'", [clave]);

await user(1);

// ── La migración ───────────────────────────────────────────────────────────
assert.equal((await fila('SELECT count(*)::int n FROM public.lr_acrm_cotizaciones'))[0].n, 4);
assert.equal((await fila("SELECT count(*)::int n FROM public.lr_acrm_capturas WHERE canal='directo'"))[0].n, 4,
  'cada cotización vieja estrena su prospecto');
assert.equal((await cot('cot-01')).estado, 'enviada');
assert.equal((await cot('cot-02')).estado, 'aprobada', '«Aprobado» del módulo viejo se traduce');
assert.equal((await cot('cot-03')).estado, 'revision', '«En revisión» también');
assert.equal((await cot('cot-02')).contactos_hechos, 3, 'los toques ya hechos se conservan');
assert.equal((await emb('co:cot-01')).etapa, 'cotizado');
assert.equal((await emb('co:cot-02')).etapa, 'ganado', 'una aprobada entra ya ganada');
assert.ok((await emb('co:cot-02')).cerrado_en, 'y con su fecha de cierre');
assert.equal(Number((await emb('co:cot-01')).monto), 650);

// ── La contactabilidad se vuelve cola ──────────────────────────────────────
assert.equal((await pendientes('co:cot-01')).length, 0, 'todavía no, hasta preparar');
await op('preparar');
const toques = await pendientes('co:cot-01');
assert.equal(toques.length, 1, 'un solo toque pendiente, no los ocho');
assert.equal(toques[0].dia, '2026-11-02', 'el primero es un día después de enviada');
assert.match(toques[0].accion, /Contacto 1 de 8/);
assert.match(toques[0].accion, /Oskar Valle/, 'y dice de quién es');

assert.equal((await pendientes('co:cot-02')).length, 0, 'una aprobada no se sigue persiguiendo');
assert.equal((await pendientes('co:cot-03')).length, 0, 'sin fecha de envío no hay cadencia que contar');
assert.equal((await pendientes('co:cot-99')).length, 0,
  'una cotización de febrero ya agotó su ventana: no llena la cola de vencidos de hace meses');
assert.equal((await emb('co:cot-99')).etapa, 'cotizado', 'pero sí cuenta en el embudo');

// Repetir «preparar» no duplica ni reinicia la prioridad.
await op('preparar');
assert.equal((await pendientes('co:cot-01')).length, 1);

// ── Completar un toque programa el siguiente ───────────────────────────────
const accion = (await fila("SELECT id,version,responsable FROM public.lr_acrm_acciones WHERE captura='co:cot-01' AND tipo='cotizacion' AND estado='pendiente'"))[0];
await db.exec(`RESET ROLE;SELECT set_config('request.jwt.claim.sub','${accion.responsable}',false);SET ROLE authenticated;`);
await op('completar', {id: accion.id, version: accion.version});
assert.equal((await cot('cot-01')).contactos_hechos, 1, 'el contador avanza solo');
const siguiente = await pendientes('co:cot-01');
assert.equal(siguiente.length, 1);
assert.equal(siguiente[0].dia, '2026-11-04', 'el segundo toque cae en el día 3 de la cadencia');
assert.match(siguiente[0].accion, /Contacto 2 de 8/);

// ── Aprobarla detiene el seguimiento ───────────────────────────────────────
await user(1);
await op('cotizacion', {id: 'cot-01', cliente: 'Oskar Valle', monto: 650, estado: 'aprobada', enviada: '2026-11-01'});
assert.equal((await pendientes('co:cot-01')).length, 0, 'ganada: deja de perseguirse');
assert.equal((await emb('co:cot-01')).etapa, 'ganado');

// ── Una cotización nueva sin prospecto se lo crea ──────────────────────────
await op('cotizacion', {id: 'cot-04', cliente: 'Cliente Nuevo', telefono: '999111222', monto: 1200, enviada: '2026-11-05'});
assert.equal((await fila("SELECT canal FROM public.lr_acrm_capturas WHERE clave='co:cot-04'"))[0].canal, 'directo');
assert.equal((await emb('co:cot-04')).etapa, 'cotizado');
assert.equal((await pendientes('co:cot-04')).length, 1, 'y entra a la cola de seguimiento sola');

// ── El marcador cuenta el canal directo ────────────────────────────────────
const marcador = (await fila("SELECT public.lr_acrm_marcador('2026-11-01') AS m"))[0].m;
const directo = marcador.canales.find((c) => c.canal === 'directo');
assert.ok(directo, 'el canal directo aparece en el marcador');
assert.equal(directo.cotizados, 2, 'cot-03 no tiene fecha, cot-01 ya está ganada');
assert.equal(directo.ganados, 1);
assert.equal(Number(directo.monto_ganado), 650);

// ── Nadie escribe las tablas por su cuenta ─────────────────────────────────
await assert.rejects(db.query("UPDATE public.lr_acrm_cotizaciones SET monto=1"), /permission denied/);
await user(3);
await assert.rejects(op('cotizacion', {id: 'x', cliente: 'y'}), /autorizada/);

console.log('PASS cotizaciones en el ACRM: las viejas migran con su prospecto y etapa, un solo toque pendiente por cotización, completarlo programa el siguiente, aprobarla lo detiene, las de hace meses no llenan la cola, y el canal directo entra al marcador.');
await db.close();
