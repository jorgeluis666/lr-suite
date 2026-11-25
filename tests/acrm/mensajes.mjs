// Historia de mensajes: el catálogo de mensajes y el calendario de envíos de la barra del CRM.
//
// Cubre lo que no se puede mirar a ojo: que el día sea el de Lima y no el del navegador, que el mes
// se pida con sus bordes exactos, que el calendario empiece en lunes, que los enlaces salgan
// pulsables y marcados cuando llevan un PDF, que un tipo cuente sus envíos por la seña sin pisarse
// con otro, y que nada de lo que viene de la base se pueda colar como HTML.
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
 { id: '1', captura: 'li:ana', texto: 'Mira https://limaretail.com/presentacion.pdf', enviado_en: '2026-11-10T16:00:00Z', autor: 'u1', origen: 'manual', lr_acrm_capturas: { nombre: 'Ana <script>', canal: 'linkedin' } },
 { id: '2', captura: 'li:ana', texto: 'Segundo del mismo día', enviado_en: '2026-11-10T14:00:00Z', autor: 'u1', origen: 'manual', lr_acrm_capturas: { nombre: 'Ana <script>', canal: 'linkedin' } },
 { id: '3', captura: 'wa:1:51999', texto: 'Hola, soy el bot', enviado_en: '2026-11-12T20:00:00Z', autor: null, origen: 'agente', lr_acrm_capturas: { nombre: 'Luis', canal: 'meta_whatsapp' } },
 { id: '4', captura: 'li:zoe', texto: 'Ficha en https://limaretail.com/presentacion.pdf', enviado_en: '2026-11-13T02:00:00Z', autor: 'u1', origen: 'manual', lr_acrm_capturas: { nombre: 'Zoe', canal: 'linkedin' } }
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

// ── El catálogo de tipos ──────────────────────────────────────────────────
assert.equal(api.normalizarTipo({ nombre: 'Envío PDF', sena: 'presentacion.pdf' }).nombre, 'Envío PDF');
assert.ok(api.normalizarTipo({ nombre: 'Envío PDF', sena: 'presentacion.pdf' }).id, 'un tipo nuevo nace con su id');
assert.equal(api.normalizarTipo({ nombre: '', sena: 'presentacion.pdf' }), null, 'sin nombre no hay tipo');
assert.equal(api.normalizarTipo({ nombre: 'Envío PDF', sena: 'ab' }), null, 'una seña de dos letras contaría cualquier cosa');
assert.equal(api.normalizarTipo({ nombre: '  Envío\u0000PDF  ', sena: ' x.pdf ' }).nombre, 'Envío PDF', 'se limpian los caracteres de control y los bordes');

const pdf = { id: 't1', nombre: 'Envío PDF', sena: 'limaretail.com/presentacion.pdf', creadoEn: 1 };
const demo = { id: 't2', nombre: 'Acción/IC Demo', sena: 'agendar una demo', creadoEn: 2 };
const auditoria = { id: 't3', nombre: 'Auditoría', sena: 'auditoría gratuita de tu cuenta', creadoEn: 3 };
const catalogo = api.fusionarTipos([pdf, demo, auditoria]);
assert.deepEqual(plano(catalogo).map((t) => t.id), ['t1', 't2', 't3'], 'el catálogo conserva el orden en que se crearon');
assert.equal(api.fusionarTipos([pdf], [{ ...pdf, id: 't9', nombre: 'Repetido', creadoEn: 9 }]).length, 1, 'la misma seña no entra dos veces');
assert.equal(api.fusionarTipos([pdf, { nombre: 'A medias', sena: '' }]).length, 1, 'lo que no es un tipo se descarta en vez de romper la lista');

assert.equal(api.senaChocaCon(catalogo, { id: 't9', sena: 'LIMARETAIL.com/Presentacion.PDF' })?.id, 't1', 'la misma seña con otras mayúsculas choca');
assert.equal(api.senaChocaCon(catalogo, { id: 't9', sena: 'una demo' })?.id, 't2', 'una seña contenida en otra contaría el mismo mensaje dos veces');
assert.equal(api.senaChocaCon(catalogo, { id: 't1', sena: 'limaretail.com/presentacion.pdf' }), null, 'un tipo no choca consigo mismo al editarlo');
assert.equal(api.senaChocaCon(catalogo, { id: 't9', sena: 'nuevo informe anual' }), null);

// Contar: la seña se busca sin tildes ni mayúsculas, dentro del texto que se envió.
const conTipos = [
 { id: 'a', texto: 'Hola, te dejo https://limaretail.com/presentacion.pdf' },
 { id: 'b', texto: 'LIMARETAIL.COM/PRESENTACION.PDF' },
 { id: 'c', texto: '¿Te parece si agendamos una demo?' },
 { id: 'd', texto: 'Podemos hacer una AUDITORIA GRATUITA DE TU CUENTA' },
 { id: 'e', texto: 'Buen día, quedo atento.' }
];
assert.deepEqual(plano(api.delTipo(conTipos, catalogo[0])).map((m) => m.id), ['a', 'b']);
assert.ok(api.esDelTipo({ texto: 'hacemos una AUDITORIA gratuita de tu cuenta hoy' }, catalogo[2]), 'la tilde de la seña no deja fuera al mensaje que no la lleva');
assert.ok(!api.esDelTipo({ texto: 'Buen día' }, catalogo[0]));
assert.deepEqual(plano([...api.contarPorTipo(conTipos, catalogo)]), [['t1', 2], ['t2', 0], ['t3', 1]], 'un tipo sin envíos cuenta cero, no desaparece');
assert.equal(api.delTipo(conTipos, null).length, 5, 'sin tipo elegido se ven todos');

