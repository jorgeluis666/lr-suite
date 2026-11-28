// Los prospectos de la hoja de prospección (origen «Ads Library»): que las filas pegadas se lean por
// el título de su columna y que el alta deje en la base lo que la pantalla promete —un lead en «Sin
// tocar» con su empresa, su dominio y su cargo, sin duplicar lo que ya estaba ni pisar lo que alguien
// corrigió a mano—. El parser corre en el navegador simulado; el alta, contra las migraciones reales
// en PGlite.
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const dom = new JSDOM('', {runScripts: 'outside-only', url: 'https://example.test'});
dom.window.eval(readFileSync('../../src/modules/prospeccion/acrm-leads.js', 'utf8'));
const api = dom.window.LRACRMLeads;
const plano = (v) => JSON.parse(JSON.stringify(v));

assert.equal(api.CANALES.ads_library, 'Ads Library', 'el cuarto origen tiene nombre en la tabla');

// ── Leer las filas pegadas ─────────────────────────────────────────────────
// La cabecera es la de la hoja, con sus once columnas: las que no dicen nada del prospecto se
// ignoran, y «Búsqueda LinkedIn» no es el perfil.
const cabecera = ['Empresa', 'Dominio clave', 'Nombre público', 'Cargo publicado', 'Alcance del cargo buscado o identificado',
  'Estado de verificación', 'Perfil LinkedIn', 'Fuente del cargo', 'Última consulta', 'Búsqueda LinkedIn', 'Otro cargo de interés'].join('\t');
const fila = (c) => c.join('\t');
const pegado = [
  cabecera,
  fila(['Defontana', 'defontana.com', 'Rigoberto Caballero', 'Country Manager, Perú', 'Perú', 'Perfil identificado',
    'https://pe.linkedin.com/in/rigoberto-caballero-892b6a22/', 'Ver fuente', '19/11/2026',
    'https://www.linkedin.com/search/results/people/?keywords=x', 'Gerencia de marketing']),
  // La hoja copia el texto del enlace, no su URL: el prospecto entra igual, sin LinkedIn.
  fila(['Regus', 'regus.com', 'Demian Agostinelli', 'Country Manager de IWG', 'Chile y Perú', 'Validar perfil',
    'Abrir perfil', 'Ver fuente', '19/11/2026', 'Buscar persona', 'Gerencia comercial']),
  cabecera, // pegar dos trozos de la hoja repite los títulos: no es un prospecto
  fila(['', '', '', 'Jefatura de e-commerce']), // sin empresa ni dominio no hay a quién dar de alta
  fila(['Viale', 'viale.pe', '', '', 'Perú', 'Por identificar'])
].join('\n');

const leido = api.prospectosDeTexto(pegado);
assert.equal(leido.filas.length, 3, 'tres prospectos: la cabecera repetida y la fila vacía no cuentan');
assert.deepEqual(plano(leido.campos), ['empresa', 'web', 'nombre', 'cargo', 'linkedin'], 'solo los títulos reconocidos');
assert.deepEqual(
  plano(leido.filas[0]),
  {empresa: 'Defontana', web: 'defontana.com', nombre: 'Rigoberto Caballero', cargo: 'Country Manager, Perú',
   linkedin: 'https://www.linkedin.com/in/rigoberto-caballero-892b6a22', rubro: '', pregunta: '',
   consulta: 'Country Manager, Perú'},
  'el perfil se normaliza como lo guarda la base y el cargo queda como consulta'
);
assert.equal(leido.filas[1].linkedin, '', '«Abrir perfil» no es una URL de perfil');
assert.ok(leido.avisos.some((a) => /no la URL del perfil/.test(a)), 'y se avisa de cuántas filas entran sin LinkedIn');
assert.ok(leido.avisos.some((a) => /Sin empresa ni dominio/.test(a)));
assert.equal(leido.filas[2].nombre, '', 'una empresa sin responsable identificado también es un prospecto');

// El rubro y la pregunta comercial llegan cuando la hoja los trae, en cualquier orden de columnas.
const conRubro = api.prospectosDeTexto(['Rubro\tPregunta comercial\tEmpresa\tDominio clave',
  'Moda y calzado\t¿Cómo evalúan sus ventas por categoría?\tViale\tviale.pe'].join('\n'));
assert.deepEqual(
  plano([conRubro.filas[0].rubro, conRubro.filas[0].consulta]),
  ['Moda y calzado', '¿Cómo evalúan sus ventas por categoría?'],
  'las columnas se leen por su título, no por su posición'
);
// Cuando la hoja trae las dos columnas del perfil, manda la del URL: el texto de «Perfil LinkedIn»
// es «Abrir perfil» porque la celda es un =HYPERLINK.
const dosPerfiles = api.prospectosDeTexto(['Empresa\tDominio clave\tNombre público\tPerfil LinkedIn\tURL del perfil',
  'Hilti\thilti.com.pe\tRicardo Poveda\tAbrir perfil\thttps://pe.linkedin.com/in/rps123'].join('\n'));
