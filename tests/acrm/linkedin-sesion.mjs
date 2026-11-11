// Acompañar la navegación de LinkedIn (el panel «Acompañar en LinkedIn» del ACRM): la operación que
// Claude in Chrome usa por cada mensaje que ve enviado —«a este perfil le envié este texto»— contra
// las migraciones reales.
//
// Lo que se puede romper sin ruido:
//   · Que registrar un envío no cierre la reserva: el primer contacto quedaría sin dueño y otra
//     persona le escribiría a la misma.
//   · Que el segundo mensaje al mismo perfil intente reservar otra vez y falle (los seguimientos).
//   · Que registre un perfil que tiene reservado otro compañero, o uno que no está en el ACRM.
//   · Que el mensaje quede sin autor: entonces no cuenta en la racha del marcador.
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const dom = new JSDOM('', {runScripts: 'outside-only', url: 'https://example.test'});
dom.window.eval(readFileSync('../../src/modules/prospeccion/acrm-leads.js', 'utf8'));
const api = dom.window.LRACRMLeads;

const db = new PGlite();
const uid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const PERFIL = 'https://www.linkedin.com/in/equis-1';
const AJENO = 'https://www.linkedin.com/in/ajeno-2';
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
CREATE TABLE public.lr_suite_private_data(key text primary key, payload jsonb);`);
for (const name of [
  '20261109083029_acrm_contacto_compartido.sql', '20261109084815_acrm_pacing_acciones.sql',
  '20261109090317_acrm_atribucion_orden_eventos.sql', '20261109213000_acrm_embudo_mensajes.sql',
  '20261110010000_acrm_cotizaciones.sql', '20261110020000_acrm_cotizaciones_campos.sql',
  '20261110070000_acrm_hitos.sql'
]) await db.exec(readFileSync('../../supabase/migrations/' + name, 'utf8'));
await db.exec(`INSERT INTO public.lr_pros_contactos_propios VALUES
  ('${uid(1)}','${PERFIL}','Equis','',now()),('${uid(1)}','${AJENO}','Ajeno','',now())`);
// Las migraciones ya incorporan las capturas de la base compartida: aquí solo se les pone nombre.
await db.exec(`INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en) VALUES
  ('li:${PERFIL}','linkedin','Equis Uno',now()),('li:${AJENO}','linkedin','Ajeno Dos',now())
  ON CONFLICT(clave) DO UPDATE SET nombre=excluded.nombre`);
// El primer contacto que reparte el marcador: la cola de la persona que tiene la sesión abierta.
await db.exec(`INSERT INTO public.lr_acrm_acciones(captura,responsable,accion,vence_en,tipo)
  VALUES('li:${PERFIL}','${uid(1)}','Enviar primer mensaje por LinkedIn',now(),'primer_contacto')`);
await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid(1)}',false);SET ROLE authenticated;`);
const comoYo = () => db.exec(`SELECT set_config('request.jwt.claim.sub','${uid(1)}',false)`);
const comoDiego = () => db.exec(`SELECT set_config('request.jwt.claim.sub','${uid(2)}',false)`);

