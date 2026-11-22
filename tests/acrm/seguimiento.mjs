// La vista de cotizaciones debe funcionar independientemente de la página de leads.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
function source(name) {
  const start = html.search(new RegExp(`      (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return html.slice(start, html.indexOf('\n      }', start) + 8);
}
// Verifica sintaxis del script completo, además de ejecutar las funciones de esta vista.
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  if (match[1].trim()) new vm.Script(match[1]);
}
const dom = new JSDOM('<main id="app"></main>', { url: 'https://example.test' });
const d = dom.window.document;
const seguimiento = { abierto: false, busqueda: '', filtro: 'abiertas', cargando: false, error: '' };
const leads = { filtro: 'nuevo', canal: 'linkedin', busqueda: 'Ana', pagina: 3, lista: [], porPagina: 20, aviso: '' };
const q = (id, fecha, estado = 'Enviado', hechos = 0) => ({ id, captura: `co:${id}`, fechaEnvio: fecha, estado, contactosRealizados: hechos, contactos: [], cliente: id, servicio: 'Google Ads', montoCotizado: 900 });
const quotes = [q('futura', '2026-11-23'), q('vencida', '2026-11-01'), q('hoy', '2026-11-20'), q('aprobada', '2026-11-01', 'Aprobado'), q('perdida', '2026-11-02', 'Perdido'), q('sin fecha', ''), q('completa', '2026-09-01', 'Enviado', 8)];
quotes[1].cliente = '<img src=x onerror=alert(1)> Ángela';
let opened = '', saved, refreshed = 0, refreshOK = true, marked;
const normalizeText = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const c = vm.createContext({
  document: d, window: dom.window, quotes, acrmSeguimiento: seguimiento, acrmLeads: leads,
  normalizeText, escapeHtml, quoteCerrada: q => ['Aprobado', 'Perdido'].includes(q.estado),
  QUOTE_CONTACT_OFFSETS: [1,3,5,12,19,26,41,56], QUOTE_SERVICE_OTHER: 'Otro servicio',
  quoteServiceName: q => q.servicio, fmtDate: v => v, fmtNumber: n => String(n), fmtMoneyCents: n => `S/ ${n.toFixed(2)}`,
  localDayKey: (date) => date ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` : '2026-11-21',
  localMonthKey: () => '2026-11', monthLabelFor: () => 'Noviembre 2026', quoteInvestmentFor: () => ({googleAds: 0, metaAds: 0, plataformas: 0}),
  metric: (label, value, detail) => `<article class="metric-card"><p class="metric-label">${label}</p><p class="metric-value">${value}</p><p class="metric-detail">${detail}</p></article>`,
  acrmLeadCotizacion: () => null,
  acrmLeadAbrirDesdeFuera: captura => { opened = captura; },
  marcarToquesCotizacion: async (q, n) => { marked = [q.id, n]; },
  saveQuoteInvestment: (...args) => { saved = args; },
  refrescarCotizaciones: async () => { refreshed++; return refreshOK; },
  ensureQuotesLoaded: () => {}, getSuiteAccessSession: () => null,
  icons: {}, ACRM_ICONOS: {}, ACRM_LEADS_FILTROS: [['todos','Todos'], ['nuevo','Sin tocar'], ['contactado','Contactados'], ['respondio','Respondieron'], ['cotizados','Con cotización'], ['ganado','Ganados']],
  acrmLeadsCargar: () => {}, acrmPlantillasCargar: () => {},
  acrmLinkedinPintar: () => {}, acrmProspectosPintar: () => {}, acrmLinkedinAbrir: () => {}, acrmProspectosAbrir: () => {}, exportQuotesXls: () => {},
  shell: content => {
    // La barra superior se toma de shell: los indicadores deben vivir junto a Notificaciones.
    const topbar = source('shell').slice(source('shell').indexOf('<div class="topbar '), source('shell').indexOf('<div class="content-body">'));
    const top = vm.runInNewContext('`' + topbar + '`', {idEnLaBarra: 'prospeccion', sidebarCollapsed: false, sidebarToggleLabel: () => 'Menú', active: {title:'CRM'}, state: {active:'prospeccion'}, suiteNotificationsHtml: () => '<button class="btn">Notificaciones</button>'});
    d.getElementById('app').innerHTML = `<div class="content">${top}<div class="content-body">${content}</div></div>`;
  },
  acrmLeadsPintar: () => {
    d.getElementById('acrmLeadsKpis').innerHTML = vm.runInContext('acrmLeadsKpisHtml()', c);
    vm.runInContext('acrmSeguimientoPintar(); acrmLeadsEnlazar()', c);
  }
});
for (const name of ['quoteMonthKey', 'quoteEstado', 'quoteContactCount', 'quoteContactsDone', 'quoteContactSchedule', 'quoteContactabilityCell', 'acrmSeguimientoLista', 'acrmSeguimientoPintar', 'acrmSeguimientoCargar', 'acrmSeguimientoCambiarVista', 'acrmLeadsKpisHtml', 'acrmLeadsEnlazar', 'acrmLeadsModule']) vm.runInContext(source(name), c);
vm.runInContext('acrmLeadsModule()', c);
const tick = () => new Promise(r => setImmediate(r));
const ids = () => Array.from(vm.runInContext('acrmSeguimientoLista()', c), x => x.id);
assert.deepEqual(ids(), ['vencida', 'hoy', 'futura', 'completa', 'sin fecha']);
assert.ok(d.querySelector('.topbar #acrmLeadsKpis'));
assert.equal(d.querySelectorAll('#acrmLeadsKpis').length, 1);
assert.equal(d.querySelectorAll('#acrmLeadsKpis .metric-card').length, 5);
assert.equal(d.querySelector('.acrm-leads #acrmLeadsKpis'), null);
const before = [leads.filtro, leads.canal, leads.busqueda, leads.pagina];
d.getElementById('acrmSeguimientoAbrir').click();
await tick();
assert.equal(refreshed, 1);
assert.equal(d.getElementById('acrmTablaLeads').hidden, true);
assert.equal(d.getElementById('acrmSeguimiento').hidden, false);
assert.equal(d.querySelector('#acrmSeguimientoFilas img'), null, 'los datos se escapan');
d.querySelector('[data-seguimiento-ficha="co:vencida"]').click();
assert.equal(opened, 'co:vencida', 'abre incluso un lead que no está en la página');
d.querySelector('[data-quote-contact-dot="vencida"]').click();
await tick();
assert.deepEqual(marked, ['vencida', 1], 'reutiliza el registro de contacto');
const filtro = d.getElementById('acrmSeguimientoFiltro');
filtro.value = 'pendientes'; filtro.dispatchEvent(new dom.window.Event('change'));
assert.deepEqual(ids(), ['vencida', 'hoy'], 'incluye hoy, excluye futuras, cerradas y completas');
filtro.value = 'cerradas'; filtro.dispatchEvent(new dom.window.Event('change'));
assert.deepEqual(ids(), ['perdida','aprobada']);
assert.ok([...d.querySelectorAll('#acrmSeguimientoFilas [data-quote-contact-dot]')].every(x => x.disabled));
filtro.value = 'todas'; filtro.dispatchEvent(new dom.window.Event('change'));
const buscar = d.getElementById('acrmSeguimientoBuscar');
buscar.value = 'angela'; buscar.dispatchEvent(new dom.window.Event('input'));
assert.deepEqual(ids(), ['vencida'], 'búsqueda sin tildes');
buscar.value = 'inexistente'; buscar.dispatchEvent(new dom.window.Event('input'));
assert.match(d.getElementById('acrmSeguimientoFilas').textContent, /No hay cotizaciones/);
buscar.value = ''; buscar.dispatchEvent(new dom.window.Event('input'));
refreshOK = false;
d.getElementById('acrmSeguimientoActualizar').click(); await tick();
assert.match(d.getElementById('acrmSeguimientoEstado').textContent, /No se pudieron actualizar/);
assert.equal(d.getElementById('acrmSeguimientoActualizar').disabled, false);
refreshOK = true;
d.getElementById('acrmSeguimientoActualizar').click(); await tick();
assert.equal(seguimiento.error, '');
d.getElementById('acrmSeguimientoVolver').click();
assert.deepEqual([leads.filtro, leads.canal, leads.busqueda, leads.pagina], before);
assert.equal(d.getElementById('acrmTablaLeads').hidden, false);
assert.equal(d.activeElement.id, 'acrmSeguimientoAbrir');
const inversion = d.querySelector('[data-inversion="metaAds"]');
inversion.value = '240'; inversion.dispatchEvent(new dom.window.Event('change'));
assert.deepEqual(saved, ['2026-11', 'metaAds', '240'], 'editar inversión funciona fuera de la sección');
if (process.env.CRM_PREVIEW) {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>') + 8);
  leads.resumen = {total:4200, sinTocar:3975, contactados:225, porCanal:{linkedin:4166, meta_whatsapp:2, ads_library:10, directo:22}};
  c.acrmLeadsPintar();
  d.getElementById('acrmLeadsFilas').innerHTML = '<tr><td>LinkedIn</td><td>Ana Pérez</td><td>Jorge</td><td>Retail</td><td>Empresa</td><td>web.pe</td><td>Contactado</td><td>S/ 900</td><td>Seguimiento</td><td>—</td></tr>'.repeat(8);
  writeFileSync('/tmp/crm-leads-preview.html', '<!doctype html><meta charset="utf-8">'+css+d.getElementById('app').outerHTML);
  vm.runInContext('acrmSeguimientoCambiarVista(true)', c);
  writeFileSync('/tmp/crm-seguimiento-preview.html', '<!doctype html><meta charset="utf-8">'+css+d.getElementById('app').outerHTML);
}
dom.window.close();
console.log('PASS seguimiento: filtros, prioridad, búsqueda, ficha fuera de página, contactos, estados vacíos/error, regreso a leads e inversión en cabecera.');