assert.equal(dosPerfiles.filas[0].linkedin, 'https://www.linkedin.com/in/rps123', 'gana la columna del URL, esté antes o después');
// Un perfil copiado en otro idioma es la misma persona: se recorta el idioma en vez de rechazarlo.
assert.equal(api.perfilLinkedin('https://pe.linkedin.com/in/renzo-ibanez/en'), 'https://www.linkedin.com/in/renzo-ibanez');
assert.equal(api.perfilLinkedin('https://pe.linkedin.com/in/jgdd/es'), 'https://www.linkedin.com/in/jgdd');
assert.equal(api.perfilLinkedin('https://www.linkedin.com/company/lima-retail'), '', 'una empresa no es un perfil');
// El identificador interno de LinkedIn (sale al copiar el enlace desde Sales Navigator) pasa por una
// URL de perfil pero distingue mayúsculas, y acá todo se guarda en minúsculas: el enlace llevaría al
// 404. Cinco leads entraron así el 23/11/2026 (migración 20261124180000).
assert.equal(api.perfilLinkedin('https://www.linkedin.com/in/ACoAAA3yVp8BbqSEikaismzu1neoNQl5-05kL5s'), '',
  'el identificador interno de LinkedIn no es la dirección pública de nadie');
assert.equal(api.perfilLinkedin('https://pe.linkedin.com/in/acoaaahkyd8biy3d9l4qqzaz6co5w4vwwzjethi'), '',
  'tampoco en minúsculas ni con el país delante');
assert.deepEqual(plano(dosPerfiles.avisos), [], 'y entonces no se avisa de ningún perfil perdido');
assert.deepEqual(plano(api.prospectosDeTexto('').filas), []);
assert.ok(api.prospectosDeTexto('Defontana\tdefontana.com').avisos[0].includes('fila de títulos'), 'sin títulos no se adivina nada');

// ── El alta, contra la base ────────────────────────────────────────────────
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
  '20261110010000_acrm_cotizaciones.sql', '20261110020000_acrm_cotizaciones_campos.sql',
  '20261110070000_acrm_hitos.sql', '20261111100000_acrm_rubro_empresa_web.sql',
  '20261114110000_acrm_telefono.sql',
  '20261119093000_acrm_ads_library.sql', '20261123090000_acrm_hoja_texto.sql',
  '20261124150000_acrm_hoja_origen.sql', '20261124180000_acrm_perfil_publico.sql',
  '20261126120000_acrm_hoja_contacto.sql', '20261127140000_acrm_clave_estable.sql',
  '20261128060000_acrm_clave_persona.sql'
]) await db.exec(readFileSync('../../supabase/migrations/' + name, 'utf8'));
await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid(1)}',false);SET ROLE authenticated;`);

const cliente = {async rpc(nombre, args) {
  assert.equal(nombre, 'lr_acrm_prospecto');
  try {
    const q = await db.query('SELECT public.lr_acrm_prospecto($1) AS r', [JSON.stringify(args.p_datos)]);
    return {data: q.rows[0].r, error: null};
  } catch (error) { return {data: null, error: {message: error.message}}; }
}};
const captura = async (clave) => (await db.query(
  `SELECT x.canal,x.nombre,x.empresa,x.rubro,x.web,x.consulta,e.etapa
   FROM public.lr_acrm_capturas x JOIN public.lr_acrm_embudo e ON e.captura=x.clave WHERE x.clave=$1`, [clave])).rows[0];

// Con perfil: la clave es la del canal LinkedIn, para que la ficha enseñe su enlace y un
// Connections.csv posterior no lo duplique.
const conPerfil = await api.crearProspecto(cliente, {...leido.filas[0], rubro: 'Software empresarial'});
assert.deepEqual(plano([conPerfil.clave, conPerfil.nuevo]), ['li:https://www.linkedin.com/in/rigoberto-caballero-892b6a22', true]);
assert.deepEqual(plano(await captura(conPerfil.clave)), {
  canal: 'ads_library', nombre: 'Rigoberto Caballero', empresa: 'Defontana', rubro: 'Software empresarial',
  web: 'https://defontana.com', consulta: 'Country Manager, Perú', etapa: 'nuevo'
}, 'el lead entra en «Sin tocar» con sus datos de calificación y la web completa');

// Sin perfil: el prospecto es la persona de esa empresa; sin persona, la empresa.
const sinPerfil = await api.crearProspecto(cliente, leido.filas[1]);
assert.equal(sinPerfil.clave, 'ads:regus.com-demian-agostinelli');
const empresaSola = await api.crearProspecto(cliente, leido.filas[2]);
assert.equal(empresaSola.clave, 'ads:viale.pe');
assert.equal((await captura('ads:viale.pe')).nombre, 'Viale', 'sin responsable identificado, el prospecto es la empresa');

// La semana en que la hoja identifica a la persona, ese mismo lead pasa a ser ella: no se queda un
// duplicado a nombre de la empresa en «Sin tocar».
const ascendido = await api.crearProspecto(cliente, {empresa: 'Viale', web: 'viale.pe', nombre: 'Quien Sea', cargo: 'Jefa de e-commerce'});
assert.deepEqual(plano([ascendido.clave, ascendido.nuevo]), ['ads:viale.pe', false]);
assert.equal((await captura('ads:viale.pe')).nombre, 'Quien Sea', 'el prospecto de la empresa se convierte en la persona');
// Y una segunda persona de la misma empresa es otro prospecto, no un reemplazo de la primera.
const segunda = await api.crearProspecto(cliente, {empresa: 'Viale', web: 'viale.pe', nombre: 'Otra Persona'});
assert.deepEqual(plano([segunda.clave, segunda.nuevo]), ['ads:viale.pe-otra-persona', true]);
assert.equal((await captura('ads:viale.pe')).nombre, 'Quien Sea', 'y la primera sigue siendo la primera');