// El cliente: PostgREST no está, así que las cuatro lecturas que hace este archivo se traducen a SQL
// (incluidas sus incrustaciones) y las escrituras van por las RPC reales.
const cliente = (quien) => ({
  auth: {getUser: async () => ({data: {user: {id: quien}}})},
  from(tabla) {
    const ops = [];
    const eq = (columna) => ops.find((o) => o[0] === 'eq' && o[1] === columna)?.[2];
    const resolver = async (uno) => {
      try {
        if (tabla === 'lr_acrm_embudo') {
          const r = await db.query(`SELECT e.captura,e.etapa,e.version,e.cotizacion,e.monto,e.actualizado_en,to_jsonb(c) AS cap
            FROM public.lr_acrm_embudo e JOIN public.lr_acrm_capturas c ON c.clave=e.captura WHERE e.captura=$1`, [eq('captura')]);
          const fila = r.rows[0] ? {...r.rows[0], lr_acrm_capturas: r.rows[0].cap} : null;
          return {data: uno ? fila : fila ? [fila] : [], error: null};
        }
        if (tabla === 'lr_acrm_contactos') {
          const dentro = ops.find((o) => o[0] === 'in');
          const r = dentro
            ? await db.query('SELECT * FROM public.lr_acrm_contactos WHERE linkedin_url = ANY($1)', [dentro[2]])
            : await db.query('SELECT * FROM public.lr_acrm_contactos WHERE linkedin_url=$1', [eq('linkedin_url')]);
          return {data: uno ? r.rows[0] || null : r.rows, error: null};
        }
        if (tabla === 'lr_acrm_acciones') {
          const r = await db.query(`SELECT a.id,a.captura,a.accion,a.vence_en,a.mensaje,jsonb_build_object('nombre',c.nombre) AS cap
            FROM public.lr_acrm_acciones a JOIN public.lr_acrm_capturas c ON c.clave=a.captura
            WHERE a.estado=$1 AND a.tipo=$2 AND a.responsable=$3 ORDER BY a.vence_en`,
            [eq('estado'), eq('tipo'), eq('responsable')]);
          return {data: r.rows.map((f) => ({...f, lr_acrm_capturas: f.cap})), error: null};
        }
        throw new Error('consulta no prevista: ' + tabla);
      } catch (error) { return {data: null, error: {message: error.message}}; }
    };
    const q = new Proxy({}, {get: (_, op) => {
      if (op === 'maybeSingle') return () => resolver(true);
      if (op === 'then') return (ok, mal) => resolver(false).then(ok, mal);
      return (...args) => { ops.push([op, ...args]); return q; };
    }});
    return q;
  },
  async rpc(nombre, args) {
    try {
      if (nombre === 'lr_acrm_contactar') {
        const r = await db.query('SELECT public.lr_acrm_contactar($1,$2,$3,$4) AS r', [args.p_url, args.p_accion, args.p_responsable, args.p_version]);
        return {data: r.rows[0].r, error: null};
      }
      assert.equal(nombre, 'lr_acrm_operar');
      const r = await db.query('SELECT public.lr_acrm_operar($1,$2) AS r', [args.p_accion, JSON.stringify(args.p_datos)]);
      return {data: r.rows[0].r, error: null};
    } catch (error) { return {data: null, error: {message: error.message}}; }
  }
});
const yo = cliente(uid(1));
const mensajes = async (captura) => (await db.query(`SELECT count(*)::int n FROM public.lr_acrm_mensajes WHERE captura=$1`, [captura])).rows[0].n;
const reserva = async (url) => (await db.query(`SELECT estado,responsable,contactado_por FROM public.lr_acrm_contactos WHERE linkedin_url=$1`, [url])).rows[0] || null;

// ── Lo que no se registra ──────────────────────────────────────────────────
await assert.rejects(api.registrarEnvioLinkedin(yo, {url: 'https://www.linkedin.com/messaging/thread/2-abc', mensaje: 'Hola'}), /perfil de LinkedIn/,
  'la URL de la conversación no identifica a nadie');
await assert.rejects(api.registrarEnvioLinkedin(yo, {url: PERFIL, mensaje: ' '}), /texto del mensaje/,
  'sin el texto no hay nada que dejar en el hilo');
await assert.rejects(api.registrarEnvioLinkedin(yo, {url: 'https://www.linkedin.com/in/nadie-aqui', mensaje: 'Hola'}), /Connections\.csv/,
  'un perfil que no está en el ACRM se avisa, no se inventa');

