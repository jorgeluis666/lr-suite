// El ACRM es una sola página: la tabla maestra de leads con la ficha de cada uno. Las pestañas
// Acciones y Cotizaciones se retiraron; lo que era de cada lead pasó a su ficha y lo que era de todo
// el equipo (marcador, metas, inversión del mes, exportar, la carga de LinkedIn) quedó en la página.
//
// Lo que se puede romper sin ruido:
//   · Que reaparezca una pantalla aparte (otra vez funciones aisladas).
//   · Que quien tenía «quotes» guardado como módulo activo caiga en el primer módulo de la lista en
//     vez de volver al ACRM.
//   · Que la ficha pierda uno de sus bloques: acciones (con la reserva de LinkedIn, lo único que
//     cierra un primer contacto), cotización o el formulario para cotizar.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function extraer(nombre) {
  const inicio = html.indexOf(`function ${nombre}(`);
  assert.notEqual(inicio, -1, `no se encontró la función ${nombre}`);
  let i = html.indexOf('{', inicio);
  let nivel = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') nivel++;
    else if (html[i] === '}' && --nivel === 0) break;
  }
  return html.slice(inicio, i + 1);
}
const noExiste = (nombre) => assert.equal(html.indexOf(`function ${nombre}(`), -1, `${nombre} ya no debería existir`);

// ── Una sola página ────────────────────────────────────────────────────────
for (const nombre of ['quotesModule', 'acrmSeccionesHtml', 'abrirSeccionAcrm', 'quoteMonthTrack', 'quoteDrawer', 'acrmLeadAccionesHtml']) noExiste(nombre);
assert.doesNotMatch(html, /data-acrm-seccion=/, 'no quedan pestañas de sección');
assert.match(extraer('prospeccionModule'), /acrmLeadsModule\(\)/, 'el ACRM dibuja la tabla maestra');
assert.doesNotMatch(html.slice(html.indexOf('const modules = ['), html.indexOf('const modules = [') + 4000), /id: "quotes"/,
  'Cotizaciones no es un módulo de la barra');

const c = {
  modules: [{id: 'prospeccion'}, {id: 'tasks'}],
  activeModuleStorageKey: 'lr-suite-active-module',
  window: {localStorage: {getItem: () => 'quotes'}}
};
vm.createContext(c);
const inicio = html.indexOf('const getStoredActiveModule = ');
vm.runInContext(html.slice(inicio, html.indexOf('\n      };', inicio) + 9), c);
assert.equal(vm.runInContext('getStoredActiveModule()', c), 'prospeccion', 'quien tenía Cotizaciones abierto vuelve al ACRM');

// ── Lo del equipo, en la página ────────────────────────────────────────────
const pagina = extraer('acrmLeadsModule');
for (const [pieza, motivo] of [
  ['id="lrAcrmResumen"', 'el marcador del mes'],
  ['id="acrmMetas"', 'las metas y el reparto de primeros contactos'],
  ['id="lrAcrmRanking"', 'quién va ganando'],
  ['id="quoteExportButton"', 'exportar las cotizaciones'],
  ['id="quoteImportButton"', 'importarlas'],
  ['id="lrInvestigacionRoot" hidden', 'la lista de LinkedIn, que aparece al subir el CSV'],
  ['id="lrAcrmPanel" hidden', 'la cola oculta, que lee el agente general']
]) assert.ok(pagina.includes(pieza), `la página tiene ${motivo}`);
const kpis = extraer('acrmLeadsKpisHtml');
assert.match(kpis, /Inversión del mes/, 'la inversión del mes es una tarjeta de arriba');
assert.match(kpis, /data-inversion="\$\{clave\}"/, 'con sus campos de Google, Meta y plataformas');

// ── Lo de cada lead, en su ficha ───────────────────────────────────────────
const cajon = extraer('acrmLeadCajonHtml');
assert.match(cajon, /acrmLeadHitosHtml\(lead/, 'la ficha tiene los hitos del lead');
// El orden que se pidió: nombre, nivel de contactabilidad, datos, hitos y debajo el chat.
const orden = ['<h2>', 'acrm-lead-nivel', 'acrm-lead-datos', 'acrmLeadHitosHtml(', 'acrmFichaAgenteHtml(', 'acrmLeadCotizacionHtml(', 'Hilo de mensajes'].map((x) => cajon.indexOf(x));
assert.ok(orden.every((i) => i > 0) && orden.every((i, k) => k === 0 || i > orden[k - 1]), `la ficha va en orden: nombre, nivel, datos, hitos, chat, cotización, hilo (${orden})`);
assert.match(cajon, /quote \? acrmLeadCotizacionHtml\(quote\)/, 'y su cotización si la tiene');
assert.match(cajon, /acrmLeadNuevaCotizacionHtml/, 'y el formulario para cotizar sin salir de ella');
assert.match(cajon, /acrmFichaAgenteHtml\(lead, quote\)/, 'y su agente');
const acciones = extraer('acrmLeadHitosHtml');
for (const accion of ['reservar', 'confirmar', 'cancelar']) assert.match(acciones, new RegExp(`data-reserva="${accion}"`), `la reserva de LinkedIn ofrece ${accion}`);
assert.match(acciones, /a\.tipo === "primer_contacto"[\s\S]*Ya envié el mensaje/, 'el primer contacto dice cómo se cierra');
assert.match(acciones, /data-hito-cumplir/, 'un hito se marca cumplido');
assert.match(acciones, /wa\.me\/\$\{escapeHtml\(numero\)\}\?text=/, 'y uno de WhatsApp se envía con el mensaje ya puesto');
const cotizacion = extraer('acrmLeadCotizacionHtml');
for (const campo of ['estado', 'servicioEstandar', 'montoCotizado', 'gastos', 'fechaEnvio', 'origen', 'contacto', 'telefono', 'emailContacto']) {
  assert.match(cotizacion, new RegExp(`"${campo}"`), `la cotización edita ${campo}`);
}
assert.match(cotizacion, /data-desglose-agregar/, 'y su desglose');

// ── El CSS sigue entero ────────────────────────────────────────────────────
// Al podar las reglas de las pantallas retiradas, un comentario quedó sin cerrar y se tragó en
// silencio todas las reglas siguientes (la tabla dejó de desplazarse en el celular).
// Solo el contenido de <style>: la CSP de la cabecera lleva «https://*.» y no es un comentario.
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
assert.equal((css.match(/\/\*/g) || []).length, (css.match(/\*\//g) || []).length, 'cada comentario del CSS se cierra');
assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length, 'las llaves del CSS están balanceadas');

console.log('PASS ACRM en una página: sin pestañas ni pantallas aparte, quien tenía Cotizaciones vuelve al ACRM, lo del equipo queda en la página la ficha trae acciones con reserva, cotización editable, cotizar y su agente, y el CSS no quedó con comentarios ni llaves abiertas.');
