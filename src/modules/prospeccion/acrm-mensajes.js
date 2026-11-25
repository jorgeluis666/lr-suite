// Historia de mensajes del CRM: qué mensajes manda la casa y cuándo salió cada uno.
//
// La ficha de cada lead ya muestra su hilo, pero nadie podía responder «¿qué mandamos la semana
// pasada?» sin abrir lead por lead. Esta vista lee los mensajes enviados (lr_acrm_mensajes con
// direccion='enviado': los escribe el equipo, el bot de WhatsApp o el webhook) y los reparte en el
// calendario del mes, con el detalle del día que se elija.
//
// A la izquierda está el catálogo: los tipos de mensaje que manda la casa. El primero es el envío
// del PDF, con el que arrancó esto, y al lado va cuántos salieron en el mes que se mira; un tipo
// recién creado enseña un cero, que también es una respuesta. Elegir uno deja el calendario con
// solo esos envíos.
//
// Un tipo no guarda el mensaje —para eso están las plantillas de la ficha (acrm-plantillas.js)—:
// guarda su nombre y una seña, el enlace o la frase por la que se reconoce. Así cuenta también lo
// que ya se había enviado antes de crearlo, sin tocar la base ni el momento del envío. La seña es
// lo único delicado: dos tipos con señas que se solapan cuentan el mismo mensaje dos veces, y por
// eso el formulario avisa antes de guardar.
//
// El catálogo es del equipo, no de cada navegador: vive en Supabase, en la fila compartida
// lr_suite_private_data con la clave «acrm-mensajes-tipos», la misma mecánica que las plantillas.
// Cada escritura relee la fila y fusiona antes de subir, para no pisar lo que otro acaba de crear.
//
// El día es el de Lima, no el del navegador: el equipo trabaja ahí y un envío de las 21:00 no puede
// aparecer al día siguiente porque quien mira está en otro huso.
//
// Los mensajes solo se leen. La vista se dibuja dentro del popover del index.html (#acrmMensajes).
// Prueba: tests/acrm/mensajes.mjs.
(function () {
"use strict";

const ZONA = 'America/Lima';
// Un mes de envíos cabe de sobra; el tope evita que un mes cargado deje el panel colgado.
const TOPE = 3000;
const PAGINA = 500;
const TABLA = 'lr_suite_private_data';
const CLAVE = 'acrm-mensajes-tipos';
const LIMITE_TIPOS = 40;
const LARGO_NOMBRE = 60;
const LARGO_SENA = 200;
const COLORES = ['#2563eb', '#0d9488', '#7c3aed', '#db2777', '#ea580c', '#0891b2', '#65a30d', '#b45309'];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fallo = (e) => Object.assign(new Error(String(e?.message || e)), { causa: e });
const limpio = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);
// Para comparar: sin tildes, sin mayúsculas y sin dobles espacios. «Envío PDF» y «envio pdf» son lo mismo.
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

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
 return Number.isNaN(d.getTime()) ? '' : DIA.format(d);
};
const horaLima = (valor) => {
 const d = new Date(valor);
 return Number.isNaN(d.getTime()) ? '' : HORA.format(d);
};

