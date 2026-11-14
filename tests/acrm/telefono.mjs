// El teléfono del lead (migración 20261114110000): la columna que le faltaba a la captura.
//
// Un lead de LinkedIn no tenía dónde guardar un número: el teléfono salía de la clave de la captura
// (solo los de WhatsApp) o de la cotización (solo los que llegaron a cotizar). Aquí se comprueba que
// la base lo guarde normalizado como el de la clave —solo dígitos, con el 51 de los celulares
// peruanos—, que no se pueda escribir cualquier cosa, que una pantalla vieja no lo borre, y que con
// el número puesto la ficha arme sola la clave con la que lee la conversación y el estado del bot.
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
CREATE TABLE public.lr_acrm_capturas(clave text PRIMARY KEY,canal text NOT NULL,nombre text NOT NULL,
 capturado_en timestamptz NOT NULL DEFAULT now(),consulta text NOT NULL DEFAULT '');
INSERT INTO public.lr_acrm_capturas(clave,canal,nombre) VALUES
 ('li:https://www.linkedin.com/in/sofia','linkedin','Sofía'),
 ('li:https://www.linkedin.com/in/aaron','linkedin','Aaron Vento');
GRANT SELECT ON public.lr_acrm_capturas TO authenticated;`);
// Las dos migraciones, en su orden: la segunda reemplaza la función de la primera para sumarle el
// cuarto campo, así que aplicarlas al revés no serviría.
await db.exec(readFileSync('../../supabase/migrations/20261111100000_acrm_rubro_empresa_web.sql', 'utf8'));
await db.exec(readFileSync('../../supabase/migrations/20261114110000_acrm_telefono.sql', 'utf8'));

const guardar = (datos) => db.query('SELECT public.lr_acrm_datos($1) AS r', [JSON.stringify(datos)]);
const leer = async (clave) => (await db.query('SELECT rubro,empresa,web,telefono FROM lr_acrm_capturas WHERE clave=$1', [clave])).rows[0];
const SOFIA = 'li:https://www.linkedin.com/in/sofia';

await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid(1)}',false); SET ROLE authenticated;`);

// El caso de todos los días: el número que dictó el lead, tal como lo escribe una persona.
await guardar({captura: SOFIA, rubro: 'Clínica dental', empresa: 'Dental Surco', web: 'dentalsurco.pe', telefono: '+51 987 654 321'});
assert.deepEqual(await leer(SOFIA),
  {rubro: 'Clínica dental', empresa: 'Dental Surco', web: 'https://dentalsurco.pe', telefono: '51987654321'},
  'el teléfono se guarda en dígitos y los otros tres siguen guardándose igual que antes');

// El mismo número escrito de las cuatro maneras de siempre es un solo número, no cuatro.
for (const escrito of ['987654321', '987-654-321', '(987) 654 321', '51987654321']) {
  await guardar({captura: SOFIA, telefono: escrito});
  assert.equal((await leer(SOFIA)).telefono, '51987654321', `«${escrito}» es el mismo número`);
}
// Un número de fuera de Perú se respeta: el 51 solo se añade a los nueve dígitos que empiezan en 9.
await guardar({captura: SOFIA, telefono: '+1 305 555 0199'});
assert.equal((await leer(SOFIA)).telefono, '13055550199');
// Un fijo de Lima (siete dígitos) también entra: no todo lead es un celular.
await guardar({captura: SOFIA, telefono: '4251234'});
assert.equal((await leer(SOFIA)).telefono, '4251234');

// Lo que no entra.
await assert.rejects(guardar({captura: SOFIA, telefono: '12'}), /Teléfono inválido/, 'un número a medias no se guarda');
await assert.rejects(guardar({captura: SOFIA, telefono: 'no tiene'}), /Teléfono inválido/, 'ni un texto sin dígitos');
assert.equal((await leer(SOFIA)).telefono, '4251234', 'y el que ya estaba sigue intacto');

// Vacío borra: es como se corrige un número equivocado.
await guardar({captura: SOFIA, telefono: ''});
assert.equal((await leer(SOFIA)).telefono, '');

// Una pantalla vieja en caché manda los tres campos de antes y ningún teléfono. No lo puede borrar:
// el navegador que no conoce la columna no decide por el que sí.
await guardar({captura: SOFIA, telefono: '987654321'});
await guardar({captura: SOFIA, rubro: 'Clínica dental', empresa: 'Dental Surco', web: 'https://dentalsurco.pe'});
assert.equal((await leer(SOFIA)).telefono, '51987654321', 'sin la clave, el número que ya estaba se queda');

// La tabla se defiende sola de lo que no pase por la función.
await db.exec('RESET ROLE;');
await assert.rejects(db.exec(`UPDATE public.lr_acrm_capturas SET telefono='+51 987' WHERE clave='${SOFIA}'`),
  /telefono_formato/, 'la columna solo acepta dígitos');