// Volver a cargar la hoja no duplica ni pisa lo que alguien corrigió en la tabla: solo rellena huecos.
await db.exec(`SELECT public.lr_acrm_datos('{"captura":"ads:viale.pe","rubro":"Moda y calzado","empresa":"Viale Perú","web":"https://viale.pe"}'::jsonb)`);
const otraVez = await api.crearProspecto(cliente, {...leido.filas[2], rubro: 'Calzado', empresa: 'Viale'});
assert.equal(otraVez.nuevo, false, 'el que ya estaba no se estrena de nuevo');
assert.deepEqual(
  plano([(await captura('ads:viale.pe')).rubro, (await captura('ads:viale.pe')).empresa]),
  ['Moda y calzado', 'Viale Perú'],
  'lo escrito a mano manda sobre lo que trae la hoja'
);
assert.equal((await db.query(`SELECT count(*)::int n FROM public.lr_acrm_capturas`)).rows[0].n, 4,
  'cuatro leads de seis altas: dos eran el mismo prospecto');

// Un perfil que ya estaba en el ACRM por su Connections.csv pasa a ser un prospecto de la hoja
// (20261124150000): comparten la clave «li:<url>», y lo que explica por qué está en la lista es la
// hoja, no la agenda de alguien. El nombre con el que se le conoce no se toca.
await db.exec(`RESET ROLE;
INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en) VALUES('li:https://www.linkedin.com/in/equis','linkedin','Equis',now());
SET ROLE authenticated;`);
const existente = await api.crearProspecto(cliente, {empresa: 'Otra', web: 'otra.pe', nombre: 'Equis Dos', linkedin: 'https://pe.linkedin.com/in/equis'});
assert.equal(existente.nuevo, false);
const vieja = await captura('li:https://www.linkedin.com/in/equis');
assert.deepEqual(plano([vieja.canal, vieja.nombre, vieja.empresa]), ['ads_library', 'Equis Dos', 'Otra'],
  'el origen pasa a Ads Library y la hoja aporta lo que faltaba');
// «Equis Dos» es «Equis» completo: desde 20261128060000 el nombre corto cede ante el mismo nombre
// con más palabras. Uno distinto, o más corto, sigue sin tocarse (se comprueba al final).

// Pero a quien escribió por WhatsApp no lo reescribe: ese origen es un hecho de la conversación.
await db.exec(`RESET ROLE;
INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en) VALUES('li:https://www.linkedin.com/in/zeta','meta_whatsapp','Zeta',now());
SET ROLE authenticated;`);
await api.crearProspecto(cliente, {empresa: 'Otra Más', web: 'otramas.pe', nombre: 'Zeta', linkedin: 'https://pe.linkedin.com/in/zeta'});
assert.equal((await captura('li:https://www.linkedin.com/in/zeta')).canal, 'meta_whatsapp',
  'el lead que llegó por WhatsApp conserva su origen aunque esté en la hoja');

// Lo que no es un perfil de LinkedIn se rechaza antes de inventar una clave imposible de encontrar.
await assert.rejects(
  (async () => { const r = await cliente.rpc('lr_acrm_prospecto', {p_datos: {empresa: 'X', web: 'x.pe', linkedin: 'https://x.pe/perfil'}}); if (r.error) throw new Error(r.error.message); })(),
  /linkedin\.com\/in/
);
const r = await cliente.rpc('lr_acrm_prospecto', {p_datos: {nombre: 'Nadie'}});
assert.match(r.error.message, /un tel[eé]fono o un correo/, 'sin nada con lo que llamar a nadie no hay alta');
// El navegador ya vacía el id interno, pero la base es la que manda: pegado directo, lo rechaza
// diciendo qué hace falta, en vez de guardar un lead con el enlace roto (20261124180000).
const rId = await cliente.rpc('lr_acrm_prospecto', {p_datos: {empresa: 'Zeta', web: 'zeta.pe', nombre: 'Alguien',
  linkedin: 'https://www.linkedin.com/in/acoaaa3yvp8bbqseikaismzu1neonql5-05kl5s'}});
assert.match(rId.error.message, /identificador interno de LinkedIn/, 'el id interno no entra ni por la RPC');

// El marcador cuenta el nuevo canal: si no, los prospectos de la hoja no saldrían en ninguna fila.
const marcador = (await db.query(`SELECT public.lr_acrm_marcador(date_trunc('month',now())::date) AS m`)).rows[0].m;
assert.deepEqual(plano(marcador.canales.map((c) => c.canal)), ['ads_library', 'directo', 'linkedin', 'meta_whatsapp']);
assert.equal(marcador.canales.find((c) => c.canal === 'ads_library').sin_tocar, 5,
  'los cuatro de la hoja más el que venía del Connections.csv, todos sin tocar');

