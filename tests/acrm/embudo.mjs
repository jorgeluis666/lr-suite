// El embudo y el hilo de mensajes: que la etapa la muevan los mensajes y no el teclado, que no
// retroceda, y que el marcador cuente lo que de verdad pasó este mes.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${uid(1)}'),('${uid(2)}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.lr_pros_colaboradores(usuario_id uuid PRIMARY KEY,nombre text,activo boolean);
INSERT INTO public.lr_pros_colaboradores VALUES('${uid(1)}','Jorge Luis',true),('${uid(2)}','Diego',true);
CREATE FUNCTION public.lr_pros_usuario_habilitado() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.lr_pros_colaboradores WHERE usuario_id=auth.uid() AND activo) $$;
CREATE TABLE public.lr_pros_contactos_propios(usuario_id uuid,linkedin_url text,nombre text,apellido text,primera_carga_en timestamptz);
INSERT INTO public.lr_pros_contactos_propios SELECT '${uid(1)}','https://www.linkedin.com/in/person-'||n,'Persona',n::text,'2026-11-01 05:00:00+00' FROM generate_series(1,4)n;
CREATE VIEW public.lr_pros_contactos_unificados AS SELECT DISTINCT linkedin_url FROM public.lr_pros_contactos_propios;
GRANT SELECT ON public.lr_pros_colaboradores,public.lr_pros_contactos_unificados TO authenticated,service_role;
CREATE PUBLICATION supabase_realtime;`);
for(const name of [
 '20261109083029_acrm_contacto_compartido.sql',
 '20261109084815_acrm_pacing_acciones.sql',
 '20261109090317_acrm_atribucion_orden_eventos.sql',
 '20261109213000_acrm_embudo_mensajes.sql'
])await db.exec(readFileSync('../../supabase/migrations/'+name,'utf8'));

const user=async n=>db.exec(`RESET ROLE;SELECT set_config('request.jwt.claim.sub','${uid(n)}',false);SET ROLE authenticated;`);
const op=async(a,data={})=>(await db.query('SELECT public.lr_acrm_operar($1,$2) AS r',[a,JSON.stringify(data)])).rows[0].r;
const fila=async clave=>(await db.query('SELECT * FROM public.lr_acrm_embudo WHERE captura=$1',[clave])).rows[0];
const marcador=async mes=>(await db.query('SELECT public.lr_acrm_marcador($1) AS r',[mes])).rows[0].r;
const ahora=new Date();
const mes=`${ahora.getFullYear()}-${String(ahora.getMonth()+1).padStart(2,'0')}-01`;

// Lo que ya existía entró al embudo sin que nadie lo tocara.
assert.equal((await db.query("SELECT count(*)::int n FROM public.lr_acrm_embudo WHERE etapa='nuevo'")).rows[0].n,4);

// Un lead de WhatsApp escribe. Queda registrado, pero NADIE le respondió: sigue sin tocar.
await db.exec('RESET ROLE;SET ROLE service_role;');
const evento={id:'wamid.1',phone_id:'123456789',telefono:'51999888777',nombre:'Consulta',fecha:new Date(ahora.getTime()-7200000).toISOString(),consulta:'¿Cuánto cuesta Google Ads?'};
await db.query('SELECT public.lr_acrm_recibir_meta($1)',[JSON.stringify(evento)]);
const lead='wa:123456789:51999888777';
assert.equal((await fila(lead)).etapa,'nuevo','un entrante sin respuesta no mueve el embudo');
assert.equal((await db.query('SELECT count(*)::int n FROM public.lr_acrm_mensajes WHERE captura=$1',[lead])).rows[0].n,1);

// Le respondemos: el mensaje mueve la etapa, nadie la escribe.
await user(1);
await op('mensaje',{captura:lead,direccion:'enviado',texto:'Hola, te cuento los planes.',origen:'agente'});
let e=await fila(lead);
assert.equal(e.etapa,'contactado');assert.ok(e.contactado_en);
assert.equal((await db.query('SELECT autor FROM public.lr_acrm_mensajes WHERE direccion=$1',['enviado'])).rows[0].autor,uid(1));

// Contesta: ahora sí hay conversación.
await op('mensaje',{captura:lead,direccion:'recibido',texto:'Me interesa, ¿me pasas propuesta?'});
e=await fila(lead);
assert.equal(e.etapa,'respondio');assert.ok(e.respondio_en);

// Cotizado y ganado: lo que los mensajes no pueden deducir.
await op('etapa',{captura:lead,etapa:'cotizado',version:e.version,cotizacion:'COT-2026-118',monto:2400});
e=await fila(lead);
assert.equal(e.etapa,'cotizado');assert.equal(e.cotizacion,'COT-2026-118');assert.equal(Number(e.monto),2400);assert.ok(e.cotizado_en);
await assert.rejects(op('etapa',{captura:lead,etapa:'contactado',version:e.version}),/no retrocede/);
await assert.rejects(op('etapa',{captura:lead,etapa:'ganado',version:e.version+9}),/cambió/);
await op('etapa',{captura:lead,etapa:'ganado',version:e.version});
e=await fila(lead);
assert.equal(e.etapa,'ganado');assert.ok(e.cerrado_en);assert.equal(Number(e.monto),2400,'el monto se conserva si no se manda otro');

// Dar por perdido es un final, no un retroceso; y desde perdido se puede reabrir.
const otro=(await db.query("SELECT clave FROM public.lr_acrm_capturas WHERE canal='linkedin' ORDER BY clave LIMIT 1")).rows[0].clave;
let o=await fila(otro);
await op('etapa',{captura:otro,etapa:'perdido',version:o.version,nota:'No tiene presupuesto este año'});
o=await fila(otro);assert.equal(o.etapa,'perdido');assert.equal(o.nota,'No tiene presupuesto este año');
assert.equal(o.contactado_en,null,'perder a quien nadie contactó no inventa un contacto');
await op('etapa',{captura:otro,etapa:'respondio',version:o.version});
o=await fila(otro);
assert.equal(o.etapa,'respondio','desde perdido se reabre');
assert.equal(o.cerrado_en,null,'reabrir limpia la fecha de cierre');
assert.ok(o.contactado_en,'reabrir como «respondió» sí implica que se le escribió');

// Registrar el envío por LinkedIn desde la reserva también cuenta como contacto.
const perfil=(await db.query("SELECT clave FROM public.lr_acrm_capturas WHERE canal='linkedin' ORDER BY clave OFFSET 1 LIMIT 1")).rows[0].clave;
const url=perfil.slice(3);
await db.query('SELECT public.lr_acrm_contactar($1,$2,$3,$4)',[url,'reservar',null,0]);
const v=(await db.query('SELECT version FROM public.lr_acrm_contactos WHERE linkedin_url=$1',[url])).rows[0].version;
await db.query('SELECT public.lr_acrm_contactar($1,$2,$3,$4)',[url,'confirmar',null,v]);
assert.equal((await fila(perfil)).etapa,'contactado','la reserva confirmada mueve el embudo');

// Nadie escribe en las tablas por su cuenta: todo pasa por la RPC.
await assert.rejects(db.query("INSERT INTO public.lr_acrm_mensajes(captura,direccion,texto,enviado_en,autor) VALUES($1,'enviado','a',now(),$2)",[lead,uid(1)]),/permission denied/);
await assert.rejects(db.query("UPDATE public.lr_acrm_embudo SET etapa='ganado'"),/permission denied/);
await assert.rejects(op('mensaje',{captura:'no-existe',direccion:'enviado',texto:'hola'}),/no existe/);
await assert.rejects(op('mensaje',{captura:lead,direccion:'enviado',texto:'luego',enviado_en:new Date(ahora.getTime()+3600000).toISOString()}),/futuro/);
await user(3);
await assert.rejects(op('mensaje',{captura:lead,direccion:'enviado',texto:'hola'}),/autorizada/);

// La racha cuenta días seguidos escribiendo, y se corta si ayer no hubo nada.
await user(2);
for(const dias of [0,1,2]){
 await op('mensaje',{captura:lead,direccion:'enviado',texto:'Seguimiento '+dias,
  enviado_en:new Date(ahora.getTime()-dias*86400000).toISOString()});
}
await op('mensaje',{captura:lead,direccion:'enviado',texto:'Hace una semana',
 enviado_en:new Date(ahora.getTime()-7*86400000).toISOString()});
await user(1);
const m=await marcador(mes);
const diego=m.personas.find(p=>p.nombre==='Diego');
assert.equal(diego.racha,3,'tres días seguidos, el salto de la semana pasada no suma');
assert.equal(diego.prospectos,1);
const jorge=m.personas.find(p=>p.nombre==='Jorge Luis');
assert.equal(jorge.racha,1);
const wa=m.canales.find(c=>c.canal==='meta_whatsapp');
assert.equal(wa.contactados,1);assert.equal(wa.respondieron,1);assert.equal(wa.ganados,1);
assert.equal(Number(wa.monto_ganado),2400);
const li=m.canales.find(c=>c.canal==='linkedin');
assert.equal(li.contactados,2,'el perfil confirmado y el que se reabrió como «respondió»');
assert.equal(li.respondieron,1);
assert.equal(li.sin_tocar,2);

console.log('PASS embudo: entrante sin respuesta no mueve nada, mensajes mueven la etapa, cotizado y cierre a mano, sin retroceso, reapertura, reserva confirmada, RLS, racha y marcador por canal.');
await db.close();
