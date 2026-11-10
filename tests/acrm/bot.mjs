// El bot de WhatsApp en el ACRM (migración 20261110090000): lo que responde queda en el hilo sin
// autor del equipo, mueve el embudo, cierra la tarea de responder y, si agenda, deja la reunión
// como hito. Y el equipo puede tomar la conversación desde la ficha para que el bot calle.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

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
CREATE TABLE public.lr_suite_private_data(key text primary key, payload jsonb);
-- La tabla de conversaciones de la Agenda, como la deja agenda.sql.
CREATE TABLE public.lr_suite_agenda_conversaciones(wa_id text primary key, nombre text,
 estado text not null default 'bot' check (estado in ('bot','humano')), etapa text not null default 'nuevo',
 resumen text not null default '', atencion text check (atencion in ('validacion','solicitud','error')),
 mensajes_count integer not null default 0, ultimo_mensaje_at timestamptz not null default now(), created_at timestamptz not null default now());`);
for (const name of [
  '20261109083029_acrm_contacto_compartido.sql', '20261109084815_acrm_pacing_acciones.sql',
  '20261109090317_acrm_atribucion_orden_eventos.sql', '20261109213000_acrm_embudo_mensajes.sql',
  '20261110010000_acrm_cotizaciones.sql', '20261110020000_acrm_cotizaciones_campos.sql',
  '20261110030000_acrm_cotizado_sigue_a_enviada.sql', '20261110070000_acrm_hitos.sql',
  '20261110090000_acrm_bot_whatsapp.sql'
]) await db.exec(readFileSync('../../supabase/migrations/' + name, 'utf8'));

const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const lead = 'wa:123456789:51987654321';
const etapa = async () => (await q('SELECT etapa FROM public.lr_acrm_embudo WHERE captura=$1', [lead]))[0].etapa;

// ── Llega un lead de un anuncio ────────────────────────────────────────────
await db.exec('RESET ROLE;SET ROLE service_role;');
await q('SELECT public.lr_acrm_recibir_meta($1)', [JSON.stringify({id: 'wamid.1', phone_id: '123456789', telefono: '51987654321',
  nombre: 'Ana Lead', fecha: new Date(Date.now() - 60000).toISOString(), consulta: '¿Cuánto cuesta Meta Ads?', anuncio_id: '120200001'})]);
assert.equal(await etapa(), 'nuevo');
assert.equal((await q("SELECT count(*)::int n FROM public.lr_acrm_acciones WHERE captura=$1 AND tipo='respuesta' AND estado='pendiente'", [lead]))[0].n, 1,
  'el lead deja su tarea de responder');

// ── El bot responde ────────────────────────────────────────────────────────
const r = (await q('SELECT public.lr_acrm_bot_respondio($1,$2) AS r', [lead, 'Hola Ana, ¿de qué es tu marca?']))[0].r;
assert.deepEqual(r, {ok: true, respuestas_cerradas: 1}, 'la tarea de responder se cierra sola');
const m = (await q("SELECT autor,origen,direccion FROM public.lr_acrm_mensajes WHERE captura=$1 AND direccion='enviado'", [lead]))[0];
assert.deepEqual([m.autor, m.origen], [null, 'agente'], 'el mensaje del bot va sin autor del equipo');
assert.equal(await etapa(), 'contactado', 'y mueve el embudo como cualquier respuesta');
await assert.rejects(q("INSERT INTO public.lr_acrm_mensajes(captura,direccion,texto,enviado_en,origen) VALUES($1,'enviado','x',now(),'manual')", [lead]),
  /check/i, 'un mensaje enviado a mano sigue necesitando autor');

// ── El lead contesta y el bot agenda ───────────────────────────────────────
await q('SELECT public.lr_acrm_recibir_meta($1)', [JSON.stringify({id: 'wamid.2', phone_id: '123456789', telefono: '51987654321',
  nombre: 'Ana Lead', fecha: new Date().toISOString(), consulta: 'Una tienda de ropa, ¿podemos hablar el jueves?'})]);
assert.equal(await etapa(), 'respondio');
await q('SELECT public.lr_acrm_bot_respondio($1,$2,$3,$4,$5)', [lead, 'Listo, quedó el jueves a las 11.', 'wamid.out', '2099-11-12T16:00:00Z', 'jueves 12 a las 11:00']);
const hito = (await q("SELECT canal,accion,vence_en FROM public.lr_acrm_acciones WHERE captura=$1 AND canal='reunion'", [lead]))[0];
assert.ok(hito, 'la reunión queda como hito en la ficha');
assert.match(hito.accion, /Reunión agendada por el bot · jueves 12 a las 11:00/);
assert.equal(new Date(hito.vence_en).toISOString(), '2099-11-12T16:00:00.000Z');
assert.deepEqual((await q("SELECT public.lr_acrm_bot_respondio('wa:1:0000000','x') AS r"))[0].r, {ok: false, motivo: 'sin_captura'});

// ── Nadie de afuera puede hacerlo hablar ───────────────────────────────────
await db.exec(`RESET ROLE;SELECT set_config('request.jwt.claim.sub','${uid(1)}',false);SET ROLE authenticated;`);
await assert.rejects(q('SELECT public.lr_acrm_bot_respondio($1,$2)', [lead, 'x']), /permission denied/, 'solo la función del bot, con service_role');

// El marcador no le cuenta al equipo lo que escribió el bot.
const marcador = (await q("SELECT public.lr_acrm_marcador(date_trunc('month', now())::date) AS m"))[0].m;
assert.equal(marcador.personas[0].mensajes, 0, 'la racha y los mensajes del equipo no incluyen al bot');
assert.equal(marcador.personas[0].racha, 0);

// ── El equipo toma la conversación desde la ficha ──────────────────────────
assert.equal((await q('SELECT public.lr_acrm_bot_estado($1) AS e', [lead]))[0].e.estado, 'bot', 'sin conversación todavía, atiende el bot');
assert.equal((await q('SELECT public.lr_acrm_bot_control($1,true) AS r', [lead]))[0].r.estado, 'humano');
await db.exec('RESET ROLE;');
assert.equal((await q("SELECT estado FROM public.lr_suite_agenda_conversaciones WHERE wa_id='51987654321'"))[0].estado, 'humano', 'el bot calla');
await db.exec(`RESET ROLE;UPDATE public.lr_suite_agenda_conversaciones SET atencion='solicitud';SELECT set_config('request.jwt.claim.sub','${uid(1)}',false);SET ROLE authenticated;`);
await q('SELECT public.lr_acrm_bot_control($1,false)', [lead]);
const vuelta = (await q('SELECT public.lr_acrm_bot_estado($1) AS e', [lead]))[0].e;
assert.deepEqual([vuelta.estado, vuelta.atencion], ['bot', null], 'al devolverla, vuelve el bot y se limpia la alerta');
await assert.rejects(q("SELECT public.lr_acrm_bot_control('li:https://www.linkedin.com/in/x',true)"), /Solo los leads de WhatsApp/);
await db.exec(`RESET ROLE;SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000009',false);SET ROLE authenticated;`);
await assert.rejects(q('SELECT public.lr_acrm_bot_control($1,true)', [lead]), /autorizada/, 'sin estar habilitado en el ACRM, no');

console.log('PASS bot: lo que responde el bot queda en el hilo sin autor, mueve el embudo, cierra la tarea de responder, no suma al marcador del equipo y su reunión queda como hito; solo la service_role lo anota, y el equipo toma y devuelve la conversación desde la ficha.');
await db.close();