// ── La hoja entera, en una llamada (20261123090000) ────────────────────────
// Lo que recibe la función es el TSV de la pestaña Contactos tal como lo exporta Google: trece
// columnas, de las que solo siete dicen algo del prospecto. «Perfil LinkedIn» es un =HYPERLINK y su
// texto exportado es «Abrir perfil»; el enlace de verdad viaja en «URL del perfil», que la propia
// hoja calcula con una fórmula.
const titulos = ['Empresa', 'Dominio clave', 'Nombre público', 'Cargo publicado',
  'Alcance del cargo buscado o identificado', 'Estado de verificación', 'Perfil LinkedIn',
  'Fuente del cargo', 'Última consulta', 'Búsqueda LinkedIn', 'Otro cargo de interés', '', 'URL del perfil'];
const tsv = (filas) => [titulos, ...filas].map((f) => f.join('\t')).join('\n');
// La función de la hoja no es para el navegador: la llama el barrido, que corre sin usuario. Por eso
// está revocada para «authenticated» y acá se invoca con el rol del dueño, como lo hará pg_cron.
const hoja = async (texto) => {
  await db.exec('RESET ROLE');
  try {
    return (await db.query('SELECT private.lr_acrm_prospecto_hoja($1) AS r', [texto])).rows[0].r;
  } finally {
    await db.exec('SET ROLE authenticated');
  }
};
await assert.rejects(
  db.query('SELECT private.lr_acrm_prospecto_hoja($1) AS r', ['Empresa\nX']),
  /permission denied/, 'una cuenta del equipo no puede llamar al barrido'
);

const r1 = await hoja(tsv([
  ['Hilti', 'hilti.com.pe', 'Ricardo Poveda', 'Gerente general de Hilti Perú', 'Operación peruana',
   'Perfil identificado', 'Abrir perfil', 'Ver fuente del cargo', '19/11/2026', 'Buscar en LinkedIn',
   'Gerencia comercial', '', 'https://pe.linkedin.com/in/rps123/'],
  // Sin perfil público: el prospecto es la persona de esa empresa.
  ['Atlas Copco', 'atlascopco.com', 'Julio Hernández', 'Gerente general', 'Operación peruana',
   'Validar perfil', '', 'Ver fuente del cargo', '19/11/2026', 'Buscar en LinkedIn', 'Gerencia comercial', '', ''],
  titulos, // dos trozos de la hoja pegados: la segunda fila de títulos no es un prospecto
  [], // una línea en blanco tampoco
  ['Promart', 'promart.pe', '', '', 'Operación peruana', 'Por identificar', '', '', '', '', '', '', ''],
  // Un enlace que no es de LinkedIn se rechaza y no detiene a las demás.
  ['Rota', 'rota.pe', 'Quien Sea', 'Gerente', '', '', 'Abrir perfil', '', '', '', '', '', 'https://rota.pe/equipo/quien'],
  // Un perfil copiado en otro idioma: la misma persona, con el idioma detrás.
  ['Natura', 'natura.com.pe', 'Renzo Ibañez', 'Gerente de Marketing', '', '', 'Abrir perfil', '', '', '', '', '', 'https://pe.linkedin.com/in/renzo-ibanez/en'],
  // El identificador interno de LinkedIn no abre el perfil de nadie: el prospecto entra sin él, como
  // con «Abrir perfil», en vez de quedarse fuera o nacer con un enlace al 404 (20261124180000).
  ['Lukers', 'lukers.pe', 'Javier Perez', 'Gerente general', '', '', 'Abrir perfil', '', '', '', '', '',
   'https://www.linkedin.com/in/ACoAAAnffwkBnZ6kJrvhXhXv8heun0rmeCn_j1I']
]));
assert.deepEqual(plano(r1.columnas), ['cargo', 'empresa', 'linkedin', 'nombre', 'web'], 'las columnas que la hoja sí trae');
assert.deepEqual([r1.filas, r1.nuevos, r1.repetidos], [6, 6, 0], 'seis prospectos: los títulos repetidos y la línea vacía no cuentan');
assert.equal((await captura('ads:lukers.pe-javier-perez')).nombre, 'Javier Perez',
  'el del id interno entra por su empresa y sin perfil, no como error');
assert.deepEqual(plano(r1.errores), [], 'un enlace que no es de LinkedIn no es un error: el prospecto entra sin perfil');
// El URL de la columna de fórmula manda sobre el texto «Abrir perfil» de la columna del enlace.
assert.deepEqual(plano(await captura('li:https://www.linkedin.com/in/rps123')), {
  canal: 'ads_library', nombre: 'Ricardo Poveda', empresa: 'Hilti', rubro: '', web: 'https://hilti.com.pe',
  consulta: 'Gerente general de Hilti Perú', etapa: 'nuevo'
}, 'el perfil se normaliza y el cargo queda como consulta');
assert.equal((await captura('ads:atlascopco.com-julio-hernandez')).nombre, 'Julio Hernández');
assert.equal((await captura('ads:promart.pe')).nombre, 'Promart', 'una empresa sin responsable entra a su nombre');
assert.equal((await captura('ads:rota.pe-quien-sea')).nombre, 'Quien Sea', 'y el que traía un enlace ajeno entra sin perfil');
assert.equal((await captura('li:https://www.linkedin.com/in/renzo-ibanez')).nombre, 'Renzo Ibañez', 'el perfil con idioma detrás se recorta y entra');