// Guardar relee la fila y fusiona: no pisa el tipo que acaba de crear otra persona.
let guardado = null;
const fila = { tipos: [pdf, demo] };
const dbTipos = {
 from(tabla) {
  assert.equal(tabla, api.TABLA);
  return {
   select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { payload: fila } }) }) }),
   upsert: async (registro) => { guardado = registro; fila.tipos = registro.payload.tipos; return {}; }
  };
 }
};
const creado = await api.guardarTipo(dbTipos, { nombre: 'Auditoría', sena: 'auditoría gratuita' }, { quien: 'Jorge Luis' });
assert.deepEqual(plano(creado.tipos).map((t) => t.nombre), ['Envío PDF', 'Acción/IC Demo', 'Auditoría'], 'lo que subió el otro sigue ahí');
assert.equal(guardado.key, api.CLAVE);
assert.equal(guardado.payload.actualizadoPor, 'Jorge Luis');
await assert.rejects(api.guardarTipo(dbTipos, { nombre: 'Otro', sena: 'una demo' }), /se cruza con/, 'una seña que se solapa se frena antes de contar doble');
await assert.rejects(api.guardarTipo(dbTipos, { nombre: '', sena: 'algo nuevo' }), /nombre/);
const editado = await api.guardarTipo(dbTipos, { id: 't1', nombre: 'Envío de la presentación', sena: 'limaretail.com/presentacion.pdf' });
assert.deepEqual(plano(editado.tipos).map((t) => t.nombre), ['Envío de la presentación', 'Acción/IC Demo', 'Auditoría'], 'editar conserva el sitio y no duplica');
const quedan = await api.borrarTipo(dbTipos, 't2');
assert.deepEqual(plano(quedan).map((t) => t.nombre), ['Envío de la presentación', 'Auditoría']);
assert.equal((await api.borrarTipo(dbTipos, 'no-existe')).length, 2, 'borrar lo que no está no toca la fila');

// Si la fila compartida no se puede leer, el catálogo queda vacío pero el panel sigue en pie.
const dbRoto = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ error: { message: 'sin permiso' } }) }) }) }) };
assert.deepEqual(plano(await api.leerTipos(dbRoto)), []);

// ── El panel: no consulta hasta que se abre ───────────────────────────────
const panel = doc.getElementById('panel');
let lecturas = 0, filaViva = { tipos: [pdf, demo, auditoria] };
const db = {
 from(tabla) {
  if (tabla === 'lr_pros_colaboradores') return { select: () => Promise.resolve({ data: [{ usuario_id: 'u1', nombre: 'Jorge Luis' }] }) };
  if (tabla === api.TABLA) {
   return {
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { payload: filaViva } }) }) }),
    upsert: async (registro) => { filaViva = registro.payload; return {}; }
   };
  }
  lecturas += 1;
  const q = { select: () => q, eq: () => q, gte: () => q, lt: () => q, order: () => q, range: async () => ({ data: mensajes }) };
  return q;
 }
};
const hoy = { anio: 2026, mes: 11 };
api.mount(panel, db, { inicial: hoy, quien: 'Jorge Luis' });
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

