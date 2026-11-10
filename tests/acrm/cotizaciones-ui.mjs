// La pantalla de Cotizaciones ya no escribe el bloque JSON: lee y guarda lr_acrm_cotizaciones por
// acrm-cotizaciones.js. Esto prueba ese puente contra las migraciones de verdad, con un cliente
// que imita a Supabase: que la traducción ida y vuelta no cambie nada, que cada botón llegue a la
// base con los datos que la RPC acepta, y que importar no borre lo que el archivo no trae.
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
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
INSERT INTO public.lr_suite_private_data VALUES('quotes', $q$[
 {"id":"cot-01","cliente":"Oskar Valle","contacto":"Oskar","telefono":"+51 949 037 970","emailContacto":"o@valle.pe",
  "servicio":"Gestión Google Ads","montoCotizado":650,"fechaEnvio":"2026-11-01","estado":"Enviada","contactosRealizados":2,
  "desglose":[{"concepto":"Setup","monto":150},{"concepto":"Gestión","monto":500}]},
 {"id":"cot-02","cliente":"Juris Group","servicio":"Auditoría Google","montoCotizado":450,
  "montoFacturado":450,"fechaEnvio":"2026-10-20","estado":"Aprobado","contactosRealizados":3},
 {"id":"cot-03","cliente":"Sin fecha","servicio":"Meta Ads","montoCotizado":900,"fechaEnvio":"","estado":"En revisión"}
]$q$::jsonb);`);
for (const name of [
  '20261109083029_acrm_contacto_compartido.sql',
  '20261109084815_acrm_pacing_acciones.sql',
  '20261109090317_acrm_atribucion_orden_eventos.sql',
  '20261109213000_acrm_embudo_mensajes.sql',
  '20261110010000_acrm_cotizaciones.sql',
  '20261110020000_acrm_cotizaciones_campos.sql'
]) await db.exec(readFileSync('../../supabase/migrations/' + name, 'utf8'));
// Un lead de WhatsApp que pidió precio: su cotización tiene que quedar colgada de él.
await db.exec(`INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en) VALUES('wa:111:51987654321','meta_whatsapp','Ana Lead',now())`);
await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid(1)}',false);SET ROLE authenticated;`);

const fila = async (sql, params = []) => (await db.query(sql, params)).rows;
const cot = async (id) => (await fila('SELECT * FROM public.lr_acrm_cotizaciones WHERE id=$1', [id]))[0];
const emb = async (clave) => (await fila('SELECT etapa,cotizacion,monto FROM public.lr_acrm_embudo WHERE captura=$1', [clave]))[0];

// Lo justo de supabase-js: la lectura como la devuelve PostgREST (JSON, fechas en texto) y la RPC.
let rpcs = 0;
const client = {
  from(table) {
    assert.equal(table, 'lr_acrm_cotizaciones', 'el puente solo lee la tabla nueva, nunca el bloque JSON');
    const filtro = {};
    const q = {select() { return q; }, order() { return q; }, limit() { return q; },
      eq(col, val) { filtro[col] = val; return q; },
      maybeSingle() { q.uno = true; return q; },
      then(resolve, reject) {
        const donde = filtro.id ? 'WHERE id=$1' : '';
        db.query(`SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY enviada DESC NULLS LAST),'[]') AS d FROM public.lr_acrm_cotizaciones q ${donde}`, filtro.id ? [filtro.id] : [])
          .then((r) => resolve({data: q.uno ? (r.rows[0].d[0] || null) : r.rows[0].d, error: null}), reject);
      }};
    return q;
  },
  sinMigracion: false,
  async rpc(name, args) {
    rpcs++;
    if (name === 'lr_acrm_cotizaciones_guardar') {
      if (this.sinMigracion) return {data: null, error: {code: 'PGRST202', message: 'Could not find the function public.lr_acrm_cotizaciones_guardar'}};
      assert.equal(args.p_items.length, 1, 'se guarda una sola cotización por llamada, nunca la lista');
      try {
        const r = await db.query('SELECT public.lr_acrm_cotizaciones_guardar($1) AS r', [JSON.stringify(args.p_items)]);
        return {data: r.rows[0].r, error: null};
      } catch (error) { return {data: null, error: {message: error.message}}; }
    }
    assert.equal(name, 'lr_acrm_operar');
    try {
      const r = await db.query('SELECT public.lr_acrm_operar($1,$2) AS r', [args.p_accion, JSON.stringify(args.p_datos)]);
      return {data: r.rows[0].r, error: null};
    } catch (error) { return {data: null, error: {message: error.message}}; }
  }
};

