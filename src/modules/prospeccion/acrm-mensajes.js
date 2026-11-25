// Historia de mensajes del CRM: un calendario de lo que salió de casa, día por día.
//
// La ficha de cada lead ya muestra su hilo, pero nadie podía responder «¿qué mandamos la semana
// pasada?» sin abrir lead por lead. Esta vista lee los mensajes enviados (lr_acrm_mensajes con
// direccion='enviado': los escribe el equipo, el bot de WhatsApp o el webhook) y los reparte en el
// calendario del mes, con el detalle del día que se elija.
//
// El primer envío con el que arrancó esto es un mensaje que lleva el enlace de un PDF, así que los
// enlaces no se muestran como texto plano: cada uno sale como enlace y los que apuntan a un PDF
// quedan marcados, para ver de un vistazo a cuántos prospectos les llegó el documento.
//
// El día es el de Lima, no el del navegador: el equipo trabaja ahí y un envío de las 21:00 no puede
// aparecer al día siguiente porque quien mira está en otro huso.
//
// Esta vista solo lee. La dibuja ella misma dentro del popover del index.html (#acrmMensajes).
// Prueba: tests/acrm/mensajes.mjs.
(function () {
"use strict";

const ZONA = 'America/Lima';
// Un mes de envíos cabe de sobra; el tope evita que un mes cargado deje el panel colgado.
const TOPE = 3000;
const PAGINA = 500;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fallo = (e) => Object.assign(new Error(String(e?.message || e)), { causa: e });

const DIA = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });
const HORA = new Intl.DateTimeFormat('es-PE', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false });
const MES_LARGO = new Intl.DateTimeFormat('es-PE', { timeZone: ZONA, month: 'long', year: 'numeric' });
const DIA_LARGO = new Intl.DateTimeFormat('es-PE', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long' });

const SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const CANALES = { linkedin: 'LinkedIn', meta_whatsapp: 'WhatsApp', ads_library: 'Ads Library', directo: 'Directo' };
const ORIGENES = { manual: 'Equipo', agente: 'Bot', webhook: 'Automático' };

// ── Fechas ────────────────────────────────────────────────────────────────
// El día de Lima de una marca de tiempo, como 'AAAA-MM-DD'.
const diaLima = (valor) => {
 const d = new Date(valor);
 if (Number.isNaN(d.getTime())) return '';
 return DIA.format(d);
};
const horaLima = (valor) => {
 const d = new Date(valor);
 return Number.isNaN(d.getTime()) ? '' : HORA.format(d);
};

// Perú no mueve el reloj: su medianoche son las 05:00 UTC del mismo día, todo el año.
const inicioDeMes = (anio, mes) => new Date(Date.UTC(anio, mes - 1, 1, 5, 0, 0));
// El mes que se está viendo, como {anio, mes} con mes de 1 a 12.
function rangoMes(anio, mes) {
 const desde = inicioDeMes(anio, mes);
 const hasta = mes === 12 ? inicioDeMes(anio + 1, 1) : inicioDeMes(anio, mes + 1);
 return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}
const mesDeHoy = () => {
 const [anio, mes] = diaLima(new Date()).split('-');
 return { anio: Number(anio), mes: Number(mes) };
};
const mesVecino = ({ anio, mes }, paso) => {
 const total = anio * 12 + (mes - 1) + paso;
 return { anio: Math.floor(total / 12), mes: (total % 12) + 1 };
};
const clave = ({ anio, mes }, dia) => `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

// Las casillas del calendario: huecos hasta el primer día y la semana empieza en lunes.
function celdas({ anio, mes }) {
 const primero = new Date(Date.UTC(anio, mes - 1, 1));
 const hueco = (primero.getUTCDay() + 6) % 7;
 const dias = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
 const lista = Array.from({ length: hueco }, () => null);
 for (let dia = 1; dia <= dias; dia += 1) lista.push(dia);
 while (lista.length % 7) lista.push(null);
 return lista;
}

// ── Enlaces ───────────────────────────────────────────────────────────────
const RE_ENLACE = /https?:\/\/[^\s<>"')\]]+/gi;
const limpiar = (url) => url.replace(/[.,;:!?)\]]+$/, '');
const esPdf = (url) => /\.pdf(?:[?#]|$)/i.test(limpiar(String(url || '')));
const enlacesDe = (texto) => (String(texto || '').match(RE_ENLACE) || []).map(limpiar);

// El texto del mensaje con sus enlaces pulsables. Se escapa trozo a trozo: lo que se inserta como
// HTML nunca es el texto crudo, ni siquiera dentro del href.
function textoHtml(texto) {
 const crudo = String(texto || '');
 let html = '';
 let desde = 0;
 RE_ENLACE.lastIndex = 0;
 for (let m = RE_ENLACE.exec(crudo); m; m = RE_ENLACE.exec(crudo)) {
  const url = limpiar(m[0]);
  html += esc(crudo.slice(desde, m.index));
  html += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;
  if (esPdf(url)) html += '<span class="acrm-msg-pdf">PDF</span>';
  desde = m.index + url.length;
 }
 return html + esc(crudo.slice(desde));
}

// ── Lectura ───────────────────────────────────────────────────────────────
// Todos los mensajes enviados del mes, con el nombre y el canal de su lead.
async function mensajesDelMes(client, mes, activo = () => true) {
 const { desde, hasta } = rangoMes(mes.anio, mes.mes);
 const filas = [];
 for (let pagina = 0; filas.length < TOPE; pagina += 1) {
  const r = await client.from('lr_acrm_mensajes')
   .select('id,captura,texto,enviado_en,autor,origen,lr_acrm_capturas(nombre,canal)')
   .eq('direccion', 'enviado')
   .gte('enviado_en', desde).lt('enviado_en', hasta)
   .order('enviado_en', { ascending: true })
   .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
  if (!activo()) return null;
  if (r.error) throw fallo(r.error);
  const lote = r.data || [];
  filas.push(...lote);
  if (lote.length < PAGINA) break;
 }
 return { mensajes: filas.slice(0, TOPE), recortado: filas.length >= TOPE };
}

// Los mensajes por día de Lima, ya ordenados por hora.
function porDia(mensajes) {
 const mapa = new Map();
 for (const m of mensajes || []) {
  const dia = diaLima(m.enviado_en);
  if (!dia) continue;
  if (!mapa.has(dia)) mapa.set(dia, []);
  mapa.get(dia).push(m);
 }
 for (const lista of mapa.values()) lista.sort((a, b) => String(a.enviado_en).localeCompare(String(b.enviado_en)));
 return mapa;
}

const resumenDe = (mensajes) => {
 const total = (mensajes || []).length;
 const conEnlace = (mensajes || []).filter((m) => enlacesDe(m.texto).length).length;
 const conPdf = (mensajes || []).filter((m) => enlacesDe(m.texto).some(esPdf)).length;
 return { total, conEnlace, conPdf };
};

// ── Pantalla ──────────────────────────────────────────────────────────────
let root = null, client = null, epoch = 0;
let mes = mesDeHoy(), dia = '', datos = null, equipo = new Map(), error = '', cargando = false, cargado = '';

const quien = (m) => (m.origen === 'manual' ? equipo.get(m.autor) || 'Equipo' : ORIGENES[m.origen] || 'Equipo');

function detalleHtml(lista) {
 if (!lista.length) return '<p class="acrm-msg-vacio">No se envió ningún mensaje este día.</p>';
 return `<ol class="acrm-msg-lista">${lista.map((m) => {
  const captura = m.lr_acrm_capturas || {};
  const canal = CANALES[captura.canal] || '';
  return `<li>
   <div class="acrm-msg-fila">
    <span class="acrm-msg-hora">${esc(horaLima(m.enviado_en))}</span>
    <strong class="acrm-msg-lead">${esc(captura.nombre || m.captura || 'Lead sin nombre')}</strong>
    ${canal ? `<span class="acrm-msg-canal">${esc(canal)}</span>` : ''}
    <span class="acrm-msg-autor">${esc(quien(m))}</span>
   </div>
   <p class="acrm-msg-texto">${textoHtml(m.texto)}</p>
  </li>`;
 }).join('')}</ol>`;
}

function render() {
 if (!root?.isConnected) return;
 const mapa = porDia(datos?.mensajes);
 const hoy = diaLima(new Date());
 const elegido = dia;
 const resumen = resumenDe(datos?.mensajes);
 const titulo = MES_LARGO.format(inicioDeMes(mes.anio, mes.mes));
 const dias = celdas(mes).map((n) => {
  if (!n) return '<span class="acrm-msg-dia vacio" aria-hidden="true"></span>';
  const k = clave(mes, n);
  const cuantos = mapa.get(k)?.length || 0;
  const clases = ['acrm-msg-dia'];
  if (cuantos) clases.push('con');
  if (k === hoy) clases.push('hoy');
  if (k === elegido) clases.push('sel');
  return `<button type="button" class="${clases.join(' ')}" data-mensajes-dia="${k}" aria-pressed="${k === elegido}" title="${esc(DIA_LARGO.format(new Date(k + 'T12:00:00Z')))}: ${cuantos} ${cuantos === 1 ? 'mensaje' : 'mensajes'}">
   <span class="acrm-msg-n-dia">${n}</span>${cuantos ? `<span class="acrm-msg-punto">${cuantos}</span>` : ''}</button>`;
 }).join('');

 root.innerHTML = `
  <div class="acrm-msg-head">
   <strong>Historia de mensajes</strong>
   <button class="notif-close" type="button" popovertarget="acrmMensajes" popovertargetaction="hide" aria-label="Cerrar la historia de mensajes">×</button>
  </div>
  <div class="acrm-msg-barra">
   <button class="acrm-msg-nav" type="button" data-mensajes-mes="-1" aria-label="Mes anterior">‹</button>
   <span class="acrm-msg-mes">${esc(titulo)}</span>
   <button class="acrm-msg-nav" type="button" data-mensajes-mes="1" aria-label="Mes siguiente">›</button>
   <button class="btn acrm-msg-refrescar" type="button" data-mensajes-refrescar ${cargando ? 'disabled' : ''}>${cargando ? 'Cargando…' : 'Actualizar'}</button>
  </div>
  ${error ? `<p class="acrm-msg-error" role="alert">${esc(error)}</p>` : ''}
  <p class="acrm-msg-resumen" role="status">${cargando && !datos ? 'Leyendo los envíos del mes…'
   : `${resumen.total} ${resumen.total === 1 ? 'mensaje enviado' : 'mensajes enviados'} · ${resumen.conEnlace} con enlace · ${resumen.conPdf} con PDF`}
   ${datos?.recortado ? `<span class="acrm-msg-tope">Se muestran los primeros ${TOPE}.</span>` : ''}</p>
  <div class="acrm-msg-semana" aria-hidden="true">${SEMANA.map((d) => `<span>${d}</span>`).join('')}</div>
  <div class="acrm-msg-calendario" role="group" aria-label="Días de ${esc(titulo)}">${dias}</div>
  <div class="acrm-msg-detalle">
   <p class="label">${elegido ? esc(DIA_LARGO.format(new Date(elegido + 'T12:00:00Z'))) : 'Elige un día del calendario'}</p>
   ${elegido ? detalleHtml(mapa.get(elegido) || []) : ''}
  </div>`;

 root.querySelectorAll('[data-mensajes-dia]').forEach((boton) => {
  boton.onclick = () => { dia = boton.dataset.mensajesDia; render(); };
 });
 root.querySelectorAll('[data-mensajes-mes]').forEach((boton) => {
  boton.onclick = () => {
   mes = mesVecino(mes, Number(boton.dataset.mensajesMes));
   dia = '';
   datos = null;
   void cargar();
  };
 });
 const refrescar = root.querySelector('[data-mensajes-refrescar]');
 if (refrescar) refrescar.onclick = () => void cargar(true);
}

async function cargar(forzar = false) {
 if (!root?.isConnected || cargando) return;
 const etiqueta = `${mes.anio}-${mes.mes}`;
 if (!forzar && cargado === etiqueta && datos) return;
 if (!client) { error = 'Inicia sesión para ver la historia de mensajes.'; datos = null; render(); return; }
 cargando = true; error = ''; render();
 const generacion = epoch, activo = () => epoch === generacion && Boolean(root?.isConnected);
 try {
  const [mensajes, gente] = await Promise.all([
   mensajesDelMes(client, mes, activo),
   equipo.size ? Promise.resolve(null) : client.from('lr_pros_colaboradores').select('usuario_id,nombre').then((r) => (r.error ? [] : r.data || []))
  ]);
  if (!activo()) return;
  if (Array.isArray(gente)) equipo = new Map(gente.map((p) => [p.usuario_id, p.nombre]));
  datos = mensajes;
  cargado = etiqueta;
  // Al abrir, el día que se ve es el último con envíos: casi siempre es lo que se viene a mirar.
  if (!dia) {
   const dias = [...porDia(datos?.mensajes).keys()].sort();
   const hoy = diaLima(new Date());
   const esMesActual = etiqueta === `${mesDeHoy().anio}-${mesDeHoy().mes}`;
   dia = dias.includes(hoy) ? hoy : dias.at(-1) || (esMesActual ? hoy : '');
  }
 } catch (e) {
  if (!activo()) return;
  error = 'No se pudo leer la historia de mensajes: ' + e.message;
 } finally {
  if (epoch === generacion) { cargando = false; render(); }
 }
}

function unmount() {
 epoch += 1;
 root = null; client = null; datos = null; error = ''; cargando = false; cargado = ''; dia = '';
 mes = mesDeHoy();
}

// El popover solo se lee cuando se abre: nadie paga la consulta del mes por entrar al CRM.
// `inicial` fija el mes que se abre; sin él, el de hoy. Lo usa la prueba para no depender del reloj.
function mount(element, db, { inicial } = {}) {
 unmount();
 root = element; client = db;
 if (inicial?.anio && inicial?.mes) mes = { anio: Number(inicial.anio), mes: Number(inicial.mes) };
 if (!root) return;
 root.addEventListener('toggle', (evento) => {
  if (evento.newState === 'open') void cargar();
 });
 render();
}

window.LRACRMMensajes = { mount, unmount, celdas, rangoMes, porDia, resumenDe, enlacesDe, esPdf, textoHtml, diaLima, horaLima, mesVecino, mensajesDelMes, TOPE };
})();