// Quién puede escribirlo.
await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid(9)}',false); SET ROLE authenticated;`);
await assert.rejects(guardar({captura: SOFIA, telefono: '987654321'}), /autorizada/);
await db.exec('RESET ROLE; SET ROLE anon;');
await assert.rejects(guardar({captura: SOFIA, telefono: '987654321'}), /permission denied/);
await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${uid(1)}',false); SET ROLE authenticated;`);
await assert.rejects(guardar({captura: 'no-existe', telefono: '987654321'}), /no existe/);
await db.close();

// ── Lo que hace la ficha con ese número ────────────────────────────────────
const dom = new JSDOM('', {runScripts: 'outside-only', url: 'https://example.test'});
dom.window.eval(readFileSync('../../src/modules/prospeccion/acrm-leads.js', 'utf8'));
const api = dom.window.LRACRMLeads;

// Con el número puesto, un lead de LinkedIn tiene la misma clave de conversación que uno de
// WhatsApp: es lo único que hacía falta para que su ficha encienda el chat y el estado del bot.
assert.equal(api.claveWhatsapp(SOFIA, '+51 987 654 321'), 'wa:0:51987654321');
assert.equal(api.claveWhatsapp(SOFIA, ''), '', 'sin número no hay conversación que leer');
assert.equal(api.waDe('12'), '', 'lo que no es un número no arma una clave a medias');

// El teléfono guardado manda sobre el de la clave, que es el número desde el que escribió.
// Se lee por donde lo lee la ficha —uno()—, así que esto comprueba también que la lectura pida la
// columna nueva y que, si la base no la tuviera, se vuelva a pedir sin ella en vez de quedarse en
// blanco (42703 es lo que contesta PostgREST cuando falta una columna).
const clienteCon = (captura, telefono, {sinColumna = false} = {}) => {
  const pedidas = [];
  const cliente = {pedidas, from: (tabla) => {
    const q = {
      select: (columnas) => { if (tabla === 'lr_acrm_embudo') pedidas.push(columnas); return q; },
      eq: () => q, in: async () => ({data: []}),
      maybeSingle: async () => sinColumna && pedidas[pedidas.length - 1].includes(',telefono')
        ? {error: {code: '42703', message: 'column lr_acrm_capturas.telefono does not exist'}}
        : {data: {captura, etapa: 'nuevo', version: 1, lr_acrm_capturas: {clave: captura, canal: 'linkedin', nombre: 'Sofía', telefono}}}
    };
    return q;
  }};
  return cliente;
};
const leido = async (...args) => (await api.uno(clienteCon(...args)))?.telefono;
assert.equal(await leido(SOFIA, '51987654321'), '51987654321');
assert.equal(await leido(SOFIA, ''), '', 'un lead de LinkedIn sin número sigue sin número');
assert.equal(await leido('wa:999:51900000000', ''), '51900000000', 'el de WhatsApp sigue saliendo de su clave');
assert.equal(await leido('wa:999:51900000000', '51987654321'), '51987654321', 'y el escrito a mano lo corrige');
const sinMigracion = clienteCon(SOFIA, '', {sinColumna: true});
assert.equal((await api.uno(sinMigracion)).nombre, 'Sofía', 'sin la columna, la ficha se lee igual');
assert.ok(sinMigracion.pedidas.length > 1 && !sinMigracion.pedidas[sinMigracion.pedidas.length - 1].includes(',telefono'),
  'y la segunda lectura ya no la pide');

// Guardar un dato manda los cuatro campos con lo que el lead ya tiene: cambiar el teléfono no puede
// dejar en blanco el rubro, la empresa o la web.
let visto = null;
const cliente = (data) => ({rpc: async (_nombre, args) => { visto = args; return {data}; }});
const sofia = {captura: SOFIA, rubro: 'Clínica dental', empresa: 'Dental Surco', web: 'https://dentalsurco.pe', telefono: ''};
await api.guardarDatos(cliente({ok: true, telefono: '51987654321'}), sofia, {telefono: '51987654321'});
assert.deepEqual({...visto.p_datos}, {captura: SOFIA, rubro: 'Clínica dental', empresa: 'Dental Surco', web: 'https://dentalsurco.pe', telefono: '51987654321'});

// Contra la función anterior —que ignora las claves que no conoce— el número se perdería en
// silencio: se dice qué migración falta, como con los hitos y con «Sin tocar».
await assert.rejects(api.guardarDatos(cliente({ok: true}), sofia, {telefono: '51987654321'}), /20261114110000/);
// Sin tocar el teléfono, la pantalla sigue funcionando contra la función anterior.
await api.guardarDatos(cliente({ok: true}), sofia, {rubro: 'Dental'});
dom.window.close();

console.log('PASS teléfono: la captura guarda el número normalizado como el de la clave, rechaza lo que no es un número, no lo pierde con una pantalla vieja ni fuera de la función, y con él la ficha de un lead de LinkedIn arma la clave con la que lee su conversación y el estado del bot.');
