// Plantillas de mensaje del ACRM y el lead que se asigna solo al abrir su ficha.
//
// Las plantillas son del equipo y viven en la fila compartida lr_suite_private_data (sin migración):
// aquí se prueba que no se dupliquen, que guardar no pise lo que otro acaba de guardar, que el
// selector de la ficha se dibuje escapando lo que viene de la base, y que abrir una ficha ponga a
// la sesión en «Contactado por» solo cuando estaba vacío, deshaciéndolo si la base lo rechaza.
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const dom = new JSDOM('<div id="acrmLeadsCajon"></div>', {runScripts: 'outside-only', url: 'https://example.test'});
const w = dom.window;
w.eval(readFileSync('../../src/modules/prospeccion/acrm-plantillas.js', 'utf8'));
const api = w.LRACRMPlantillas;
// Las listas vienen del realm de JSDOM: se comparan en plano, como en las demás pruebas.
const plano = (v) => JSON.parse(JSON.stringify(v));

// ── Lo que se guarda de una plantilla ──────────────────────────────────────
assert.equal(api.normalizar({mensaje: '  '}), null, 'sin mensaje no hay plantilla');
assert.equal(api.normalizar({mensaje: 'ok'}), null, 'dos letras no son un mensaje');
const sinNombre = api.normalizar({mensaje: 'Hola Ana, vi tu perfil\nsegunda línea', canal: 'fax'});
assert.equal(sinNombre.nombre, 'Hola Ana, vi tu perfil', 'sin nombre, el selector lee la primera línea');
assert.equal(sinNombre.canal, '', 'un canal fuera del catálogo no se guarda');
assert.match(sinNombre.id, /^pl-/);
assert.equal(api.normalizar({mensaje: 'Hola', nombre: ' Primer contacto ', canal: 'linkedin'}).nombre, 'Primer contacto');

// ── La lista fusionada: sin repetidos, ordenada y con tope ─────────────────
const base = [
  {id: 'p1', nombre: 'Zeta', mensaje: 'Mensaje zeta', canal: 'linkedin', creadoEn: 10},
  {id: 'p2', nombre: 'Alfa', mensaje: 'Mensaje alfa', canal: 'whatsapp', creadoEn: 20}
];
const fusion = api.fusionar(base, [{id: 'p1', nombre: 'Zeta corregida', mensaje: 'Mensaje zeta', canal: 'linkedin', creadoEn: 30}]);
assert.deepEqual(plano(fusion.map((p) => p.nombre)), ['Alfa', 'Zeta corregida'], 'el mismo id gana el más nuevo y la lista va por nombre');
assert.equal(api.fusionar(base, [{id: 'p9', nombre: 'Otra', mensaje: 'mensaje   ZETA', canal: 'linkedin', creadoEn: 40}]).length, 2,
  'el mismo texto por el mismo canal es la misma plantilla aunque cambie el id');
assert.equal(api.fusionar(base, [{id: 'p9', nombre: 'Otra', mensaje: 'Mensaje zeta', canal: 'correo', creadoEn: 40}]).length, 3,
  'el mismo texto por otro canal sí es otra plantilla');
const muchas = Array.from({length: api.LIMITE + 10}, (_, i) => ({id: `m${i}`, nombre: `Plantilla ${String(i).padStart(3, '0')}`, mensaje: `Mensaje ${i}`}));
assert.equal(api.fusionar(muchas).length, api.LIMITE, 'la lista compartida no crece sin tope');

