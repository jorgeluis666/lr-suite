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
  '20261119093000_acrm_ads_library.sql', '20261123090000_acrm_hoja_texto.sql'
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

// Un perfil que ya estaba en el ACRM por su Connections.csv conserva su canal: su origen es el de verdad.
await db.exec(`RESET ROLE;
INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en) VALUES('li:https://www.linkedin.com/in/equis','linkedin','Equis',now());
SET ROLE authenticated;`);
const existente = await api.crearProspecto(cliente, {empresa: 'Otra', web: 'otra.pe', nombre: 'Equis Dos', linkedin: 'https://pe.linkedin.com/in/equis'});
assert.equal(existente.nuevo, false);
const vieja = await captura('li:https://www.linkedin.com/in/equis');
assert.deepEqual(plano([vieja.canal, vieja.nombre, vieja.empresa]), ['linkedin', 'Equis', 'Otra'],
  'canal y nombre se conservan; la hoja solo aporta lo que faltaba');

// Lo que no es un perfil de LinkedIn se rechaza antes de inventar una clave imposible de encontrar.
await assert.rejects(
  (async () => { const r = await cliente.rpc('lr_acrm_prospecto', {p_datos: {empresa: 'X', web: 'x.pe', linkedin: 'https://x.pe/perfil'}}); if (r.error) throw new Error(r.error.message); })(),
  /linkedin\.com\/in/
);
const r = await cliente.rpc('lr_acrm_prospecto', {p_datos: {nombre: 'Nadie'}});
assert.match(r.error.message, /dominio o el nombre de la empresa/, 'sin empresa ni dominio no hay alta');

// El marcador cuenta el nuevo canal: si no, los prospectos de la hoja no saldrían en ninguna fila.
const marcador = (await db.query(`SELECT public.lr_acrm_marcador(date_trunc('month',now())::date) AS m`)).rows[0].m;
assert.deepEqual(plano(marcador.canales.map((c) => c.canal)), ['ads_library', 'directo', 'linkedin', 'meta_whatsapp']);
assert.equal(marcador.canales.find((c) => c.canal === 'ads_library').sin_tocar, 4, 'los cuatro entraron sin tocar');

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
  ['Natura', 'natura.com.pe', 'Renzo Ibañez', 'Gerente de Marketing', '', '', 'Abrir perfil', '', '', '', '', '', 'https://pe.linkedin.com/in/renzo-ibanez/en']
]));
assert.deepEqual(plano(r1.columnas), ['cargo', 'empresa', 'linkedin', 'nombre', 'web'], 'las columnas que la hoja sí trae');
assert.deepEqual([r1.filas, r1.nuevos, r1.repetidos], [5, 5, 0], 'cinco prospectos: los títulos repetidos y la línea vacía no cuentan');
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

console.log('ok · prospectos de la hoja (Ads Library)');