const dom = new JSDOM('', {runScripts: 'outside-only', url: 'https://example.test'});
dom.window.eval(readFileSync('../../src/modules/prospeccion/acrm-cotizaciones.js', 'utf8'));
const api = dom.window.LRACRMCotizaciones;

// ── Lectura: el formato de siempre ─────────────────────────────────────────
let lista = await api.cargar(client);
const por = (id) => lista.find((q) => q.id === id);
assert.equal(lista.length, 3);
assert.equal(por('cot-01').montoCotizado, 650);
assert.equal(por('cot-01').fechaEnvio, '2026-11-01');
assert.equal(por('cot-01').emailContacto, 'o@valle.pe');
assert.equal(por('cot-01').contactosRealizados, 2, 'los toques llegan con el nombre que usa la pantalla');
assert.equal(por('cot-02').estado, 'Aprobado');
assert.equal(por('cot-03').estado, 'En revisión');
assert.equal(por('cot-03').fechaEnvio, '', 'sin fecha llega vacía, no como «null»');
assert.equal(por('cot-01').captura, 'co:cot-01');

// ── Ida y vuelta sin cambios ───────────────────────────────────────────────
// Guardar una cotización tal como se leyó no puede mover ningún dato. La de sin fecha es la que
// se rompía: '' no es una fecha para la base.
const antes = await fila('SELECT id,cliente,contacto,telefono,email,servicio,monto::text,facturado::text,estado,enviada::text,contactos_hechos,desglose FROM public.lr_acrm_cotizaciones ORDER BY id');
for (const q of lista) await api.guardar(client, q);
const despues = await fila('SELECT id,cliente,contacto,telefono,email,servicio,monto::text,facturado::text,estado,enviada::text,contactos_hechos,desglose FROM public.lr_acrm_cotizaciones ORDER BY id');
assert.deepEqual(despues, antes, 'leer y volver a guardar no cambia nada');
assert.equal((await emb('co:cot-02')).etapa, 'ganado', 'y una ganada no retrocede a «cotizado»');

// ── Los botones de la tabla ────────────────────────────────────────────────
await api.guardar(client, {...por('cot-01'), estado: 'Perdido'});
assert.equal((await cot('cot-01')).estado, 'perdida', '«Perdido» existe en la base y se traduce');
assert.equal((await emb('co:cot-01')).etapa, 'perdido');
assert.equal((await fila("SELECT count(*)::int n FROM public.lr_acrm_acciones WHERE captura='co:cot-01' AND estado='pendiente'"))[0].n, 0,
  'una perdida no deja seguimiento en la cola');

await api.toque(client, 'cot-03', 5);
assert.equal((await cot('cot-03')).contactos_hechos, 5, 'los puntos de contactabilidad van por su propia operación');
await api.toque(client, 'cot-03', 99);
assert.equal((await cot('cot-03')).contactos_hechos, 8, 'y no pasan de ocho');

// Dos cambios seguidos a la misma cotización llegan en orden: gana el último.
await Promise.all([
  api.guardar(client, {...por('cot-02'), gastos: 10}),
  api.guardar(client, {...por('cot-02'), gastos: 20})
]);
assert.equal(Number((await cot('cot-02')).gastos), 20);

// ── Cotizar a un lead del ACRM ─────────────────────────────────────────────
const id = api.nuevoId();
assert.match(id, /^[A-Za-z0-9_.:-]+$/, 'el id cabe en el alfabeto del importador');
await api.guardar(client, {id, captura: 'wa:111:51987654321', cliente: 'Ana Lead', telefono: '+51987654321',
  servicio: 'Meta Ads', montoCotizado: '1200.5', fechaEnvio: '2026-11-09', estado: 'Enviado'});
assert.equal((await cot(id)).captura, 'wa:111:51987654321', 'queda colgada del lead, no de un prospecto directo nuevo');
assert.equal((await fila(`SELECT count(*)::int n FROM public.lr_acrm_capturas WHERE clave='co:${id}'`))[0].n, 0);
assert.deepEqual({...(await emb('wa:111:51987654321')), monto: Number((await emb('wa:111:51987654321')).monto)},
  {etapa: 'cotizado', cotizacion: id, monto: 1200.5}, 'y el lead pasa a «cotizado» con su monto');