// ── Guardar y borrar contra la fila compartida ─────────────────────────────
let fila = {plantillas: []};
let subidas = 0;
const client = {
  from(tabla) {
    assert.equal(tabla, api.TABLA);
    return {
      select() { return this; },
      eq(columna, valor) { assert.equal(columna, 'key'); assert.equal(valor, api.CLAVE); return this; },
      async maybeSingle() { return {data: fila ? {payload: fila} : null, error: null}; },
      async upsert(escrito, opciones) {
        assert.equal(opciones.onConflict, 'key');
        assert.equal(escrito.key, api.CLAVE);
        subidas++;
        fila = escrito.payload;
        return {error: null};
      }
    };
  }
};
const primera = await api.guardar(client, {nombre: 'Primer contacto', mensaje: 'Hola, vi tu perfil', canal: 'linkedin'}, {quien: 'Jorge Luis'});
assert.equal(primera.repetida, false);
assert.equal(primera.plantillas.length, 1);
assert.equal(fila.actualizadoPor, 'Jorge Luis');
assert.equal(fila.plantillas[0].creadoPor, 'Jorge Luis', 'queda quién la guardó');
const otraVez = await api.guardar(client, {nombre: 'Copia', mensaje: 'Hola, vi tu perfil', canal: 'linkedin'});
assert.equal(otraVez.repetida, true, 'guardar dos veces el mismo texto no llena el selector de repetidos');
assert.equal(otraVez.plantilla.nombre, 'Primer contacto');
assert.equal(subidas, 1, 'una repetida no escribe en la fila compartida');
// Diego guarda la suya entremedio: la de Jorge Luis no la puede borrar.
fila = {plantillas: [...fila.plantillas, {id: 'diego-1', nombre: 'Seguimiento de Diego', mensaje: 'Te comparto un caso', canal: 'whatsapp', creadoEn: Date.now()}]};
const tercera = await api.guardar(client, {nombre: 'Cierre', mensaje: '¿Vemos 20 minutos el jueves?', canal: 'whatsapp'});
assert.deepEqual(plano(tercera.plantillas.map((p) => p.nombre)).sort(), ['Cierre', 'Primer contacto', 'Seguimiento de Diego'],
  'guardar relee la fila: lo que subió el otro sigue ahí');
const tras = await api.borrar(client, 'diego-1');
assert.deepEqual(plano(tras.map((p) => p.nombre)).sort(), ['Cierre', 'Primer contacto']);
const subidasAntes = subidas;
assert.equal((await api.borrar(client, 'no-existe')).length, 2);
assert.equal(subidas, subidasAntes, 'borrar lo que no está no escribe');
fila = {plantillas: Array.from({length: api.LIMITE}, (_, i) => ({id: `t${i}`, nombre: `T${i}`, mensaje: `Mensaje ${i}`}))};
await assert.rejects(api.guardar(client, {nombre: 'Una más', mensaje: 'La que sobra'}), /borra alguna/);
// Si la fila no se puede leer, la ficha se dibuja igual con el selector vacío.
assert.deepEqual(plano(await api.leer({from: () => ({select() { return this; }, eq() { return this; }, async maybeSingle() { return {error: {message: 'sin permiso'}}; }})})), []);