// Volver a pasar la misma hoja no duplica nada.
const r2 = await hoja(tsv([
  ['Hilti', 'hilti.com.pe', 'Ricardo Poveda', 'Gerente general de Hilti Perú', '', '', 'Abrir perfil', '', '', '', '', '', 'https://pe.linkedin.com/in/rps123/'],
  ['Atlas Copco', 'atlascopco.com', 'Julio Hernández', 'Gerente general', '', '', '', '', '', '', '', '', '']
]));
assert.deepEqual([r2.filas, r2.nuevos, r2.repetidos], [2, 0, 2], 'la segunda pasada no estrena leads');

// La pregunta comercial de la pestaña Empresas, cuando la hoja la trae, se suma al cargo.
const r3 = await hoja(['Empresa\tDominio\tNombre\tCargo\tRubro\tPregunta comercial',
  'Modasa\tmodasa.com.pe\tEmma Añazgo\tJefe de Marketing\tMaquinaria industrial\t¿Qué búsquedas generan cotizaciones?'].join('\n'));
assert.deepEqual([r3.filas, r3.nuevos], [1, 1]);
const modasa = await captura('ads:modasa.com.pe-emma-anazgo');
assert.deepEqual(plano([modasa.rubro, modasa.consulta]),
  ['Maquinaria industrial', 'Jefe de Marketing · ¿Qué búsquedas generan cotizaciones?']);

// Un texto sin fila de títulos no se adivina: se rechaza entero antes de escribir nada.
await assert.rejects(hoja('Defontana\tdefontana.com\tRigoberto\n'), /fila de títulos/);

// El estado que lee la pantalla: sin barrido todavía, dice que la hoja no está configurada.
await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid(1)}',false)`);
const estado = (await db.query('SELECT public.lr_pros_hoja_estado() AS r')).rows[0].r;
assert.deepEqual(plano([estado.configurada, estado.filas]), [false, 0]);

// ── Origen, teléfono y correo de la hoja (20261126120000) ──────────────────
// Desde el 26-11-2026 la pestaña Contactos trae dos listas y lo dice por fila, en su columna
// «Origen»: las empresas de la Biblioteca de Anuncios y 1.325 contactos del CRM de Tierra Films, que
// casi nunca traen dominio y nunca perfil, pero sí un número o un correo.
const contacto = async (clave) => (await db.query(
  `SELECT canal,nombre,empresa,telefono,correo FROM public.lr_acrm_capturas WHERE clave=$1`, [clave])).rows[0];
const titulos2 = ['Empresa', 'Dominio clave', 'Nombre público', 'Cargo publicado',
  'Alcance del cargo buscado o identificado', 'Estado de verificación', 'Perfil LinkedIn',
  'Fuente del cargo', 'Última consulta', 'Búsqueda LinkedIn', 'Otro cargo de interés', '',
  'URL del perfil', 'Contactado por', 'Fecha de contacto', 'Origen', 'Correo', 'Teléfono'];
const tsv2 = (filas) => [titulos2, ...filas].map((f) => f.join('\t')).join('\n');
const dir = (c) => { const f = Array(18).fill(''); for (const i in c) f[i] = c[i]; return f; };

const rD = await hoja(tsv2([
  // Una empresa de verdad con su persona, su correo y su número: el caso normal de esas 1.325.
  dir({0: 'MAPFRE', 1: 'mapfre.com.pe', 2: 'Lorena Gonzales', 3: 'Compras', 7: 'CRM Tierra Films',
       15: 'Directo', 16: 'dgonzalesq@mapfre.com.pe', 17: '945 056 598'}),
  // Sin empresa ni dominio ni nombre: lo único que hay es el número, y eso lo identifica. Antes de
  // esta migración la fila se saltaba por no tener empresa.
  dir({5: 'Por identificar', 7: 'CRM Tierra Films', 15: 'Directo', 17: '954 358 483'}),
  // Ni número: solo el correo.
  dir({5: 'Por identificar', 7: 'CRM Tierra Films', 15: 'Directo', 16: 'Alguien@Empresa.COM'}),
  // Un número de fuera de Perú entra con su código de país, sin que se le pegue el 51.
  dir({2: 'Thomas Schwegler', 7: 'CRM Tierra Films', 15: 'Directo', 17: '+41 78 215 55 55'}),
  // La misma fila, pero de Ads Library: su origen sigue siendo el de siempre.
  dir({0: 'Niubiz', 1: 'niubiz.com.pe', 2: 'Miguel Saldaña', 15: 'Ads Library'}),
  // Un teléfono que no deja un número usable no tira el contacto: entra sin él.
  dir({0: 'Footloose', 1: 'footloose.pe', 2: 'Maggie Sime', 15: 'Directo', 17: '12'}),
  // Y un correo con forma de nada, igual.
  dir({0: 'Drimer', 1: 'drimer.pe', 2: 'Jonathan Flores', 15: 'Directo', 16: 'sin arroba'})
]));
assert.deepEqual(plano(rD.columnas), ['cargo', 'correo', 'empresa', 'linkedin', 'nombre', 'origen', 'telefono', 'web'],
  'la hoja trae tres columnas más que antes');
assert.deepEqual([rD.filas, rD.nuevos], [7, 7], 'las siete entran, incluidas las que solo traen un número o un correo');
assert.deepEqual(plano(rD.canales), {directo: 6, ads_library: 1}, 'el recuento por origen es lo que dice la hoja');