// ── El primer contacto: una sola llamada deja todo ─────────────────────────
const r1 = await api.registrarEnvioLinkedin(yo, {url: 'https://pe.linkedin.com/in/Equis-1/?originalSubdomain=pe#x', mensaje: 'Hola Equis, vi tu trabajo en retail…'});
assert.deepEqual([r1.captura, r1.nombre, r1.primerContacto], ['li:' + PERFIL, 'Equis Uno', true], 'la URL se normaliza igual que la base y es el primer contacto');
assert.deepEqual(await reserva(PERFIL), {estado: 'contactado', responsable: uid(1), contactado_por: uid(1)}, 'la reserva queda cerrada a nombre de quien registró');
assert.equal((await db.query(`SELECT etapa FROM public.lr_acrm_embudo WHERE captura=$1`, ['li:' + PERFIL])).rows[0].etapa, 'contactado', 'y el lead sale de «Sin tocar»');
const guardado = (await db.query(`SELECT texto,direccion,autor IS NOT NULL AS con_autor FROM public.lr_acrm_mensajes WHERE captura=$1`, ['li:' + PERFIL])).rows;
assert.deepEqual(guardado, [{texto: 'Hola Equis, vi tu trabajo en retail…', direccion: 'enviado', con_autor: true}],
  'el texto exacto queda en el hilo como enviado y con autor (cuenta en la racha)');
assert.equal((await db.query(`SELECT estado FROM public.lr_acrm_acciones WHERE captura=$1 AND tipo='primer_contacto'`, ['li:' + PERFIL])).rows[0].estado, 'hecha',
  'y el hito «Enviar primer mensaje por LinkedIn» se cierra solo');

// ── El segundo mensaje al mismo perfil es seguimiento ──────────────────────
const r2 = await api.registrarEnvioLinkedin(yo, {url: PERFIL, mensaje: 'Te comparto un caso parecido al tuyo.'});
assert.equal(r2.primerContacto, false, 'con la reserva ya cerrada no se vuelve a reservar');
assert.equal(await mensajes('li:' + PERFIL), 2, 'el seguimiento también queda en el hilo');

// ── Un perfil que tiene otro compañero no se toca ──────────────────────────
await comoDiego();
await api.contactar(cliente(uid(2)), {linkedin: AJENO}, 'reservar', {version: 0});
await comoYo();
await assert.rejects(api.registrarEnvioLinkedin(yo, {url: AJENO, mensaje: 'Hola Ajeno'}), /Otra persona/, 'reservado por otra persona: no se registra');
assert.equal(await mensajes('li:' + AJENO), 0, 'y no deja nada a medias en su hilo');
assert.equal((await reserva(AJENO)).responsable, uid(2), 'ni le quita la reserva');

// ── La cola que ve el panel ────────────────────────────────────────────────
await db.exec(`RESET ROLE;INSERT INTO public.lr_acrm_acciones(captura,responsable,accion,vence_en,tipo)
  VALUES('li:${AJENO}','${uid(1)}','Enviar primer mensaje por LinkedIn',now(),'primer_contacto');SET ROLE authenticated;`);
const cola = await api.colaLinkedin(yo, {limite: 10});
assert.deepEqual(cola.map((p) => [p.url, p.nombre, p.estado, p.mia]), [[AJENO, 'Ajeno Dos', 'reservado', false]],
  'la cola son mis primeros contactos pendientes, con el estado de su reserva; el ya contactado salió');

// ── El panel, tal como lo dibuja el index.html ─────────────────────────────
// Lo que Claude in Chrome lee en pantalla: la cola, los dos campos y la línea de cada envío. Si el
// nombre que viene de la base pudiera inyectar HTML, lo haría aquí.
const html = readFileSync('../../index.html', 'utf8');
function extraer(nombre) {
  const inicio = html.indexOf(`function ${nombre}(`);
  assert.notEqual(inicio, -1, `no se encontró ${nombre}`);
  let i = html.indexOf('{', inicio), nivel = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') nivel++;
    else if (html[i] === '}' && --nivel === 0) break;
  }
  return html.slice(inicio, i + 1);
}
assert.match(html, /id="acrmLinkedinBoton"[^>]*>[^<]*Acompañar en LinkedIn/, 'el botón está en la barra de la tabla');
assert.match(html, /<div class="panel" id="acrmLinkedinPanel" hidden><\/div>/, 'y su panel, en la página del ACRM');