// ── El selector en la ficha y el lead que se toma al abrir ─────────────────
const html = readFileSync('../../index.html', 'utf8');
const trozo = (desde, hasta) => html.slice(html.indexOf(desde), html.indexOf(hasta));
let aviso = '';
let pintadas = 0;
let guardado = null;
let falla = false;
Object.defineProperty(w, 'prompt', {value: (_rotulo, sugerido) => sugerido, writable: true, configurable: true});
Object.defineProperty(w, 'confirm', {value: () => true, writable: true, configurable: true});
let etapaEscrita = null;
let fallaEtapa = false;
let relecturas = 0;
w.LRACRMLeads = {
  async guardarContactadoPor(_cliente, lead, usuario) {
    guardado = {anterior: lead.contactadoPor, usuario};
    if (falla) throw new Error('El contacto cambió o ya no existe. Actualiza la tabla.');
    return {ok: true};
  },
  async cambiarEtapa(_cliente, lead, etapa) {
    etapaEscrita = {captura: lead.captura, desde: lead.etapa, etapa};
    if (fallaEtapa) throw new Error('El lead cambió. Actualiza la tabla.');
    return {ok: true};
  }
};
w.eval(`
  const escapeHtml = (s) => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const ACRM_ICONOS = {copiar:'<svg></svg>', mas:'<svg></svg>', cerrar:'<svg></svg>'};
  const acrmIco = (icono, titulo, atributos = '') => '<button class="acrm-ico" type="button" title="' + escapeHtml(titulo) + '" ' + atributos + '>' + ACRM_ICONOS[icono] + '</button>';
  const acrmLeads = {plantillas: [], yo: 'jorge', equipo: [{usuario_id: 'jorge', nombre: 'Jorge Luis'}]};
  const getSuiteAccessSession = () => ({});
  const ensureSharedPendingClient = () => window.clienteDePrueba;
  const currentSuiteUserName = () => 'Jorge Luis';
  const acrmLeadAviso = (texto, error = false) => { window.ultimoAviso = (error ? 'ERR: ' : '') + texto; };
  const acrmLeadsPintar = () => { window.pintadas = (window.pintadas || 0) + 1; };
  const acrmLeadsCargar = async (opciones) => { window.relectura = opciones; };
  const leadsVisibles = () => true;
  ${trozo('      const ACRM_PLANTILLA_CAJAS = {', '      // Formulario de hito: vacío para uno nuevo')}
  ${trozo('      async function acrmLeadTomar(lead) {', '      async function acrmLeadAbrir(')}
  window.T = {acrmLeads, acrmPlantillasFilaHtml, acrmPlantillasRefrescar, acrmPlantillasCargar, acrmPlantillaGuardar, acrmPlantillaBorrar, acrmLeadTomar, ACRM_PLANTILLA_CAJAS};
`);
const T = w.T;
assert.deepEqual(plano(Object.keys(T.ACRM_PLANTILLA_CAJAS)), ['reserva', 'contacto', 'hito'], 'las tres cajas donde se le escribe a un lead');

const cajon = w.document.getElementById('acrmLeadsCajon');
cajon.innerHTML = T.acrmPlantillasFilaHtml('hito');
assert.equal(cajon.querySelector('select').disabled, true);
assert.equal(cajon.querySelector('select').textContent, 'Sin plantillas guardadas');
assert.equal(cajon.querySelectorAll('button').length, 3, 'copiar, guardar y borrar');
w.clienteDePrueba = client;
fila = {plantillas: [{id: 'p1', nombre: '<script>Primer contacto', mensaje: 'Hola, vi tu perfil', canal: 'linkedin'}]};
await T.acrmPlantillasCargar();
assert.equal(T.acrmLeads.plantillas.length, 1);
assert.equal(cajon.querySelector('select').disabled, false, 'el selector se llena sin redibujar la ficha');
assert.equal(cajon.querySelectorAll('option').length, 2);
assert.equal(cajon.querySelectorAll('option')[1].textContent, '<script>Primer contacto');
assert.match(cajon.innerHTML, /&lt;script&gt;/, 'lo que viene de la base se escapa');
cajon.querySelector('select').value = 'p1';
await T.acrmPlantillaBorrar('p1');
assert.equal(cajon.querySelectorAll('option').length, 1);
assert.match(w.ultimoAviso, /borrada/);
await T.acrmPlantillaGuardar('  ');
assert.match(w.ultimoAviso, /^ERR: Escribe el mensaje/, 'no se guarda una plantilla vacía');
await T.acrmPlantillaGuardar('Hola, ¿coordinamos 20 minutos?', {canal: 'whatsapp', nombre: 'Cierre'});
assert.equal(T.acrmLeads.plantillas[0].nombre, 'Cierre');
assert.equal(T.acrmLeads.plantillas[0].canal, 'whatsapp', 'la plantilla se lleva su canal para el próximo hito');
assert.equal(cajon.querySelectorAll('option')[1].textContent, 'Cierre');

