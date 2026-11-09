import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.lr_pros_colaboradores(usuario_id uuid PRIMARY KEY,nombre text,activo boolean);
INSERT INTO public.lr_pros_colaboradores VALUES ('00000000-0000-0000-0000-000000000001','Jorge',true),('00000000-0000-0000-0000-000000000002','Diego',true);
CREATE FUNCTION public.lr_pros_usuario_habilitado() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.lr_pros_colaboradores WHERE usuario_id=auth.uid() AND activo) $$;
CREATE TABLE public.lr_pros_contactos_propios(linkedin_url text PRIMARY KEY);
INSERT INTO public.lr_pros_contactos_propios VALUES('https://www.linkedin.com/in/test-profile');
CREATE VIEW public.lr_pros_contactos_unificados AS SELECT * FROM public.lr_pros_contactos_propios;
CREATE PUBLICATION supabase_realtime;`);
await db.exec(readFileSync('../../supabase/migrations/20261109083029_acrm_contacto_compartido.sql','utf8'));
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function user(n){await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${uid(n)}',false); SET ROLE authenticated;`);}
async function action(a,v,owner=null,url='https://www.linkedin.com/in/test-profile'){return (await db.query('SELECT public.lr_acrm_contactar($1,$2,$3,$4) AS result',[url,a,owner,v])).rows[0].result;}
await user(1);
let row=await action('asignar',0,uid(1),'http://linkedin.com/in/TEST-profile/?trk=x');
assert.equal(row.version,1);
await user(2);
await assert.rejects(action('reservar',1),/otro compañero/);
await user(1);
row=await action('reservar',1);assert.equal(row.estado,'reservado');
await assert.rejects(action('reservar',1),/cambió/);
await user(2);
await assert.rejects(action('reservar',2),/reservado/);
await assert.rejects(action('cancelar',2),/Solo quien/);
await assert.rejects(db.exec("UPDATE public.lr_acrm_contactos SET estado='asignado'"),/permission denied/);
await user(1);
row=await action('confirmar',2);assert.equal(row.contactado_por,uid(1));assert.equal(row.version,3);
await assert.rejects(action('reservar',3),/contactado/);
await assert.rejects(action('asignar',3,uid(2)),/realizado/);
await user(3);
assert.equal((await db.query('SELECT * FROM public.lr_acrm_contactos')).rows.length,0);
await assert.rejects(action('reservar',3),/autorizada/);
await db.exec('RESET ROLE;SET ROLE anon;');
await assert.rejects(action('reservar',3),/permission denied/);
await db.exec('RESET ROLE;');
assert.equal((await db.query('SELECT * FROM public.lr_acrm_contacto_eventos')).rows.length,3);
console.log('PASS: canonical identity, assignment, stale version, duplicate reservation, actor ownership, immutable completion, RLS, anonymous denial, audit history.');
await db.close();


