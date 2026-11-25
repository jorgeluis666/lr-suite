// Historia de mensajes: el calendario de envíos de la barra superior del CRM.
//
// Cubre lo que no se puede mirar a ojo: que el día sea el de Lima y no el del navegador, que el mes
// se pida con sus bordes exactos, que el calendario empiece en lunes, que los enlaces salgan
// pulsables y marcados cuando llevan un PDF, y que nada de lo que viene de la base se pueda colar
// como HTML.
//
// Desde tests/acrm: npm ci && node mensajes.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const js = readFileSync(new URL('../../src/modules/prospeccion/acrm-mensajes.js', import.meta.url), 'utf8');
const dom = new JSDOM('<div id="panel"></div>', { runScripts: 'outside-only' });
dom.window.eval(js);
const api = dom.window.LRACRMMensajes;
const doc = dom.window.document;
// Lo que devuelve el módulo nace en el realm de JSDOM: se compara su contenido, no su prototipo.
const plano = (x) => JSON.parse(JSON.stringify(x));

// ── El día es el de Lima ──────────────────────────────────────────────────
// 03:30 UTC del 25 son las 22:30 del 24 en Lima: el envío pertenece al día en que se trabajó.
assert.equal(api.diaLima('2026-11-25T03:30:00Z'), '2026-11-24');
assert.equal(api.diaLima('2026-11-25T05:00:00Z'), '2026-11-25');
assert.equal(api.horaLima('2026-11-25T03:30:00Z'), '22:30');
assert.equal(api.diaLima('no es una fecha'), '');

// ── El mes pedido empieza y termina a medianoche de Lima ──────────────────
assert.deepEqual(plano(api.rangoMes(2026, 11)), { desde: '2026-11-01T05:00:00.000Z', hasta: '2026-12-01T05:00:00.000Z' });
assert.deepEqual(plano(api.rangoMes(2026, 12)), { desde: '2026-12-01T05:00:00.000Z', hasta: '2027-01-01T05:00:00.000Z' });
assert.deepEqual(plano(api.mesVecino({ anio: 2026, mes: 1 }, -1)), { anio: 2025, mes: 12 });
assert.deepEqual(plano(api.mesVecino({ anio: 2026, mes: 12 }, 1)), { anio: 2027, mes: 1 });

// ── El calendario empieza en lunes ────────────────────────────────────────
const nov = api.celdas({ anio: 2026, mes: 11 });   // el 1 de noviembre de 2026 cae domingo
assert.equal(nov.length % 7, 0);
assert.equal(nov.indexOf(1), 6, 'un mes que arranca en domingo deja seis huecos antes del día 1');
assert.equal(nov.filter((d) => d).length, 30);
assert.equal(api.celdas({ anio: 2026, mes: 2 }).filter((d) => d).length, 28);
assert.equal(api.celdas({ anio: 2028, mes: 2 }).filter((d) => d).length, 29, 'los años bisiestos tienen su 29');

// ── Enlaces y PDF ─────────────────────────────────────────────────────────
assert.deepEqual(plano(api.enlacesDe('Te dejo https://lima.pe/ficha.pdf y listo.')), ['https://lima.pe/ficha.pdf']);
assert.ok(api.esPdf('https://lima.pe/ficha.pdf'));
assert.ok(api.esPdf('https://lima.pe/ficha.pdf?v=2'), 'un PDF con parámetros sigue siendo un PDF');
assert.ok(!api.esPdf('https://lima.pe/ficha'));
const html = api.textoHtml('Hola <b>Ana</b>, mira https://lima.pe/propuesta.pdf.');
assert.ok(html.includes('&lt;b&gt;'), 'el texto del mensaje nunca entra como HTML');
assert.ok(html.includes('<a href="https://lima.pe/propuesta.pdf" target="_blank" rel="noopener noreferrer">'));
assert.ok(html.includes('acrm-msg-pdf'), 'el enlace a un PDF queda marcado');
assert.ok(!api.textoHtml('javascript:alert(1) y data:text/html,x').includes('<a '), 'solo http y https se vuelven enlace');