// Abrir la ficha deja las tres columnas al día: quién lo contacta, su estado y, con él, la
// contactabilidad (sin cotización son los pasos del embudo).
pintadas = w.pintadas || 0;
const libre = {captura: 'li:perfil', contactadoPor: '', etapa: 'nuevo', version: 3};
await T.acrmLeadTomar(libre);
assert.equal(libre.contactadoPor, 'jorge');
assert.deepEqual(plano(guardado), {anterior: '', usuario: 'jorge'}, 'se escribe con «sin asignar» como valor anterior');
assert.equal(libre.etapa, 'contactado', 'un lead sin tocar pasa a «Contactado» al abrir su ficha');
assert.deepEqual(plano(etapaEscrita), {captura: 'li:perfil', desde: 'nuevo', etapa: 'contactado'});
assert.deepEqual(plano(w.relectura), {desdeCero: false, conResumen: true}, 'se relee la página abierta y las cifras de arriba');
guardado = null;
etapaEscrita = null;
w.relectura = null;
// Un lead ya tocado no se mueve: el embudo no retrocede ni se salta pasos.
const avanzado = {captura: 'li:otro', contactadoPor: 'diego', etapa: 'respondio', version: 1};
await T.acrmLeadTomar(avanzado);
assert.equal(avanzado.etapa, 'respondio', 'abrir la ficha de un lead que respondió no lo devuelve a «Contactado»');
assert.equal(avanzado.contactadoPor, 'diego', 'a nadie se le quita su lead');
assert.equal(guardado, null);
assert.equal(etapaEscrita, null);
assert.equal(w.relectura, null, 'sin nada que cambiar, abrir no vuelve a pedir la página');
// El lead de otro que nadie tocó: no se le quita, pero su estado sí avanza.
const deDiego = {captura: 'li:cinco', contactadoPor: 'diego', etapa: 'nuevo', version: 0};
await T.acrmLeadTomar(deDiego);
assert.equal(deDiego.contactadoPor, 'diego');
assert.equal(deDiego.etapa, 'contactado');
etapaEscrita = null;
T.acrmLeads.yo = 'jorge';
T.acrmLeads.equipo = [{usuario_id: 'diego', nombre: 'Diego'}];
await T.acrmLeadTomar({captura: 'li:tres', contactadoPor: '', etapa: 'contactado', version: 0});
assert.equal(guardado, null, 'una sesión que no es del equipo no se asigna nada');
T.acrmLeads.equipo = [{usuario_id: 'jorge', nombre: 'Jorge Luis'}];
// Lo que la base rechaza se deshace en pantalla, cada cosa por su lado.
falla = true;
const perdido = {captura: 'li:cuatro', contactadoPor: '', etapa: 'contactado', version: 0};
await T.acrmLeadTomar(perdido);
assert.equal(perdido.contactadoPor, '', 'si otra persona se lo quedó, la asignación se deshace en pantalla');
assert.match(w.ultimoAviso, /^ERR: No se pudo ponerte/);
falla = false;
fallaEtapa = true;
w.relectura = null;
const rechazado = {captura: 'li:seis', contactadoPor: 'diego', etapa: 'nuevo', version: 9};
await T.acrmLeadTomar(rechazado);
assert.equal(rechazado.etapa, 'nuevo', 'si la base rechaza el cambio, el estado vuelve a «Sin tocar»');
assert.match(w.ultimoAviso, /^ERR: No se pudo pasar el lead/);
assert.equal(w.relectura, null, 'un cambio que no entró no relee la tabla');
assert.ok((w.pintadas || 0) > pintadas);

console.log('PASS plantillas: una plantilla necesita mensaje, no se duplica por texto ni se pierde lo que subió el otro, el selector de la ficha se llena y se escapa sin redibujarla, y abrir una ficha toma el lead sin asignar y pasa a «Contactado» el que nadie había tocado, sin mover a los demás.');
w.close();