assert.deepEqual(plano(await contacto('ads:mapfre.com.pe-lorena-gonzales')), {
  canal: 'directo', nombre: 'Lorena Gonzales', empresa: 'MAPFRE',
  telefono: '51945056598', correo: 'dgonzalesq@mapfre.com.pe'
}, 'el contacto directo entra con su canal, su número con el 51 y su correo');
// El número se guarda igual que lo guarda la ficha, así que claveWhatsapp() le arma su wa:0:<número>
// y la conversación del bot enciende sola.
assert.equal(api.claveWhatsapp('ads:mapfre.com.pe-lorena-gonzales', '51945056598'), 'wa:0:51945056598');

const soloNumero = await contacto('ads:tel-51954358483');
assert.deepEqual(plano([soloNumero.canal, soloNumero.nombre, soloNumero.telefono]),
  ['directo', '954 358 483', '51954358483'],
  'a quien solo trae un número se le conoce por el número tal como lo escribe la hoja');
const soloCorreo = await contacto('ads:correo-alguien-empresa-com');
assert.deepEqual(plano([soloCorreo.nombre, soloCorreo.correo]), ['alguien@empresa.com', 'alguien@empresa.com'],
  'y el correo entra en minúsculas, que es como se compara');
assert.equal((await contacto('ads:tel-41782155555-thomas-schwegler')).telefono, '41782155555',
  'a un número de fuera no se le pega el 51');
assert.equal((await contacto('ads:niubiz.com.pe-miguel-saldana')).canal, 'ads_library',
  'la fila de Ads Library no cambia de origen por compartir pestaña');
assert.deepEqual(plano([(await contacto('ads:footloose.pe-maggie-sime')).telefono,
  (await contacto('ads:drimer.pe-jonathan-flores')).correo]), ['', ''],
  'un número o un correo ilegibles se descartan, pero el contacto entra');
assert.deepEqual(plano(rD.errores), [], 'y ninguna de las siete da error');

// Volver a traer la hoja no duplica ni pisa: el que ya tiene número se queda con el suyo.
await db.exec(`SELECT public.lr_acrm_datos('{"captura":"ads:tel-51954358483","telefono":"999 888 777","correo":"a@b.pe"}'::jsonb)`);
const rD2 = await hoja(tsv2([
  dir({5: 'Por identificar', 7: 'CRM Tierra Films', 15: 'Directo', 17: '954 358 483'})
]));
assert.deepEqual([rD2.filas, rD2.nuevos, rD2.repetidos], [1, 0, 1]);
assert.deepEqual(plano(await contacto('ads:tel-51954358483')),
  {canal: 'directo', nombre: '954 358 483', empresa: '', telefono: '51999888777', correo: 'a@b.pe'},
  'lo escrito a mano manda sobre lo que trae la hoja, igual que el rubro y la empresa');

// La semana en que la hoja le pone nombre a un número suelto, ese mismo lead pasa a ser la persona:
// no queda un duplicado a nombre del número.
const conNombre = await hoja(tsv2([
  dir({2: 'Anita Guerrero', 7: 'CRM Tierra Films', 15: 'Directo', 17: '980 958 692'})
]));
assert.equal(conNombre.nuevos, 1);
const antes = await contacto('ads:tel-51980958692');
assert.equal(antes, undefined, 'con nombre desde el principio la clave ya lleva su nombre');
assert.equal((await contacto('ads:tel-51980958692-anita-guerrero')).nombre, 'Anita Guerrero');

// Lo escrito a mano se valida: un correo que no es una dirección se rechaza y el que había se queda.
await assert.rejects(
  db.query(`SELECT public.lr_acrm_datos('{"captura":"ads:tel-51954358483","correo":"sin arroba"}'::jsonb)`),
  /Correo inv[áa]lido/, 'la ficha no guarda cualquier cosa como correo'
);
assert.equal((await contacto('ads:tel-51954358483')).correo, 'a@b.pe', 'y el que estaba sigue ahí');

// El canal se lee del origen, no de la pestaña: lo que la hoja no reconoce es de Ads Library, que es
// lo que hacía el barrido antes de tener columna Origen (y lo que sigue siendo para lo pegado a mano).
for (const [origen, canal] of [['Directo', 'directo'], ['directo', 'directo'], ['DIRECTO', 'directo'],
  ['Ads Library', 'ads_library'], ['', 'ads_library'], ['Lo que sea', 'ads_library'],
  ['LinkedIn', 'linkedin'], ['WhatsApp', 'meta_whatsapp']]) {
  const v = (await db.query('SELECT private.lr_pros_canal($1) AS c', [origen])).rows[0].c;
  assert.equal(v, canal, `«${origen}» es ${canal}`);
}

// ── La clave no se mueve cuando la hoja se llena (20261127140000) ──────────
// La pestaña Contactos es un documento que crece: el dominio de una empresa, o el número de alguien,
// aparecen semanas después de que su contacto entró. La clave se arma con el primero de esos datos
// que haya, así que llenar una columna cambiaba la clave y el barrido daba de alta a la misma persona
// otra vez. Pasó de verdad: 609 filas ganaron «Dominio clave» de un día para otro.
const web = async (clave) => (await db.query(
  `SELECT web FROM public.lr_acrm_capturas WHERE clave=$1`, [clave])).rows[0]?.web;