// ── Agrupar y resumir ─────────────────────────────────────────────────────
const mensajes = [
 { id: '1', captura: 'li:ana', texto: 'Mira https://lima.pe/propuesta.pdf', enviado_en: '2026-11-10T16:00:00Z', autor: 'u1', origen: 'manual', lr_acrm_capturas: { nombre: 'Ana <script>', canal: 'linkedin' } },
 { id: '2', captura: 'li:ana', texto: 'Segundo del mismo día', enviado_en: '2026-11-10T14:00:00Z', autor: 'u1', origen: 'manual', lr_acrm_capturas: { nombre: 'Ana <script>', canal: 'linkedin' } },
 { id: '3', captura: 'wa:1:51999', texto: 'Hola, soy el bot', enviado_en: '2026-11-12T20:00:00Z', autor: null, origen: 'agente', lr_acrm_capturas: { nombre: 'Luis', canal: 'meta_whatsapp' } },
 { id: '4', captura: 'li:zoe', texto: 'Ficha en https://lima.pe/ficha.pdf', enviado_en: '2026-11-13T02:00:00Z', autor: 'u1', origen: 'manual', lr_acrm_capturas: { nombre: 'Zoe', canal: 'linkedin' } }
];
const dias = api.porDia(mensajes);
assert.deepEqual(plano([...dias.keys()].sort()), ['2026-11-10', '2026-11-12']);
assert.equal(dias.get('2026-11-12').length, 2, 'las 02:00 UTC del 13 son todavía el 12 en Lima');
assert.deepEqual(plano(dias.get('2026-11-10').map((m) => m.id)), ['2', '1'], 'el día se lee en orden de hora');
assert.deepEqual(plano(api.resumenDe(mensajes)), { total: 4, conEnlace: 2, conPdf: 2 });

// ── La consulta pide solo lo enviado y pagina ─────────────────────────────
const lote = (n, desde) => Array.from({ length: n }, (_, i) => ({ ...mensajes[0], id: `p${desde + i}` }));
let consulta = null, rangos = [];
const clienteDe = (filas) => ({
 from(tabla) {
  if (tabla === 'lr_pros_colaboradores') {
   const fin = Promise.resolve({ data: [{ usuario_id: 'u1', nombre: 'Jorge Luis' }] });
   return { select: () => fin };
  }
  assert.equal(tabla, 'lr_acrm_mensajes');
  const q = {
   select(cols) { consulta = { ...consulta, cols }; return q; },
   eq(col, valor) { consulta = { ...consulta, [col]: valor }; return q; },
   gte(col, valor) { consulta = { ...consulta, desde: valor }; return q; },
   lt(col, valor) { consulta = { ...consulta, hasta: valor }; return q; },
   order(col, opciones) { consulta = { ...consulta, orden: [col, opciones.ascending] }; return q; },
   async range(a, b) { rangos.push([a, b]); return { data: filas.slice(a, b + 1) }; }
  };
  return q;
 }
});
const corto = await api.mensajesDelMes(clienteDe(mensajes), { anio: 2026, mes: 11 });
assert.equal(corto.mensajes.length, 4);
assert.equal(corto.recortado, false);
assert.equal(consulta.direccion, 'enviado', 'lo recibido no es historia de envíos');
assert.equal(consulta.desde, '2026-11-01T05:00:00.000Z');
assert.equal(consulta.hasta, '2026-12-01T05:00:00.000Z');
assert.deepEqual(plano(consulta.orden), ['enviado_en', true]);
assert.ok(consulta.cols.includes('lr_acrm_capturas(nombre,canal)'), 'trae el nombre del lead en la misma consulta');
assert.deepEqual(plano(rangos), [[0, 499]], 'un mes corto se lee de una sola vez');

