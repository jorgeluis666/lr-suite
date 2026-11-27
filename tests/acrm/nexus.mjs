// Los leads que trae Nexus: el tablero de demostración y la auditoría de Google Ads, los canales
// quinto y sexto del ACRM (20261127090000_acrm_nexus.sql). Corre contra las migraciones reales en
// PGlite, con el rol `anon`, que es con el que Nexus llama: lo que decide es la clave de ingesta.
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
-- La tabla de claves de alertas-gasto-correo.sql, que es donde vive la de esta ingesta.
CREATE TABLE public.lr_suite_notificaciones_claves(id text primary key, clave text NOT NULL);`);
for (const name of [
  '20261109083029_acrm_contacto_compartido.sql', '20261109084815_acrm_pacing_acciones.sql',
  '20261109090317_acrm_atribucion_orden_eventos.sql', '20261109213000_acrm_embudo_mensajes.sql',
  '20261110010000_acrm_cotizaciones.sql', '20261110020000_acrm_cotizaciones_campos.sql',
  '20261110070000_acrm_hitos.sql', '20261111100000_acrm_rubro_empresa_web.sql',
  '20261114110000_acrm_telefono.sql',
  '20261119093000_acrm_ads_library.sql', '20261123090000_acrm_hoja_texto.sql',
  '20261124150000_acrm_hoja_origen.sql', '20261124180000_acrm_perfil_publico.sql',
  '20261126120000_acrm_hoja_contacto.sql', '20261127090000_acrm_nexus.sql'
]) await db.exec(readFileSync('../../supabase/migrations/' + name, 'utf8'));

// Volver a aplicarla no puede romper nada ni cambiar la clave: se instala desde el SQL Editor y
// nadie se acuerda de si ya la corrió.
const clave = (await db.query(`SELECT clave FROM public.lr_suite_notificaciones_claves WHERE id='acrm-ingesta'`)).rows[0].clave;
await db.exec(readFileSync('../../supabase/migrations/20261127090000_acrm_nexus.sql', 'utf8'));
assert.equal((await db.query(`SELECT clave FROM public.lr_suite_notificaciones_claves WHERE id='acrm-ingesta'`)).rows[0].clave,
  clave, 'repetir la migración no cambia la clave de ingesta');
assert.equal(clave.length, 64, 'la clave son dos uuid sin guiones');

// Nexus llama con la clave publicable, igual que en la ingesta del gasto: el rol es anon.
await db.exec('RESET ROLE; SET ROLE anon;');
const llamar = (datos, k = clave) =>
  db.query('SELECT public.lr_acrm_captura_externa($1,$2) AS r', [k, JSON.stringify(datos)]).then((q) => q.rows[0].r);
// La lectura va sin rol: anon no lee la tabla (y eso se comprueba abajo), solo la escribe por la
// función con clave.
const captura = async (clave_) => {
  await db.exec('RESET ROLE;');
  const fila = (await db.query(
    `SELECT x.canal,x.nombre,x.correo,x.empresa,x.consulta,x.web,e.etapa
     FROM public.lr_acrm_capturas x JOIN public.lr_acrm_embudo e ON e.captura=x.clave WHERE x.clave=$1`, [clave_])).rows[0];
  await db.exec('SET ROLE anon;');
  return fila;
};
const contar = async (sql) => {
  await db.exec('RESET ROLE;');
  const n = (await db.query(sql)).rows[0].n;
  await db.exec('SET ROLE anon;');
  return n;
};

// ── La puerta ──────────────────────────────────────────────────────────────
await assert.rejects(llamar({origen: 'demo', nombre: 'Ana', correo: 'ana@example.test'}, 'no-es-la-clave'),
  /clave no valida/, 'sin la clave no entra nada');
await assert.rejects(llamar({origen: 'demo', nombre: 'Ana', correo: 'ana@example.test'}, null),
  /clave no valida/, 'y una clave vacía tampoco');
assert.equal(await contar('SELECT count(*)::int AS n FROM public.lr_acrm_capturas'), 0,
  'la llamada rechazada no deja nada escrito');
// La tabla sigue cerrada: lo que abre es la función, no el rol.
await assert.rejects(db.exec(`INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en) VALUES('x','directo','X',now())`),
  /permission denied/, 'anon no escribe la tabla por su cuenta');

// ── Lo que valida ──────────────────────────────────────────────────────────
await assert.rejects(llamar({origen: 'otro', correo: 'ana@example.test'}), /origen tiene que ser/);
await assert.rejects(llamar({origen: 'demo', correo: 'sin-arroba'}), /tiene que traer un correo/);
await assert.rejects(llamar({origen: 'demo', nombre: 'Ana'}), /tiene que traer un correo/);

// ── El alta del demo ───────────────────────────────────────────────────────
const demo = await llamar({origen: 'demo', nombre: '  Ana   Torres ', correo: 'ANA@Example.test',
  consulta: 'Entró al tablero de demostración (/demo).'});
assert.deepEqual([demo.ok, demo.clave, demo.canal, demo.nuevo], [true, 'nx:ana@example.test', 'nexus_demo', true]);
assert.deepEqual(await captura('nx:ana@example.test'), {
  canal: 'nexus_demo', nombre: 'Ana Torres', correo: 'ana@example.test', empresa: '', web: '',
  consulta: 'Entró al tablero de demostración (/demo).', etapa: 'nuevo'
}, 'el lead entra en «Sin tocar», con el correo en minúsculas y el nombre sin espacios de más');

// La misma visita otra vez no duplica la línea ni crea otro lead.
const otraVez = await llamar({origen: 'demo', nombre: 'Ana Torres', correo: 'ana@example.test',
  consulta: 'Entró al tablero de demostración (/demo).'});
assert.deepEqual([otraVez.clave, otraVez.nuevo], ['nx:ana@example.test', false]);
assert.equal((await captura('nx:ana@example.test')).consulta, 'Entró al tablero de demostración (/demo).',
  'la misma consulta no se repite en la ficha');

// Y si después pide la auditoría, es el mismo lead: su origen no cambia y la visita nueva se añade.
await llamar({origen: 'auditoria', nombre: 'Ana Torres', correo: 'ana@example.test',
  empresa: 'Tienda de Ana', consulta: 'Pidió la auditoría de Google Ads.'});
const dosVisitas = await captura('nx:ana@example.test');
assert.equal(dosVisitas.canal, 'nexus_demo', 'el canal de un lead que ya existía no se toca');
assert.equal(dosVisitas.empresa, 'Tienda de Ana', 'los huecos sí se rellenan');
assert.equal(dosVisitas.consulta, 'Entró al tablero de demostración (/demo).\nPidió la auditoría de Google Ads.',
  'la segunda visita se lee en otra línea');
assert.equal(await contar('SELECT count(*)::int AS n FROM public.lr_acrm_capturas'), 1,
  'una persona, un lead');

// ── El alta de la auditoría, y lo que no se pisa ───────────────────────────
const audit = await llamar({origen: 'auditoria', nombre: 'Beto Ruiz', correo: 'beto@example.test',
  empresa: 'Cuenta de Beto', web: 'beto.pe', consulta: 'Pidió la auditoría de Google Ads.'});
assert.deepEqual([audit.clave, audit.canal, audit.nuevo], ['nx:beto@example.test', 'nexus_auditoria', true]);
assert.equal((await captura('nx:beto@example.test')).web, 'https://beto.pe', 'la web se guarda completa');
await db.exec(`RESET ROLE; UPDATE public.lr_acrm_capturas SET nombre='Beto Ruiz Pérez', empresa='Lo que escribió el equipo' WHERE clave='nx:beto@example.test'; SET ROLE anon;`);
await llamar({origen: 'auditoria', nombre: 'Beto', correo: 'beto@example.test', empresa: 'Cuenta de Beto'});
const corregido = await captura('nx:beto@example.test');
assert.deepEqual([corregido.nombre, corregido.empresa], ['Beto Ruiz Pérez', 'Lo que escribió el equipo'],
  'lo que alguien corrigió a mano manda sobre lo que trae Nexus');

// ── Quien ya estaba en el ACRM por otro canal ──────────────────────────────
// La hoja de prospección trae correo desde 20261126120000: si ese correo pide la auditoría, es el
// mismo lead y conserva su origen, en vez de aparecer dos veces en la tabla maestra.
await db.exec(`RESET ROLE;
INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en,correo,empresa)
VALUES('ads:carla.pe','ads_library','Carla Díaz',now()-interval '10 days','carla@example.test','Carla SAC');
SET ROLE anon;`);
const conocida = await llamar({origen: 'auditoria', nombre: 'Carla Díaz', correo: 'carla@example.test',
  consulta: 'Pidió la auditoría de Google Ads.'});
assert.deepEqual([conocida.clave, conocida.canal, conocida.nuevo], ['ads:carla.pe', 'ads_library', false],
  'el lead que ya estaba no se duplica y conserva su origen');
assert.equal((await captura('ads:carla.pe')).consulta, 'Pidió la auditoría de Google Ads.');
assert.equal(await contar(`SELECT count(*)::int AS n FROM public.lr_acrm_capturas WHERE clave LIKE 'nx:%'`), 2);

// ── El marcador cuenta los seis canales ────────────────────────────────────
await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${uid(1)}',false); SET ROLE authenticated;`);
const marcador = (await db.query(`SELECT public.lr_acrm_marcador(date_trunc('month',now())::date) AS r`)).rows[0].r;
assert.deepEqual(marcador.canales.map((c) => c.canal).sort(),
  ['ads_library', 'directo', 'linkedin', 'meta_whatsapp', 'nexus_auditoria', 'nexus_demo'],
  'los dos canales nuevos tienen su fila en el marcador del mes');
assert.equal(marcador.canales.find((c) => c.canal === 'nexus_demo').sin_tocar, 1);

console.log('PASS: clave de ingesta, validación, alta del demo y de la auditoría, una persona un lead, lo corregido a mano, el lead que ya estaba y el marcador de seis canales.');
await db.close();