// Perú no mueve el reloj: su medianoche son las 05:00 UTC del mismo día, todo el año.
const inicioDeMes = (anio, mes) => new Date(Date.UTC(anio, mes - 1, 1, 5, 0, 0));
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
const recortar = (url) => url.replace(/[.,;:!?)\]]+$/, '');
const esPdf = (url) => /\.pdf(?:[?#]|$)/i.test(recortar(String(url || '')));
const enlacesDe = (texto) => (String(texto || '').match(RE_ENLACE) || []).map(recortar);

// El texto del mensaje con sus enlaces pulsables. Se escapa trozo a trozo: lo que se inserta como
// HTML nunca es el texto crudo, ni siquiera dentro del href.
function textoHtml(texto) {
 const crudo = String(texto || '');
 let html = '';
 let desde = 0;
 RE_ENLACE.lastIndex = 0;
 for (let m = RE_ENLACE.exec(crudo); m; m = RE_ENLACE.exec(crudo)) {
  const url = recortar(m[0]);
  html += esc(crudo.slice(desde, m.index));
  html += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;
  if (esPdf(url)) html += '<span class="acrm-msg-pdf">PDF</span>';
  desde = m.index + url.length;
 }
 return html + esc(crudo.slice(desde));
}

// ── El catálogo de tipos ──────────────────────────────────────────────────
const nuevoId = () => `tm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// Lo que se guarda de un tipo, o null si le falta lo imprescindible. Sin seña no se puede contar
// nada, así que un tipo a medias no entra al catálogo.
function normalizarTipo(t) {
 const nombre = limpio(t?.nombre, LARGO_NOMBRE);
 const sena = limpio(t?.sena, LARGO_SENA);
 if (!nombre || norm(sena).length < 3) return null;
 const creadoEn = Number(t?.creadoEn);
 return {
  id: limpio(t?.id, 60) || nuevoId(),
  nombre,
  sena,
  creadoPor: limpio(t?.creadoPor, 120),
  creadoEn: Number.isFinite(creadoEn) && creadoEn > 0 ? creadoEn : Date.now()
 };
}

// La lista limpia de varias fuentes: sin repetidos por id ni por seña —gana el más nuevo—,
// en el orden en que se crearon y recortada al tope.
function fusionarTipos(...fuentes) {
 const porId = new Map();
 for (const fuente of fuentes) {
  for (const crudo of Array.isArray(fuente) ? fuente : []) {
   const t = normalizarTipo(crudo);
   if (!t) continue;
   const previo = porId.get(t.id);
   if (!previo || t.creadoEn >= previo.creadoEn) porId.set(t.id, t);
  }
 }
 const porSena = new Map();
 for (const t of porId.values()) {
  const previo = porSena.get(norm(t.sena));
  if (!previo || t.creadoEn > previo.creadoEn) porSena.set(norm(t.sena), t);
 }
 return [...porSena.values()].sort((a, b) => a.creadoEn - b.creadoEn).slice(0, LIMITE_TIPOS);
}

// Dos señas que se solapan cuentan el mismo mensaje dos veces: se avisa antes de guardar, no después.
function senaChocaCon(tipos, tipo) {
 const sena = norm(tipo?.sena);
 if (!sena) return null;
 return (tipos || []).find((otro) => otro.id !== tipo.id && (norm(otro.sena).includes(sena) || sena.includes(norm(otro.sena)))) || null;
}

// Un mensaje es de este tipo si su texto lleva la seña.
const esDelTipo = (mensaje, tipo) => Boolean(tipo) && norm(mensaje?.texto).includes(norm(tipo.sena));
const delTipo = (mensajes, tipo) => (tipo ? (mensajes || []).filter((m) => esDelTipo(m, tipo)) : (mensajes || []).slice());
const contarPorTipo = (mensajes, tipos) => new Map((tipos || []).map((t) => [t.id, delTipo(mensajes, t).length]));

async function leerTipos(client) {
 const r = await client.from(TABLA).select('payload').eq('key', CLAVE).maybeSingle();
 // El catálogo es un extra: si la fila no existe o la cuenta no la puede leer, el calendario se
 // dibuja igual y lo que falta es la columna de la izquierda, no la historia.
 if (r.error) { console.warn('ACRM: no se pudo leer el catálogo de mensajes', r.error.message); return []; }
 return fusionarTipos(r.data?.payload?.tipos);
}

async function subirTipos(client, tipos, quien) {
 const r = await client.from(TABLA).upsert(
  { key: CLAVE, payload: { tipos, actualizadoPor: limpio(quien, 120) }, updated_at: new Date().toISOString() },
  { onConflict: 'key' }
 );
 if (r.error) throw fallo(r.error);
 return tipos;
}

// Crear o cambiar un tipo: se relee la fila y se fusiona, para no borrar lo que otro acaba de crear.
async function guardarTipo(client, entrada, { quien = '' } = {}) {
 const actuales = await leerTipos(client);
 const previo = entrada?.id ? actuales.find((t) => t.id === entrada.id) : null;
 const tipo = normalizarTipo({ ...entrada, creadoPor: previo?.creadoPor || quien, creadoEn: previo?.creadoEn || Date.now() });
 if (!tipo) throw new Error('Un tipo necesita un nombre y una seña de al menos 3 letras.');
 if (!previo && actuales.length >= LIMITE_TIPOS) throw new Error(`Ya hay ${LIMITE_TIPOS} tipos: borra alguno antes de crear otro.`);
 const choque = senaChocaCon(actuales, tipo);
 if (choque) throw new Error(`Esa seña se cruza con «${choque.nombre}»: el mismo mensaje contaría para los dos.`);
 const tipos = fusionarTipos(actuales.filter((t) => t.id !== tipo.id), [tipo]);
 await subirTipos(client, tipos, quien);
 return { tipos, tipo };
}

async function borrarTipo(client, id, { quien = '' } = {}) {
 const actuales = await leerTipos(client);
 const tipos = actuales.filter((t) => t.id !== id);
 if (tipos.length === actuales.length) return actuales;
 return subirTipos(client, tipos, quien);
}

// ── Lectura de los envíos ─────────────────────────────────────────────────
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

const resumenDe = (mensajes) => ({
 total: (mensajes || []).length,
 conEnlace: (mensajes || []).filter((m) => enlacesDe(m.texto).length).length,
 conPdf: (mensajes || []).filter((m) => enlacesDe(m.texto).some(esPdf)).length
});

// ── Pantalla ──────────────────────────────────────────────────────────────
let root = null, client = null, epoch = 0;
let mes = mesDeHoy(), dia = '', datos = null, equipo = new Map(), error = '', cargando = false, cargado = '';
let tipos = [], tipoSel = '', editando = null, guardando = false, errorTipo = '', quienSoy = '';

const tipoDe = (id) => tipos.find((t) => t.id === id) || null;
const colorDe = (id) => COLORES[Math.max(0, tipos.findIndex((t) => t.id === id)) % COLORES.length];
const autorDe = (m) => (m.origen === 'manual' ? equipo.get(m.autor) || 'Equipo' : ORIGENES[m.origen] || 'Equipo');

function detalleHtml(lista) {
 if (!lista.length) return '<p class="acrm-msg-vacio">No se envió ningún mensaje este día.</p>';
 return `<ol class="acrm-msg-lista">${lista.map((m) => {
  const captura = m.lr_acrm_capturas || {};
  const canal = CANALES[captura.canal] || '';
  const suyo = tipos.find((t) => esDelTipo(m, t));
  return `<li>
   <div class="acrm-msg-fila">
    <span class="acrm-msg-hora">${esc(horaLima(m.enviado_en))}</span>
    <strong class="acrm-msg-lead">${esc(captura.nombre || m.captura || 'Lead sin nombre')}</strong>
    ${canal ? `<span class="acrm-msg-canal">${esc(canal)}</span>` : ''}
    ${suyo ? `<span class="acrm-msg-tipo" style="--tipo:${colorDe(suyo.id)}">${esc(suyo.nombre)}</span>` : ''}
    <span class="acrm-msg-autor">${esc(autorDe(m))}</span>
   </div>
   <p class="acrm-msg-texto">${textoHtml(m.texto)}</p>
  </li>`;
 }).join('')}</ol>`;
}

function formularioHtml() {
 if (!editando) return '';
 const nuevo = !editando.id;
 return `<form class="acrm-msg-form" data-mensajes-form>
  <label>Nombre<input type="text" maxlength="${LARGO_NOMBRE}" value="${esc(editando.nombre)}" data-mensajes-campo="nombre" placeholder="Envío PDF" required></label>
  <label>Seña<input type="text" maxlength="${LARGO_SENA}" value="${esc(editando.sena)}" data-mensajes-campo="sena" placeholder="limaretail.com/presentacion.pdf" required>
   <small>El enlace o la frase que lleva este mensaje. Se cuenta cada envío que la contenga.</small></label>
  ${errorTipo ? `<p class="acrm-msg-error" role="alert">${esc(errorTipo)}</p>` : ''}
  <div class="acrm-msg-form-pie">
   <button class="btn primary" type="submit" ${guardando ? 'disabled' : ''}>${guardando ? 'Guardando…' : 'Guardar'}</button>
   <button class="btn" type="button" data-mensajes-cancelar ${guardando ? 'disabled' : ''}>Cancelar</button>
   ${nuevo ? '' : `<button class="btn acrm-msg-borrar" type="button" data-mensajes-borrar="${esc(editando.id)}" ${guardando ? 'disabled' : ''}>Borrar</button>`}
  </div>
 </form>`;
}

// El catálogo se dibuja como los hitos de la ficha: una línea vertical con un punto por tipo y, al
// final de la misma línea, el punto de «Agregar». «Todos» va arriba, fuera de la línea: no es un
// mensaje que mande la casa, es la forma de volver al mes entero.
function tiposHtml(mensajes) {
 const conteos = contarPorTipo(mensajes, tipos);
 const filas = tipos.map((t) => {
  const n = conteos.get(t.id) || 0;
  return `<li class="${t.id === tipoSel ? 'sel' : ''}">
   <span class="acrm-msg-bolita" style="background:${colorDe(t.id)}" aria-hidden="true"></span>
   <button type="button" class="acrm-msg-tipo-boton" data-mensajes-tipo="${esc(t.id)}" aria-pressed="${t.id === tipoSel}" title="${esc(t.nombre)}: ${n} este mes · seña «${esc(t.sena)}»">
    <span class="acrm-msg-tipo-nombre">${esc(t.nombre)}</span>
    <span class="acrm-msg-tipo-n ${n ? '' : 'cero'}">${n}</span>
   </button>
   <button type="button" class="acrm-msg-editar" data-mensajes-editar="${esc(t.id)}" aria-label="Editar ${esc(t.nombre)}" title="Editar ${esc(t.nombre)}">✎</button>
  </li>`;
 }).join('');
 return `<aside class="acrm-msg-tipos">
  <div class="acrm-msg-tipos-cabeza">
   <p class="acrm-msg-tipos-tit">Mensajes</p>
   <button type="button" class="acrm-msg-todos ${tipoSel ? '' : 'sel'}" data-mensajes-tipo="" aria-pressed="${!tipoSel}">Todos<span class="acrm-msg-tipo-n ${mensajes?.length ? '' : 'cero'}">${(mensajes || []).length}</span></button>
  </div>
  <ol class="acrm-msg-linea">
   ${filas}
   <li class="acrm-msg-nuevo">
    <span class="acrm-msg-bolita mas" aria-hidden="true">+</span>
    <button type="button" class="acrm-msg-mas" data-mensajes-nuevo ${editando && !editando.id ? 'disabled' : ''}>Agregar</button>
   </li>
  </ol>
  ${tipos.length ? '' : '<p class="acrm-msg-tipos-vacio">Todavía no hay tipos. Agrega el primero para medir cuántos salen.</p>'}
  ${formularioHtml()}
 </aside>`;
}

function render() {
 if (!root?.isConnected) return;
 const todos = datos?.mensajes || [];
 const activo = tipoDe(tipoSel);
 const vistos = delTipo(todos, activo);
 const mapa = porDia(vistos);
 const hoy = diaLima(new Date());
 const resumen = resumenDe(vistos);
 const titulo = MES_LARGO.format(inicioDeMes(mes.anio, mes.mes));
 const dias = celdas(mes).map((n) => {
  if (!n) return '<span class="acrm-msg-dia vacio" aria-hidden="true"></span>';
  const k = clave(mes, n);
  const cuantos = mapa.get(k)?.length || 0;
  const clases = ['acrm-msg-dia'];
  if (cuantos) clases.push('con');
  if (k === hoy) clases.push('hoy');
  if (k === dia) clases.push('sel');
  return `<button type="button" class="${clases.join(' ')}" data-mensajes-dia="${k}" aria-pressed="${k === dia}" title="${esc(DIA_LARGO.format(new Date(k + 'T12:00:00Z')))}: ${cuantos} ${cuantos === 1 ? 'mensaje' : 'mensajes'}">
   <span class="acrm-msg-n-dia">${n}</span>${cuantos ? `<span class="acrm-msg-punto">${cuantos}</span>` : ''}</button>`;
 }).join('');

 root.innerHTML = `
  <div class="acrm-msg-head">
   <strong>Historia de mensajes</strong>
   <button class="notif-close" type="button" popovertarget="acrmMensajes" popovertargetaction="hide" aria-label="Cerrar la historia de mensajes">×</button>
  </div>
  <div class="acrm-msg-cuerpo">
   ${tiposHtml(todos)}
   <div class="acrm-msg-vista">
    <div class="acrm-msg-barra">
     <button class="acrm-msg-nav" type="button" data-mensajes-mes="-1" aria-label="Mes anterior">‹</button>
     <span class="acrm-msg-mes">${esc(titulo)}</span>
     <button class="acrm-msg-nav" type="button" data-mensajes-mes="1" aria-label="Mes siguiente">›</button>
     <button class="btn acrm-msg-refrescar" type="button" data-mensajes-refrescar ${cargando ? 'disabled' : ''}>${cargando ? 'Cargando…' : 'Actualizar'}</button>
    </div>
    ${error ? `<p class="acrm-msg-error" role="alert">${esc(error)}</p>` : ''}
    <p class="acrm-msg-resumen" role="status">${cargando && !datos ? 'Leyendo los envíos del mes…'
     : `${activo ? `«${esc(activo.nombre)}»: ` : ''}${resumen.total} ${resumen.total === 1 ? 'mensaje enviado' : 'mensajes enviados'} · ${resumen.conEnlace} con enlace · ${resumen.conPdf} con PDF`}
     ${datos?.recortado ? `<span class="acrm-msg-tope">Se muestran los primeros ${TOPE}.</span>` : ''}</p>
    <div class="acrm-msg-semana" aria-hidden="true">${SEMANA.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="acrm-msg-calendario" role="group" aria-label="Días de ${esc(titulo)}">${dias}</div>
    <div class="acrm-msg-detalle">
     <p class="label">${dia ? esc(DIA_LARGO.format(new Date(dia + 'T12:00:00Z'))) : 'Elige un día del calendario'}</p>
     ${dia ? detalleHtml(mapa.get(dia) || []) : ''}
    </div>
   </div>
  </div>`;

 root.querySelectorAll('[data-mensajes-dia]').forEach((boton) => {
  boton.onclick = () => { dia = boton.dataset.mensajesDia; render(); };
 });
 root.querySelectorAll('[data-mensajes-mes]').forEach((boton) => {
  boton.onclick = () => { mes = mesVecino(mes, Number(boton.dataset.mensajesMes)); dia = ''; datos = null; void cargar(); };
 });
 root.querySelectorAll('[data-mensajes-tipo]').forEach((boton) => {
  boton.onclick = () => { tipoSel = boton.dataset.mensajesTipo; render(); };
 });
 root.querySelectorAll('[data-mensajes-editar]').forEach((boton) => {
  boton.onclick = () => {
   const t = tipoDe(boton.dataset.mensajesEditar);
   if (!t) return;
   editando = { id: t.id, nombre: t.nombre, sena: t.sena };
   errorTipo = '';
   render();
  };
 });
 const refrescar = root.querySelector('[data-mensajes-refrescar]');
 if (refrescar) refrescar.onclick = () => void cargar(true);
 const nuevo = root.querySelector('[data-mensajes-nuevo]');
 if (nuevo) nuevo.onclick = () => { editando = { id: '', nombre: '', sena: '' }; errorTipo = ''; render(); };
 const cancelar = root.querySelector('[data-mensajes-cancelar]');
 if (cancelar) cancelar.onclick = () => { editando = null; errorTipo = ''; render(); };
 const borrar = root.querySelector('[data-mensajes-borrar]');
 if (borrar) borrar.onclick = () => void quitar(borrar.dataset.mensajesBorrar);
 // Lo tecleado se guarda en el estado según se escribe: así un clic en el calendario no lo borra.
 root.querySelectorAll('[data-mensajes-campo]').forEach((campo) => {
  campo.oninput = () => { if (editando) editando[campo.dataset.mensajesCampo] = campo.value; };
 });
 const form = root.querySelector('[data-mensajes-form]');
 if (form) form.onsubmit = (evento) => { evento.preventDefault(); void aplicar(); };
}

// ── Guardar y borrar un tipo ──────────────────────────────────────────────
async function aplicar() {
 if (!editando || guardando) return;
 if (!client) { errorTipo = 'Inicia sesión para guardar un tipo.'; render(); return; }
 guardando = true; errorTipo = ''; render();
 const generacion = epoch;
 try {
  const r = await guardarTipo(client, editando, { quien: quienSoy });
  if (epoch !== generacion) return;
  tipos = r.tipos;
  tipoSel = r.tipo.id;
  editando = null;
 } catch (e) {
  if (epoch !== generacion) return;
  errorTipo = e.message;
 } finally {
  if (epoch === generacion) { guardando = false; render(); }
 }
}

async function quitar(id) {
 if (guardando || !client) return;
 guardando = true; errorTipo = ''; render();
 const generacion = epoch;
 try {
  tipos = await borrarTipo(client, id, { quien: quienSoy });
  if (epoch !== generacion) return;
  if (tipoSel === id) tipoSel = '';
  editando = null;
 } catch (e) {
  if (epoch !== generacion) return;
  errorTipo = 'No se pudo borrar: ' + e.message;
 } finally {
  if (epoch === generacion) { guardando = false; render(); }
 }
}

// ── Carga ─────────────────────────────────────────────────────────────────
async function cargar(forzar = false) {
 if (!root?.isConnected || cargando) return;
 const etiqueta = `${mes.anio}-${mes.mes}`;
 if (!forzar && cargado === etiqueta && datos) return;
 if (!client) { error = 'Inicia sesión para ver la historia de mensajes.'; datos = null; render(); return; }
 cargando = true; error = ''; render();
 const generacion = epoch, activo = () => epoch === generacion && Boolean(root?.isConnected);
 try {
  const [mensajes, gente, catalogo] = await Promise.all([
   mensajesDelMes(client, mes, activo),
   equipo.size ? Promise.resolve(null) : client.from('lr_pros_colaboradores').select('usuario_id,nombre').then((r) => (r.error ? [] : r.data || [])),
   forzar || !tipos.length ? leerTipos(client) : Promise.resolve(null)
  ]);
  if (!activo()) return;
  if (Array.isArray(gente)) equipo = new Map(gente.map((p) => [p.usuario_id, p.nombre]));
  if (Array.isArray(catalogo)) tipos = catalogo;
  if (tipoSel && !tipoDe(tipoSel)) tipoSel = '';
  datos = mensajes;
  cargado = etiqueta;
  // Al abrir, el día que se ve es el de hoy si hubo envíos, y si no el último con alguno: casi
  // siempre es lo que se viene a mirar.
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
 tipos = []; tipoSel = ''; editando = null; guardando = false; errorTipo = ''; quienSoy = '';
 mes = mesDeHoy();
}

// El popover solo se lee cuando se abre: nadie paga la consulta del mes por entrar al CRM.
// `inicial` fija el mes que se abre y `quien` firma lo que se guarde; sin ellos, el mes de hoy y
// sin firma. La prueba usa `inicial` para no depender del reloj.
function mount(element, db, { inicial, quien = '' } = {}) {
 unmount();
 root = element; client = db; quienSoy = limpio(quien, 120);
 if (inicial?.anio && inicial?.mes) mes = { anio: Number(inicial.anio), mes: Number(inicial.mes) };
 if (!root) return;
 root.addEventListener('toggle', (evento) => {
  if (evento.newState === 'open') void cargar();
 });
 render();
}

window.LRACRMMensajes = {
 mount, unmount, celdas, rangoMes, porDia, resumenDe, enlacesDe, esPdf, textoHtml, diaLima, horaLima, mesVecino, mensajesDelMes,
 normalizarTipo, fusionarTipos, senaChocaCon, esDelTipo, delTipo, contarPorTipo, leerTipos, guardarTipo, borrarTipo,
 TOPE, TABLA, CLAVE, LIMITE_TIPOS
};
})();