rangos = [];
const largo = await api.mensajesDelMes(clienteDe(lote(1200, 0)), { anio: 2026, mes: 11 });
assert.equal(largo.mensajes.length, 1200);
assert.deepEqual(plano(rangos), [[0, 499], [500, 999], [1000, 1499]], 'sigue pidiendo mientras la página venga llena');
assert.equal(largo.recortado, false);
rangos = [];
const tope = await api.mensajesDelMes(clienteDe(lote(api.TOPE + 400, 0)), { anio: 2026, mes: 11 });
assert.equal(tope.mensajes.length, api.TOPE);
assert.equal(tope.recortado, true, 'un mes enorme avisa de que se recortó en vez de callarlo');
assert.equal(await api.mensajesDelMes(clienteDe(mensajes), { anio: 2026, mes: 11 }, () => false), null, 'descarta la lectura de un panel que ya se cerró');

// ── El panel: no consulta hasta que se abre ───────────────────────────────
const panel = doc.getElementById('panel');
let lecturas = 0;
const db = {
 from(tabla) {
  if (tabla === 'lr_pros_colaboradores') return { select: () => Promise.resolve({ data: [{ usuario_id: 'u1', nombre: 'Jorge Luis' }] }) };
  lecturas += 1;
  const q = { select: () => q, eq: () => q, gte: () => q, lt: () => q, order: () => q, range: async () => ({ data: mensajes }) };
  return q;
 }
};
const hoy = { anio: 2026, mes: 11 };
api.mount(panel, db, { inicial: hoy });
assert.equal(lecturas, 0, 'entrar al CRM no cuesta una consulta del mes');
assert.ok(panel.textContent.includes('Historia de mensajes'));

const abrir = new dom.window.Event('toggle');
abrir.newState = 'open';
panel.dispatchEvent(abrir);
await new Promise((listo) => setTimeout(listo, 0));
assert.equal(lecturas, 1);
assert.ok(panel.textContent.includes('4 mensajes enviados'), panel.textContent.slice(0, 200));
assert.ok(panel.textContent.includes('2 con PDF'));
assert.equal(panel.querySelectorAll('[data-mensajes-dia]').length, api.celdas(hoy).filter((d) => d).length, 'hay un botón por día del mes y ninguno por los huecos');
assert.equal(panel.querySelector('script'), null, 'un nombre con etiquetas no se ejecuta');

// Elegir un día muestra sus mensajes, con la hora de Lima y quién lo escribió.
const dia10 = panel.querySelector('[data-mensajes-dia="2026-11-10"]');
assert.ok(dia10, 'el día con envíos tiene su botón');
assert.equal(dia10.querySelector('.acrm-msg-punto').textContent, '2');
dia10.dispatchEvent(new dom.window.Event('click'));
const detalle = panel.querySelector('.acrm-msg-detalle').textContent;
assert.ok(detalle.includes('Ana <script>'), 'el nombre se lee tal cual, pero como texto');
assert.ok(detalle.includes('09:00') && detalle.includes('11:00'), detalle);
assert.ok(detalle.includes('Jorge Luis'), 'un mensaje del equipo lleva el nombre de quien lo escribió');
assert.equal(panel.querySelectorAll('.acrm-msg-lista > li').length, 2);
assert.equal(panel.querySelectorAll('.acrm-msg-texto a').length, 1);

const dia12 = panel.querySelector('[data-mensajes-dia="2026-11-12"]');
dia12.dispatchEvent(new dom.window.Event('click'));
assert.ok(panel.querySelector('.acrm-msg-detalle').textContent.includes('Bot'), 'lo que manda el bot no se le atribuye a nadie del equipo');

// Sin sesión no se inventa un calendario vacío: lo dice.
api.mount(panel, null, { inicial: hoy });
const abrirSinSesion = new dom.window.Event('toggle');
abrirSinSesion.newState = 'open';
panel.dispatchEvent(abrirSinSesion);
await new Promise((listo) => setTimeout(listo, 0));
assert.ok(panel.textContent.includes('Inicia sesión'));

api.unmount();
console.log('✓ historia de mensajes: día de Lima, mes completo, calendario, enlaces a PDF y panel');