const sinDominio = dir({0: 'A La Pepa S.A.C.', 2: 'Carla Zuñiga', 3: 'Jefa de Marketing',
  7: 'CRM Tierra Films', 15: 'Directo', 16: 'czuniga@alapepa.com'});
assert.equal((await hoja(tsv2([sinDominio]))).nuevos, 1);
assert.equal((await contacto('ads:a-la-pepa-s-a-c-carla-zuniga')).nombre, 'Carla Zuñiga',
  'sin dominio, la clave la pone el nombre de la empresa');
// Alguien ya trabajó ese lead: le escribió el rubro desde la ficha.
await db.exec(`SELECT public.lr_acrm_datos('{"captura":"ads:a-la-pepa-s-a-c-carla-zuniga","rubro":"Restaurantes"}'::jsonb)`);

const conDominio = [...sinDominio]; conDominio[1] = 'alapepa.com';
const rE = await hoja(tsv2([conDominio]));
assert.deepEqual([rE.filas, rE.nuevos, rE.repetidos], [1, 0, 1],
  'con el dominio puesto es el mismo lead, no uno nuevo');
assert.equal(await contacto('ads:alapepa.com-carla-zuniga'), undefined, 'y no se abrió otro al lado');
assert.equal(await web('ads:a-la-pepa-s-a-c-carla-zuniga'), 'https://alapepa.com',
  'el dominio que faltaba entra en su ficha, que es para lo que hacía falta');
assert.equal((await db.query(
  `SELECT rubro FROM public.lr_acrm_capturas WHERE clave='ads:a-la-pepa-s-a-c-carla-zuniga'`)).rows[0].rubro,
  'Restaurantes', 'y lo que alguien escribió a mano sigue donde estaba');

// Lo mismo cuando lo único que había era el número y luego llegan la empresa y su dominio.
const soloTel = dir({2: 'Sofía Rivas', 7: 'CRM Tierra Films', 15: 'Directo', 17: '988 777 666'});
await hoja(tsv2([soloTel]));
const conEmpresa = [...soloTel]; conEmpresa[0] = 'Vega'; conEmpresa[1] = 'vega.pe';
const rF = await hoja(tsv2([conEmpresa]));
assert.deepEqual([rF.nuevos, rF.repetidos], [0, 1], 'el número sigue siendo quien la identifica');
assert.deepEqual(plano(await contacto('ads:tel-51988777666-sofia-rivas')),
  {canal: 'directo', nombre: 'Sofía Rivas', empresa: 'Vega', telefono: '51988777666', correo: ''});

// Pero una persona nueva de esa misma empresa es un lead propio: reutilizar no es fundir.
const rG = await hoja(tsv2([dir({0: 'Vega', 1: 'vega.pe', 2: 'Hugo León', 15: 'Directo'})]));
assert.equal(rG.nuevos, 1, 'otro contacto de Vega entra por su cuenta');
assert.equal((await contacto('ads:vega.pe-hugo-leon')).nombre, 'Hugo León');

// La fila sin nombre que el alta fundió con su persona (su rótulo ya no es provisional, es el nombre
// de ella) también se reconoce: pasó con Molitalia, donde una fila anónima con un número y otra con
// María José Asalde son el mismo lead desde el primer barrido.
await hoja(tsv2([
  dir({0: 'Molitalia', 5: 'Por identificar', 15: 'Directo', 17: '997 805 253'}),
  dir({0: 'Molitalia', 2: 'María José Asalde', 15: 'Directo', 16: 'masalde@molitalia.com.pe'})
]));
assert.equal((await contacto('ads:molitalia')).nombre, 'María José Asalde');
const rH = await hoja(tsv2([
  dir({0: 'Molitalia', 1: 'molitalia.com.pe', 2: 'María José Asalde', 15: 'Directo',
       16: 'masalde@molitalia.com.pe'})
]));
assert.deepEqual([rH.nuevos, rH.repetidos], [0, 1], 'sigue siendo el lead que ya estaba');
assert.equal(await contacto('ads:molitalia.com.pe-maria-jose-asalde'), undefined);

// Una fila anónima que trae un número, y después la persona de ese número: el alta las funde, así
// que el rótulo del lead ya es su nombre. Cuando la fila anónima sale de la hoja —porque era un
// duplicado y se borró—, la persona tiene que seguir siendo ese mismo lead.
await hoja(tsv2([dir({5: 'Por identificar', 15: 'Directo', 17: '977 718 976'})]));
await hoja(tsv2([dir({2: 'Denis Hilario', 15: 'Directo', 17: '977 718 976'})]));
assert.equal((await contacto('ads:tel-51977718976')).nombre, 'Denis Hilario', 'la fundió con ella');
const rJ = await hoja(tsv2([dir({2: 'Denis Hilario', 15: 'Directo', 17: '977 718 976'})]));
assert.deepEqual([rJ.nuevos, rJ.repetidos], [0, 1], 'y sin la anónima sigue siendo el mismo');
assert.equal(await contacto('ads:tel-51977718976-denis-hilario'), undefined,
  'no abre un lead nuevo con su nombre al lado del que ya era suyo');