const pantalla = new JSDOM('<main><div id="acrmLinkedinPanel" hidden></div></main>', {url: 'https://suite.limaretail.com/'});
const contexto = vm.createContext({
  window: pantalla.window, document: pantalla.window.document, location: pantalla.window.location,
  escapeHtml: (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])),
  fmtNumber: (n) => String(n),
  ACRM_ICONOS: {copiar: '<svg class="svg-icon"></svg>', linkedin: '<svg class="svg-icon"></svg>'},
  acrmIco: (icono, titulo, atributos = '') => `<button title="${titulo}" ${atributos}></button>`,
  acrmLeadAviso: () => {}, getSuiteAccessSession: () => null, ensureSharedPendingClient: () => null,
  acrmLeads: {abierto: ''}, acrmLeadsCargar: async () => {}, acrmLeadAbrir: async () => {}
});
vm.runInContext(`const acrmLinkedin={abierto:true,cola:null,error:"",registros:[],verInstrucciones:false,trabajando:false};
${['acrmLinkedinInstrucciones', 'acrmLinkedinColaHtml', 'acrmLinkedinBitacoraHtml', 'acrmLinkedinPanelHtml', 'acrmLinkedinPintar'].map(extraer).join('\n')}
globalThis.estado=acrmLinkedin;`, contexto);

contexto.acrmLinkedinPintar();
const panel = pantalla.window.document.getElementById('acrmLinkedinPanel');
assert.equal(panel.hidden, false);
assert.match(panel.textContent, /Acompañar en LinkedIn con Claude in Chrome/);
assert.ok(panel.querySelector('#acrmLinkedinForm [name="url"]'), 'el campo de la URL del perfil');
assert.ok(panel.querySelector('#acrmLinkedinForm [name="mensaje"]'), 'el campo del mensaje enviado');
assert.match(panel.textContent, /Cargando tu cola/);

contexto.estado.cola = [{url: 'https://www.linkedin.com/in/ana-perez', nombre: '<b>Ana</b> Pérez', estado: 'reservado', mia: true}];
contexto.estado.registros = [
  {hora: '09:12', nombre: 'Ana Pérez', url: 'https://www.linkedin.com/in/ana-perez', tipo: 'primero', detalle: 'Hola Ana, vi tu trabajo…'},
  {hora: '09:20', nombre: '', url: 'https://www.linkedin.com/in/otro', tipo: 'error', detalle: 'Otra persona tiene reservado este perfil.'}
];
contexto.estado.verInstrucciones = true;
contexto.acrmLinkedinPintar();
assert.doesNotMatch(panel.innerHTML, /<b>Ana<\/b>/, 'el nombre que viene de la base no inyecta HTML');
assert.match(panel.textContent, /Reservado/);
assert.match(panel.textContent, /Primer contacto/);
assert.match(panel.textContent, /No se registró/, 'un envío que falló se ve como tal');
assert.match(panel.textContent, /1 envío \(1 primer contacto\)/, 'y la cuenta solo suma los que entraron');
const instrucciones = contexto.acrmLinkedinInstrucciones();
assert.match(instrucciones, /https:\/\/www\.linkedin\.com\/in\/ana-perez/, 'la cola viaja dentro de las instrucciones');
assert.match(instrucciones, /suite\.limaretail\.com/, 'con la dirección de LR Suite que está abierta');
assert.match(instrucciones, /Nunca escribes ni envías nada en LinkedIn/, 'y la regla de que Claude solo mira');

contexto.estado.abierto = false;
contexto.acrmLinkedinPintar();
assert.deepEqual([panel.hidden, panel.innerHTML], [true, ''], 'cerrar no deja el panel a medias');

console.log('PASS acompañar en LinkedIn: URL de perfil exigida, perfil fuera del ACRM avisado, primer contacto con reserva cerrada, atribución, embudo y hito, el texto exacto en el hilo con autor, el segundo mensaje como seguimiento, el perfil de otro compañero intacto, la cola de primeros contactos pendientes, y el panel con sus dos campos, su registro por envío y lo de la base escapado.');
pantalla.window.close();
dom.window.close();
await db.close();
