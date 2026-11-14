// Volver a «Sin tocar» (migración 20261114060000) y cuándo la ficha ofrece el botón.
//
// Abrir la ficha de un lead lo pasa a «Contactado»; entre eso y el mensaje puede no haber mensaje
// (el límite de LinkedIn, un perfil que no deja escribir, la ficha equivocada). Aquí se comprueba
// que esa marca se pueda deshacer y que un contacto de verdad —un mensaje enviado en el hilo o el
// primer contacto cerrado en la reserva— no se pueda.
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const uid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.lr_pros_colaboradores(usuario_id uuid PRIMARY KEY,nombre text,activo boolean);
INSERT INTO public.lr_pros_colaboradores VALUES ('${uid(1)}','Jorge',true),('${uid(9)}','Fuera',false);
CREATE FUNCTION public.lr_pros_usuario_habilitado() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.lr_pros_colaboradores WHERE usuario_id=auth.uid() AND activo) $$;
CREATE TABLE public.lr_acrm_embudo(captura text PRIMARY KEY,etapa text NOT NULL DEFAULT 'nuevo',
 contactado_en timestamptz,respondio_en timestamptz,cotizado_en timestamptz,cerrado_en timestamptz,
 cotizacion text,monto numeric,nota text,version integer NOT NULL DEFAULT 0,
 actualizado_en timestamptz NOT NULL DEFAULT now(),actualizado_por uuid);
CREATE TABLE public.lr_acrm_mensajes(id bigserial PRIMARY KEY,captura text,direccion text,texto text);
CREATE TABLE public.lr_acrm_contactos(linkedin_url text PRIMARY KEY,estado text);
INSERT INTO public.lr_acrm_embudo(captura,etapa,contactado_en) VALUES
 ('li:https://www.linkedin.com/in/abierta','contactado',now()),
 ('li:https://www.linkedin.com/in/escrita','contactado',now()),
 ('li:https://www.linkedin.com/in/reservada','contactado',now()),
 ('wa:0:51987654321','respondio',now()),
 ('directo:1','nuevo',NULL);
INSERT INTO public.lr_acrm_mensajes(captura,direccion,texto) VALUES
 ('li:https://www.linkedin.com/in/escrita','enviado','Hola, vi tu perfil'),
 ('li:https://www.linkedin.com/in/abierta','recibido','Un entrante no es haber contactado');
INSERT INTO public.lr_acrm_contactos VALUES ('https://www.linkedin.com/in/reservada','contactado');
-- Como en la base real: el equipo lee las tablas del ACRM y solo escribe por las funciones.
GRANT SELECT ON public.lr_acrm_embudo,public.lr_acrm_mensajes,public.lr_acrm_contactos TO authenticated;`);
await db.exec(readFileSync('../../supabase/migrations/20261114060000_acrm_sin_tocar.sql', 'utf8'));

const llamar = (captura, version = 0) => db.query('SELECT public.lr_acrm_sin_tocar($1,$2)', [captura, version]);
const etapaDe = async (captura) => (await db.query('SELECT etapa,contactado_en,version FROM lr_acrm_embudo WHERE captura=$1', [captura])).rows[0];

await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid(1)}',false); SET ROLE authenticated;`);
// El caso de todos los días: se abrió la ficha, LinkedIn no dejó escribir, el lead vuelve a la cola.
await llamar('li:https://www.linkedin.com/in/abierta');
const vuelto = await etapaDe('li:https://www.linkedin.com/in/abierta');
assert.equal(vuelto.etapa, 'nuevo');
assert.equal(vuelto.contactado_en, null, 'sin fecha de contacto: el mes no lo cuenta como contactado');
assert.equal(vuelto.version, 1, 'sube la versión, como cualquier escritura del embudo');
assert.deepEqual((await db.query("SELECT count(*)::int n FROM lr_acrm_mensajes WHERE captura='li:https://www.linkedin.com/in/abierta'")).rows[0], {n: 1},
  'deshacer la etapa no borra el hilo: el entrante sigue ahí');
// Lo que no se deshace.
await assert.rejects(llamar('li:https://www.linkedin.com/in/escrita'), /mensaje enviado/, 'un mensaje enviado es un contacto de verdad');
await assert.rejects(llamar('li:https://www.linkedin.com/in/reservada'), /reserva/, 'el primer contacto cerrado en la reserva tampoco');
await assert.rejects(llamar('wa:0:51987654321'), /Contactado/, 'el que respondió no retrocede');
await assert.rejects(llamar('directo:1'), /Contactado/, 'el que ya está sin tocar no tiene qué deshacer');
await assert.rejects(llamar('li:https://www.linkedin.com/in/abierta', 0), /cambió/, 'con la versión vieja no se escribe');
await assert.rejects(llamar('no-existe'), /no está en el embudo/);
// Quién puede.
await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${uid(9)}',false); SET ROLE authenticated;`);
await assert.rejects(llamar('li:https://www.linkedin.com/in/escrita'), /autorizada/);
await db.exec('RESET ROLE; SET ROLE anon;');
await assert.rejects(llamar('li:https://www.linkedin.com/in/escrita'), /permission denied/);
await db.close();

// ── Cuándo lo ofrece la ficha ──────────────────────────────────────────────
const dom = new JSDOM('', {runScripts: 'outside-only', url: 'https://example.test'});
dom.window.eval(readFileSync('../../src/modules/prospeccion/acrm-leads.js', 'utf8'));
const api = dom.window.LRACRMLeads;
const lead = {captura: 'li:https://www.linkedin.com/in/abierta', etapa: 'contactado', linkedin: 'https://www.linkedin.com/in/abierta'};
assert.ok(api.sePuedeDevolver(lead, {hilo: [], reserva: null}), 'sin mensajes, la ficha lo ofrece');
assert.ok(api.sePuedeDevolver(lead, {hilo: [{direccion: 'recibido', texto: 'hola'}], reserva: {estado: 'reservado'}}),
  'un entrante y una reserva abierta no son haber escrito');
assert.equal(api.sePuedeDevolver(lead, {hilo: [{direccion: 'enviado', texto: 'hola'}]}), '', 'con un enviado, no');
assert.equal(api.sePuedeDevolver(lead, {hilo: [], reserva: {estado: 'contactado'}}), '', 'con la reserva cerrada, no');
assert.equal(api.sePuedeDevolver({...lead, etapa: 'respondio'}, {hilo: []}), '', 'solo desde «Contactado»');
assert.equal(api.sePuedeDevolver({...lead, etapa: 'nuevo'}, {hilo: []}), '');
assert.equal(api.sePuedeDevolver(null, {}), '');
// Sin la migración aplicada, se dice qué falta en vez de un PGRST202.
await assert.rejects(api.devolverSinTocar({rpc: async () => ({error: {code: 'PGRST202', message: 'Could not find the function'}})}, lead),
  /20261114060000/);
dom.window.close();

console.log('PASS sin tocar: la marca que pone abrir la ficha se deshace y deja el lead sin fecha de contacto, pero un mensaje enviado, una reserva cerrada, un lead que respondió, una versión vieja o una cuenta sin permiso no la deshacen; y la ficha solo ofrece el botón cuando la base lo va a aceptar.');