// La columna de la izquierda: la línea de hitos, un punto por tipo, con cuántos salieron este mes,
// y el «+» como último hito de la misma línea. «Todos» va fuera, en la cabecera.
const etiquetas = [...panel.querySelectorAll('.acrm-msg-linea > li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
assert.deepEqual(etiquetas, ['Envío PDF 2 ✎', 'Acción/IC Demo 0 ✎', 'Auditoría 0 ✎', '+ Agregar'], etiquetas.join(' | '));
assert.equal(panel.querySelectorAll('.acrm-msg-linea > li .acrm-msg-bolita').length, 4, 'cada hito tiene su punto, incluido el de agregar');
assert.equal(panel.querySelector('.acrm-msg-todos').textContent.replace(/\s+/g, ' ').trim(), 'Todos4');

// Elegir un tipo deja el calendario con solo esos envíos.
panel.querySelector('[data-mensajes-tipo="t1"]').dispatchEvent(new dom.window.Event('click'));
assert.ok(panel.textContent.includes('2 mensajes enviados'), 'el resumen pasa a contar solo ese tipo');
assert.equal(panel.querySelectorAll('.acrm-msg-punto').length, 2, 'solo quedan los días con envíos de ese tipo');
assert.equal(panel.querySelector('[data-mensajes-dia="2026-11-10"] .acrm-msg-punto').textContent, '1', 'el día pierde el mensaje que no es de este tipo');
panel.querySelector('[data-mensajes-tipo=""]').dispatchEvent(new dom.window.Event('click'));
assert.ok(panel.textContent.includes('4 mensajes enviados'), 'volver a «Todos» devuelve el mes entero');

// Elegir un día muestra sus mensajes, con la hora de Lima y quién lo escribió.
const dia10 = panel.querySelector('[data-mensajes-dia="2026-11-10"]');
assert.ok(dia10, 'el día con envíos tiene su botón');
assert.equal(dia10.querySelector('.acrm-msg-punto').textContent, '2');
dia10.dispatchEvent(new dom.window.Event('click'));
const detalle = panel.querySelector('.acrm-msg-detalle').textContent;
assert.ok(detalle.includes('Ana <script>'), 'el nombre se lee tal cual, pero como texto');
assert.ok(detalle.includes('09:00') && detalle.includes('11:00'), detalle);
assert.ok(detalle.includes('Jorge Luis'), 'un mensaje del equipo lleva el nombre de quien lo escribió');
assert.ok(detalle.includes('Envío PDF'), 'el mensaje dice a qué tipo pertenece');
assert.equal(panel.querySelectorAll('.acrm-msg-lista > li').length, 2);
assert.equal(panel.querySelectorAll('.acrm-msg-texto a').length, 1);

const dia12 = panel.querySelector('[data-mensajes-dia="2026-11-12"]');
dia12.dispatchEvent(new dom.window.Event('click'));
assert.ok(panel.querySelector('.acrm-msg-detalle').textContent.includes('Bot'), 'lo que manda el bot no se le atribuye a nadie del equipo');

// Agregar un tipo desde el panel: el formulario conserva lo tecleado aunque se toque el calendario.
panel.querySelector('[data-mensajes-nuevo]').dispatchEvent(new dom.window.Event('click'));
const escribir = (campo, valor) => {
 const input = panel.querySelector(`[data-mensajes-campo="${campo}"]`);
 input.value = valor;
 input.dispatchEvent(new dom.window.Event('input'));
};
escribir('nombre', 'Reactivación');
escribir('sena', 'seguimos a tus órdenes');
panel.querySelector('[data-mensajes-dia="2026-11-13"]').dispatchEvent(new dom.window.Event('click'));
assert.equal(panel.querySelector('[data-mensajes-campo="nombre"]').value, 'Reactivación', 'un clic en el calendario no borra lo que se estaba escribiendo');
panel.querySelector('[data-mensajes-form]').dispatchEvent(new dom.window.Event('submit'));
await new Promise((listo) => setTimeout(listo, 0));
assert.deepEqual(plano(filaViva.tipos.map((t) => t.nombre)), ['Envío PDF', 'Acción/IC Demo', 'Auditoría', 'Reactivación'], 'el tipo nuevo se guarda en la fila compartida');
assert.equal(panel.querySelector('[data-mensajes-form]'), null, 'al guardar se cierra el formulario');
assert.ok(panel.querySelector('.acrm-msg-tipos').textContent.includes('Reactivación'));

// Una seña que se cruza con otra se avisa en el formulario y no se guarda.
panel.querySelector('[data-mensajes-nuevo]').dispatchEvent(new dom.window.Event('click'));
escribir('nombre', 'Demo otra vez');
escribir('sena', 'una demo');
panel.querySelector('[data-mensajes-form]').dispatchEvent(new dom.window.Event('submit'));
await new Promise((listo) => setTimeout(listo, 0));
assert.ok(panel.querySelector('.acrm-msg-form .acrm-msg-error').textContent.includes('Acción/IC Demo'));
assert.equal(filaViva.tipos.length, 4, 'nada se subió');
panel.querySelector('[data-mensajes-cancelar]').dispatchEvent(new dom.window.Event('click'));

// Editar trae el tipo tal como está; borrar lo saca del catálogo compartido.
panel.querySelector('[data-mensajes-editar="t3"]').dispatchEvent(new dom.window.Event('click'));
assert.equal(panel.querySelector('[data-mensajes-campo="nombre"]').value, 'Auditoría');
panel.querySelector('[data-mensajes-borrar="t3"]').dispatchEvent(new dom.window.Event('click'));
await new Promise((listo) => setTimeout(listo, 0));
assert.deepEqual(plano(filaViva.tipos.map((t) => t.nombre)), ['Envío PDF', 'Acción/IC Demo', 'Reactivación']);
assert.ok(!panel.querySelector('.acrm-msg-tipos').textContent.includes('Auditoría'));

// Sin sesión no se inventa un calendario vacío: lo dice.
api.mount(panel, null, { inicial: hoy });
const abrirSinSesion = new dom.window.Event('toggle');
abrirSinSesion.newState = 'open';
panel.dispatchEvent(abrirSinSesion);
await new Promise((listo) => setTimeout(listo, 0));
assert.ok(panel.textContent.includes('Inicia sesión'));

api.unmount();
console.log('✓ historia de mensajes: día de Lima, mes completo, calendario, catálogo de tipos y panel');