// Y el canal separa: dos personas pueden compartir un número o un nombre de empresa, pero una fila
// de la hoja y lo guardado solo son el mismo lead si vienen del mismo sitio.
await hoja(tsv2([dir({0: 'Tienda', 2: 'Ana Paredes', 15: 'Ads Library'})]));
const rI = await hoja(tsv2([dir({0: 'Tienda', 1: 'tienda.pe', 2: 'Ana Paredes', 15: 'Directo'})]));
assert.equal(rI.nuevos, 1, 'el contacto directo no se mete en el lead de Ads Library');
assert.deepEqual(plano([(await contacto('ads:tienda-ana-paredes')).canal,
  (await contacto('ads:tienda.pe-ana-paredes')).canal]), ['ads_library', 'directo']);

// ── Ni cuando lo que se corrige es el nombre (20261128060000) ──────────────
// El nombre va dentro de la clave, así que completarlo en la hoja apuntaba a un lead que no existe y
// abría otro al lado. Se reconoce a la persona por su correo o su teléfono dentro de la misma
// empresa, y solo si los dos nombres comparten una palabra.
const nombreDe = async (clave) => (await db.query(
  `SELECT nombre FROM public.lr_acrm_capturas WHERE clave=$1`, [clave])).rows[0]?.nombre;

const corta = dir({0: 'UTP', 2: 'Pamela Aguilar', 15: 'Directo', 16: 'paguilar@utp.edu.pe'});
assert.equal((await hoja(tsv2([corta]))).nuevos, 1);
const larga = [...corta]; larga[2] = 'Pamela Isabel Aguilar Fernandez';
const rK = await hoja(tsv2([larga]));
assert.deepEqual([rK.nuevos, rK.repetidos], [0, 1], 'el nombre completo no abre otro lead');
assert.equal(await contacto('ads:utp-pamela-isabel-aguilar-fernandez'), undefined);
assert.equal(await nombreDe('ads:utp-pamela-aguilar'), 'Pamela Isabel Aguilar Fernandez',
  'y la ficha pasa a enseñar el nombre completo, que es el bueno');

// Por el teléfono y por el dominio, con la empresa escrita de otra manera.
await hoja(tsv2([dir({0: 'NTT DATA PERU', 1: 'nttdata.com', 2: 'Milagros Poma', 15: 'Directo',
  17: '937 562 517'})]));
const rL = await hoja(tsv2([dir({0: 'Ntt Data Perú', 1: 'nttdata.com',
  2: 'Milagros Madeleine Poma Ccuno', 15: 'Directo', 17: '937 562 517'})]));
assert.deepEqual([rL.nuevos, rL.repetidos], [0, 1], 'el mismo número y una palabra en común: es ella');
assert.equal(await nombreDe('ads:nttdata.com-milagros-poma'), 'Milagros Madeleine Poma Ccuno');

// Un nombre que alguien escribió a mano no se pisa con uno que dice menos.
await db.exec(`RESET ROLE;
UPDATE public.lr_acrm_capturas SET nombre='Pedro Gómez Salas'
  WHERE clave='ads:nttdata.com-milagros-poma';
SET ROLE authenticated;`);
await hoja(tsv2([dir({0: 'NTT DATA PERU', 1: 'nttdata.com', 2: 'Pedro Gómez', 15: 'Directo',
  17: '937 562 517'})]));
assert.equal(await nombreDe('ads:nttdata.com-milagros-poma'), 'Pedro Gómez Salas',
  'la hoja completa un nombre, no lo recorta');

// Dos personas distintas que comparten un número son dos leads: pasa con las centralitas y los
// móviles de oficina, y en el CRM de Tierra Films con dos empresas que comparten un WhatsApp.
await hoja(tsv2([dir({0: 'Digicorp', 1: 'digicorp.com.pe', 2: 'Ana Heredia', 15: 'Directo',
  17: '916 736 873'})]));
const rM = await hoja(tsv2([dir({0: 'GPON Internet', 1: 'gpon.pe', 2: 'Amderson Moscol',
  15: 'Directo', 17: '916 736 873'})]));
assert.equal(rM.nuevos, 1, 'dos nombres sin nada en común no se funden aunque compartan el número');

// Y un buzón genérico de la misma empresa tampoco los funde.
await hoja(tsv2([dir({0: 'Mayorista', 1: 'mayorista.pe', 2: 'Lucía Prado', 15: 'Directo',
  16: 'ventas@mayorista.pe'})]));
const rN = await hoja(tsv2([dir({0: 'Mayorista', 1: 'mayorista.pe', 2: 'Jorge Cueva', 15: 'Directo',
  16: 'ventas@mayorista.pe'})]));
assert.equal(rN.nuevos, 1, 'el mismo correo con dos nombres distintos son dos personas');

// El límite: la misma persona en dos empresas distintas sigue siendo dos leads. Es la fila de
// Fiorella Otoya bajo «Bituper» y bajo «Otoya MH», que se resolvió mirándola, no con una regla.
await hoja(tsv2([dir({0: 'Otoya MH', 1: 'otoyaingenieros.pe', 2: 'Fiorella Otoya', 15: 'Directo',
  16: 'fotoya@otoyaingenieros.pe'})]));
const rO = await hoja(tsv2([dir({0: 'Bituper', 2: 'Fiorella Otoya', 15: 'Directo',
  16: 'fotoya@otoyaingenieros.pe'})]));
assert.equal(rO.nuevos, 1, 'sin la misma empresa ni el mismo dominio, el alta no decide por nadie');

console.log('ok · prospectos de la hoja (Ads Library y Directo)');