// ── Importar ───────────────────────────────────────────────────────────────
lista = await api.cargar(client);
const {cambios, nuevas, actualizadas, intactas} = api.fusionar(lista, [
  // Un archivo viejo sin teléfono ni toques: no puede borrarlos.
  {id: 'cot-02', servicio: 'Auditoría Google', cliente: 'Juris Group SAC', montoCotizado: 480},
  {id: 'cot-05', servicio: 'Google Ads', cliente: 'Nueva SA', montoCotizado: 300, fechaEnvio: '2026-11-08', contactosRealizados: 1},
  {id: 'cot-06', servicio: 'Google Ads', cliente: 'Demasiado', montoCotizado: 1e9}
], {contacto: '', telefono: '', montoCotizado: 0, estado: 'Enviada', fechaEnvio: ''});
assert.deepEqual([nuevas, actualizadas, intactas], [2, 1, 3]);
const avances = [];
const {hechas, fallidas} = await api.importar(client, cambios, (n, total) => avances.push(`${n}/${total}`));
assert.equal(hechas, 2);
assert.deepEqual([...fallidas].map((f) => f.id), ['cot-06'], 'la fila imposible se informa y no detiene a las demás');
assert.deepEqual(avances, ['1/3', '2/3', '3/3']);
assert.equal((await cot('cot-02')).cliente, 'Juris Group SAC');
assert.equal(Number((await cot('cot-02')).monto), 480);
assert.equal((await cot('cot-02')).contactos_hechos, 3, 'sin la columna, los toques se conservan');
assert.equal((await cot('cot-02')).estado, 'aprobada', 'y el estado también');
assert.equal((await cot('cot-05')).contactos_hechos, 1, 'con la columna, se aplican');
assert.equal((await fila("SELECT canal FROM public.lr_acrm_capturas WHERE clave='co:cot-05'"))[0].canal, 'directo');

assert.equal(api.estadoBase('Aprobada'), 'aprobada');
assert.equal(api.estadoBase('En negociación'), 'revision');
assert.equal(api.estadoBase('Rechazada'), 'perdida');
assert.equal(api.estadoBase(''), 'enviada');

// ── Lo que trajo 20261110020000 ────────────────────────────────────────────
lista = await api.cargar(client);
await api.guardar(client, {...por('cot-02'), servicioEstandar: 'Google Ads'});
assert.equal((await cot('cot-02')).servicio_estandar, 'Google Ads', 'el servicio estándar se guarda en su campo');
assert.equal((await cot('cot-02')).servicio, 'Auditoría Google', 'sin pisar el texto original');
// La cola avanza un toque mientras la pantalla tiene la cotización abierta con el dato viejo.
const viejo = por('cot-05');
await api.toque(client, 'cot-05', 4);
await api.guardar(client, {...viejo, gastos: 15});
assert.equal((await cot('cot-05')).contactos_hechos, 4, 'guardar con el dato viejo no deshace el toque de la cola');
assert.equal(Number((await cot('cot-05')).gastos), 15);
// Sin la migración, cae a la operación de una fila que ya existía.
client.sinMigracion = true;
await api.guardar(client, {...por('cot-02'), gastos: 33});
assert.equal(Number((await cot('cot-02')).gastos), 33, 'sin la RPC nueva, guarda igual por la operación vieja');
client.sinMigracion = false;

// Sin permisos, el error vuelve al que llamó para decirlo en pantalla.
await db.exec(`RESET ROLE;SELECT set_config('request.jwt.claim.sub','${uid(9)}',false);SET ROLE authenticated;`);
await assert.rejects(api.guardar(client, por('cot-03')), /autorizada/);

assert.ok(rpcs > 0);
console.log('PASS cotizaciones-ui: la pantalla lee la tabla nueva, ida y vuelta sin cambios (también sin fecha), «Perdido» detiene el seguimiento, los toques van aparte y en orden, cotizar a un lead lo une a él, importar no borra lo que el archivo no trae, el servicio estándar tiene su campo, guardar con datos viejos no deshace los toques de la cola, y sin la migración nueva cae a la operación de una fila.');
dom.window.close();
await db.close();
