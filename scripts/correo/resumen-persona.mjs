#!/usr/bin/env node
/* ============================================================
   scripts/correo/resumen-persona.mjs — El resumen personal de pendientes, a la 1 y a las 5 p. m.

   Lo corre .github/workflows/resumen-persona.yml dos veces al día, lanzado por pg_cron
   (src/modules/lista-pendientes/BBDD/resumen-persona-hora-exacta.sql).

   A diferencia del correo de gasto, este no es uno para todos: es UNO POR PERSONA, con sus
   cifras. Cada quien recibe cuántos pendientes cerró y cuántas tareas internas marcó hoy, cuánto
   lleva trabajado, qué le queda abierto y qué tiene vencido, más una línea de cómo va el equipo.

   El control se cuenta con las mismas reglas que `pendingScoreForUser()` del index.html:
     · Pendientes: los del historial del mes, sin las eliminadas, firmados por quien los cerró.
     · Tareas internas: las subtareas marcadas en los pendientes abiertos, más la cuenta que cada
       pendiente cerrado se llevó consigo (`subtasksDoneByUser`).
   Si cambia una de las dos cuentas, cambia la otra, o el correo y el tablero dirán cifras
   distintas del mismo día.

   Uso:
     node scripts/correo/resumen-persona.mjs                          # envío real
     node scripts/correo/resumen-persona.mjs --dry-run                # arma los correos sin enviarlos
     node scripts/correo/resumen-persona.mjs --preview correo.html    # escribe el primero en un archivo
     node scripts/correo/resumen-persona.mjs --corte cierre           # fuerza el corte (mediodia | cierre)
     node scripts/correo/resumen-persona.mjs --datos datos.json       # usa { personas, tareas, cerrados, tiempos }

   Variables de entorno:
     LR_PERSONA_CLAVE                            → clave de la función de Supabase (secret del repo)
     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  → cuenta de correo del hosting (alertas@limaretail.com)
     DRY_RUN=true                                → equivale a --dry-run
     SUPABASE_URL, SUPABASE_KEY                  → opcionales: por defecto, los de lr-suite-config.js
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argValue = flag => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : null);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
const PREVIEW = argValue('--preview');
const DATOS = argValue('--datos');
const CORTE_PEDIDO = (argValue('--corte') || process.env.CORTE || '').trim().toLowerCase();

const SUITE_URL = 'https://jorgeluis666.github.io/lr-suite/';
const LOGO = new URL('assets/lima-retail-logo.png', SUITE_URL).href;
const ZONA = 'America/Lima';
// Los mismos umbrales del panel de Notificaciones (NOTIF_WARN_DAYS y NOTIF_LATE_DAYS en index.html).
const DIAS_AVISO = 4;
const DIAS_ATRASO = 8;
const TAREA_SUBTAREAS = 9;
// El corte de la 1 p. m. se llama «medio día» hasta las 3; después, «cierre del día».
const HORA_CIERRE = 15;

// ── Datos ─────────────────────────────────────────────────────
// La URL y la clave publicable de Supabase son las del panel (lr-suite-config.js): no son secretas.
function supabaseConfig() {
  const archivo = fs.readFileSync(path.join(ROOT, 'lr-suite-config.js'), 'utf8');
  const url = process.env.SUPABASE_URL || (archivo.match(/url:\s*"([^"]+)"/) || [])[1];
  const key = process.env.SUPABASE_KEY || (archivo.match(/anonKey:\s*"([^"]+)"/) || [])[1];
  if (!url || !key) throw new Error('no se encontró la URL o la clave publicable de Supabase en lr-suite-config.js');
  return { url, key };
}

async function leerDatos() {
  if (DATOS) return JSON.parse(fs.readFileSync(DATOS, 'utf8'));
  const clave = process.env.LR_PERSONA_CLAVE;
  if (!clave) throw new Error('falta LR_PERSONA_CLAVE (la clave que muestra resumen-persona-correo.sql)');
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/rest/v1/rpc/lr_suite_resumen_persona`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_clave: clave }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${(body && (body.message || body.hint)) || 'sin detalle'}`);
  return body;
}

// ── Fechas y personas (igual que el index.html) ───────────────
const diaLima = valor => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(valor));
const horaLima = valor => Number(new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', hour12: false }).format(new Date(valor)));
const claveDia = valor => (String(valor || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
const diaDeFecha = valor => claveDia(valor) || (valor ? diaLima(valor) : '');
const mesDeDia = dia => (String(dia || '').match(/^(\d{4}-\d{2})/) || [])[1] || '';
const diasEntre = (desde, hasta) => Math.floor((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);
const fechaCorta = clave => {
  const [y, m, d] = String(clave).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
};
const fechaLarga = clave => {
  const [y, m, d] = String(clave).split('-').map(Number);
  const texto = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};
const mesLargo = mes => {
  const [y, m] = String(mes).split('-').map(Number);
  const texto = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};
const normal = texto => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

// La misma identidad que suitePersonKey() del index.html: los cierres se firman con el nombre del
// tablero («Jorge Luis», «Diego»), los cronómetros con el correo, y las dos cosas tienen que caer
// en la misma persona.
function personaClave(valor) {
  const texto = normal(valor);
  if (texto.includes('jorge')) return 'jorge';
  if (texto.includes('diego')) return 'diego';
  return texto;
}

const minutos = segundos => `${Math.floor(Number(segundos || 0) / 60)} min`;
const duracion = segundos => {
  const total = Math.max(0, Math.floor(Number(segundos || 0)));
  const horas = Math.floor(total / 3600);
  const resto = Math.floor((total % 3600) / 60);
  if (!horas && !resto) return '0 min';
  if (!horas) return `${resto} min`;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
};

// ── El control: cuánto cerró cada persona ─────────────────────
// Dos cuentas, no una: pendientes cerrados y tareas internas marcadas. Las eliminadas no cuentan,
// porque borrar algo no es haberlo hecho.
function controlDe(clave, datos, hoy, mes) {
  const cerrados = Array.isArray(datos.cerrados) ? datos.cerrados : [];
  const tareas = Array.isArray(datos.tareas) ? datos.tareas : [];
  const control = { pendientesDia: 0, pendientesMes: 0, tareasDia: 0, tareasMes: 0 };

  cerrados.forEach(registro => {
    if (!registro || normal(registro.accion) === 'eliminada') return;
    const dia = diaDeFecha(registro.completadoEn);
    if (personaClave(registro.completadoPor || registro.responsable) === clave) {
      if (dia === hoy) control.pendientesDia += 1;
      if (mesDeDia(dia) === mes) control.pendientesMes += 1;
    }
    // Las tareas internas que el pendiente se llevó al cerrarse, por su propio día.
    Object.entries(registro.tareas || {}).forEach(([dia, porPersona]) => {
      const hechas = Number((porPersona || {})[clave] || 0);
      if (!hechas) return;
      if (dia === hoy) control.tareasDia += hechas;
      if (mesDeDia(dia) === mes) control.tareasMes += hechas;
    });
  });

  tareas.forEach(tarea => {
    subtareasDe(tarea).forEach(subtarea => {
      if (normal(subtarea.status) !== 'completado') return;
      if (personaClave(subtarea.completedBy || subtarea.owner || tarea[1]) !== clave) return;
      const dia = diaDeFecha(subtarea.completedAt);
      if (!dia) return;
      if (dia === hoy) control.tareasDia += 1;
      if (mesDeDia(dia) === mes) control.tareasMes += 1;
    });
  });

  return control;
}

const subtareasDe = tarea => (Array.isArray(tarea) && Array.isArray(tarea[TAREA_SUBTAREAS]) ? tarea[TAREA_SUBTAREAS] : []).filter(Boolean);

// Los segundos trabajados hoy: los que ya quedaron guardados más el tramo del cronómetro que esté
// corriendo. Sin ese tramo, el correo de la 1 no vería la mañana de quien no ha pausado todavía.
function trabajadoHoy(clave, datos, hoy) {
  const porDia = (datos.tiempos && datos.tiempos.porDia) || {};
  let total = Number((porDia[hoy] || {})[clave] || 0);
  const corriendo = (datos.tiempos && datos.tiempos.corriendo) || {};
  const vistos = new Set();
  [...Object.values(corriendo.activeById || {}), ...Object.values(corriendo.activeByKey || {})].forEach(entrada => {
    if (!entrada || !entrada.startedAt) return;
    if (personaClave(entrada.userKey || entrada.userName) !== clave) return;
    // La misma entrada puede estar en las dos listas (por id y por huella): se cuenta una vez.
    const huella = `${entrada.startedAt}`;
    if (vistos.has(huella)) return;
    vistos.add(huella);
    const desde = Math.max(Number(entrada.startedAt), Date.parse(`${hoy}T00:00:00-05:00`));
    total += Math.max(0, Math.floor((Date.now() - desde) / 1000));
  });
  return total;
}

// ── Los pendientes de cada persona ────────────────────────────
// Igual que pendingNotificationItems() del panel: los días se cuentan desde la fecha de inicio (o
// la de creación) y un pendiente se marca atrasado con fecha vencida o con 8 días o más.
function pendientesDe(clave, datos, hoy) {
  return (Array.isArray(datos.tareas) ? datos.tareas : [])
    .filter(t => Array.isArray(t) && String(t[0] || '').trim())
    .filter(t => personaClave(t[1]) === clave)
    .map(t => {
      const inicio = claveDia(t[5]) || (t[7] ? diaLima(t[7]) : '') || hoy;
      const vence = claveDia(t[2]);
      const dias = Math.max(0, diasEntre(inicio, hoy));
      const subtareas = subtareasDe(t);
      const cerradas = subtareas.filter(s => normal(s.status) === 'completado').length;
      const vencido = Boolean(vence && vence < hoy);
      return {
        titulo: String(t[0]).trim(),
        estado: String(t[3] || 'Pendiente').trim(),
        prioridad: String(t[4] || '').trim(),
        inicio, vence, dias, vencido,
        venceHoy: vence === hoy,
        subtareas: subtareas.length,
        abiertas: Math.max(0, subtareas.length - cerradas),
        tono: vencido || dias >= DIAS_ATRASO ? 'atraso' : dias >= DIAS_AVISO ? 'aviso' : '',
      };
    })
    .sort((a, b) => Number(b.vencido) - Number(a.vencido) || Number(b.venceHoy) - Number(a.venceHoy) || b.dias - a.dias || a.titulo.localeCompare(b.titulo, 'es'));
}

// ── Correo ────────────────────────────────────────────────────
// Estética de LR Suite: fondo #f6f9fc, tarjetas blancas con borde #dce3ef y radio 12px, azul
// #2563eb. Todo en tablas y estilos en línea para Gmail y Outlook.
const C = {
  bg: '#f6f9fc', card: '#ffffff', line: '#dce3ef', lineSoft: '#e2e8f0',
  ink: '#0f172a', muted: '#475569', subtle: '#64748b', brand: '#2563eb', brandSoft: '#eff6ff', brandLine: '#bfdbfe',
  rose: '#e11d48', amber: '#d97706', gray: '#f1f5f9',
};
const FONT = "Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

const pill = (texto, fg, bg, bd) =>
  `<span style="display:inline-block;background:${bg};color:${fg};border:1px solid ${bd};border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600;white-space:nowrap;">${texto}</span>`;

const etiqueta = texto =>
  `<div style="font-size:11px;font-weight:700;color:${C.subtle};text-transform:uppercase;letter-spacing:0.08em;margin:0 0 10px;">${texto}</div>`;

const tarjeta = cuerpo =>
  `<tr><td style="padding:12px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:12px;">
      <tr><td style="padding:20px;font-family:${FONT};">${cuerpo}</td></tr>
    </table>
  </td></tr>`;

// Las tarjetas KPI del tablero: rótulo y número en 700, rótulo en gris azulado y número en tinta.
function kpi(rotulo, valor, sub, color = C.ink) {
  return `<td valign="top" style="background:${C.card};border:1px solid ${C.line};border-radius:12px;padding:12px 14px;font-family:${FONT};">
    <div style="font-size:10px;font-weight:700;color:${C.subtle};text-transform:uppercase;letter-spacing:0.1em;">${rotulo}</div>
    <div style="font-size:22px;font-weight:700;color:${color};margin-top:6px;">${valor}</div>
    <div style="font-size:11px;color:${C.subtle};margin-top:4px;">${sub}</div>
  </td>`;
}

function diasBadge(p) {
  const estilo = p.tono === 'atraso'
    ? `background:${C.brand};color:#ffffff;`
    : p.tono === 'aviso' ? `background:${C.brandSoft};color:#1d4ed8;` : `background:${C.gray};color:${C.muted};`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="right" style="border-collapse:separate;"><tr>
    <td align="center" style="${estilo}border-radius:8px;padding:4px 8px;min-width:44px;font-family:${FONT};">
      <div style="font-size:15px;font-weight:700;line-height:1.1;">${p.dias}</div>
      <div style="font-size:9px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">${p.dias === 1 ? 'día' : 'días'}</div>
    </td></tr></table>`;
}

function filaPendiente(p, i) {
  const borde = i ? `border-top:1px solid ${C.lineSoft};` : '';
  const detalle = [p.estado, p.prioridad ? `Prioridad ${p.prioridad}` : '', p.subtareas ? `${p.abiertas}/${p.subtareas} tareas por cerrar` : '']
    .filter(Boolean).map(esc).join(' · ');
  const fecha = p.vence
    ? (p.vencido
      ? `<span style="color:${C.rose};font-weight:600;">Venció el ${fechaCorta(p.vence)}</span>`
      : p.venceHoy ? `<span style="color:${C.amber};font-weight:600;">Vence hoy</span>` : `Vence el ${fechaCorta(p.vence)}`)
    : 'Sin fecha de fin';
  return `<tr>
    <td style="padding:10px 12px;${borde}font-family:${FONT};">
      <div style="font-size:13px;font-weight:600;color:${C.ink};">${esc(p.titulo)}</div>
      <div style="font-size:12px;color:${C.subtle};margin-top:3px;">${detalle}</div>
      <div style="font-size:12px;color:${C.subtle};margin-top:2px;">Inicio ${fechaCorta(p.inicio)} · ${fecha}</div>
    </td>
    <td width="64" valign="middle" style="padding:10px 12px;${borde}">${diasBadge(p)}</td>
  </tr>`;
}

function filaEquipo(fila, i, propio) {
  const borde = i ? `border-top:1px solid ${C.lineSoft};` : '';
  const fondo = propio ? `background:${C.brandSoft};` : '';
  return `<tr>
    <td style="padding:9px 12px;${borde}${fondo}font-family:${FONT};font-size:13px;font-weight:${propio ? 700 : 600};color:${C.ink};">${esc(fila.nombre)}${propio ? ' · tú' : ''}</td>
    <td align="right" style="padding:9px 12px;${borde}${fondo}font-family:${FONT};font-size:13px;font-weight:700;color:${C.ink};">${fila.control.pendientesDia}</td>
    <td align="right" style="padding:9px 12px;${borde}${fondo}font-family:${FONT};font-size:13px;font-weight:700;color:${C.ink};">${fila.control.tareasDia}</td>
    <td align="right" style="padding:9px 12px;${borde}${fondo}font-family:${FONT};font-size:12px;color:${C.muted};">${esc(minutos(fila.segundos))}</td>
  </tr>`;
}

// El titular: lo que la persona tiene que leer sin abrir nada más.
function titular(control, corte) {
  if (!control.pendientesDia && !control.tareasDia) {
    return corte === 'cierre' ? 'Hoy no cerraste nada' : 'Todavía no cierras nada hoy';
  }
  const partes = [];
  if (control.pendientesDia) partes.push(plural(control.pendientesDia, 'pendiente cerrado', 'pendientes cerrados'));
  if (control.tareasDia) partes.push(plural(control.tareasDia, 'tarea interna hecha', 'tareas internas hechas'));
  return partes.join(' y ');
}

function armarCorreo({ persona, control, segundos, lista, equipo, corte, hoy, mes }) {
  const vencidos = lista.filter(p => p.vencido).length;
  const venceHoy = lista.filter(p => p.venceHoy).length;
  const atrasados = lista.filter(p => p.dias >= DIAS_ATRASO).length;
  const corteTexto = corte === 'cierre' ? 'Cierre del día' : 'Medio día';

  // El nombre completo, el mismo con el que firma sus cierres en el tablero: en la bandeja se lee
  // «Medio día de Jorge Luis», no «de Jorge», que es otra persona en potencia.
  const asunto = `LR Suite · ${corteTexto} de ${persona.nombre}: ${titular(control, corte).toLowerCase()}`
    + (vencidos ? ` · ${plural(vencidos, 'vencido', 'vencidos')}` : '');

  const cierre = corte === 'cierre'
    ? 'Es el cierre del día: lo que quede abierto arranca mañana en el tablero.'
    : 'Es el corte del mediodía: queda media jornada por delante.';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<title>LR Suite · Tu resumen de pendientes</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${FONT};color:${C.ink};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};">
  <tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;font-family:${FONT};">

    <!-- Encabezado: la marca como en la barra lateral de la Suite -->
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:12px;">
        <tr>
          <td style="padding:14px 12px 14px 20px;width:44px;" width="44"><img src="${LOGO}" width="44" height="44" alt="Lima Retail" style="display:block;width:44px;height:44px;border:0;"></td>
          <td style="padding:14px 0;">
            <div style="font-size:18px;font-weight:800;color:${C.ink};line-height:1.1;">LR Suite</div>
            <div style="font-size:12px;color:${C.subtle};margin-top:3px;">Lima Retail · Tus pendientes</div>
          </td>
          <td align="right" style="padding:14px 20px;">${pill(esc(`${corteTexto} · ${fechaCorta(hoy)}`), '#1d4ed8', C.brandSoft, C.brandLine)}</td>
        </tr>
      </table>
    </td></tr>

    ${tarjeta(`
      ${etiqueta(`${esc(persona.nombre)} · ${esc(fechaLarga(hoy))}`)}
      <div style="font-size:20px;font-weight:700;color:${C.ink};">${esc(titular(control, corte))}</div>
      <div style="font-size:14px;color:${C.muted};margin-top:6px;line-height:1.5;">${esc(`${duracion(segundos)} de trabajo registrados hoy. ${cierre}`)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
        <tr>
          ${kpi('Cerrados hoy', control.pendientesDia, 'Pendientes terminados')}
          <td width="8" style="width:8px;"></td>
          ${kpi('Tareas hoy', control.tareasDia, 'Tareas internas marcadas')}
          <td width="8" style="width:8px;"></td>
          ${kpi('Trabajado hoy', esc(minutos(segundos)), 'Cronómetros del tablero')}
          <td width="8" style="width:8px;"></td>
          ${kpi('Abiertos', lista.length, vencidos ? `${plural(vencidos, 'vencido', 'vencidos')}` : 'A tu nombre', vencidos ? C.rose : C.ink)}
        </tr>
      </table>
    `)}

    ${tarjeta(`
      ${etiqueta(`Tu control de ${esc(mesLargo(mes))}`)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          ${kpi('Pendientes del mes', control.pendientesMes, 'Cerrados por ti este mes')}
          <td width="8" style="width:8px;"></td>
          ${kpi('Tareas del mes', control.tareasMes, 'Tareas internas marcadas por ti')}
        </tr>
      </table>
    `)}

    ${lista.length ? tarjeta(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:15px;font-weight:700;color:${C.ink};font-family:${FONT};">Lo que te queda abierto</td>
          <td align="right">${pill(esc([
            `${plural(lista.length, 'pendiente', 'pendientes')}`,
            vencidos ? `${plural(vencidos, 'vencido', 'vencidos')}` : '',
            venceHoy ? `${venceHoy} ${venceHoy === 1 ? 'vence' : 'vencen'} hoy` : '',
            atrasados ? `${atrasados} de ${DIAS_ATRASO}+ días` : '',
          ].filter(Boolean).join(' · ')), C.muted, C.gray, C.lineSoft)}</td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border:1px solid ${C.line};border-radius:10px;border-collapse:separate;border-spacing:0;">
        ${lista.map(filaPendiente).join('')}
      </table>
    `) : tarjeta(`
      ${etiqueta('Lo que te queda abierto')}
      <div style="font-size:14px;color:${C.muted};line-height:1.5;">No tienes pendientes abiertos a tu nombre en el tablero.</div>
    `)}

    ${equipo.length > 1 ? tarjeta(`
      ${etiqueta('El equipo hoy')}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:10px;border-collapse:separate;border-spacing:0;">
        <tr>
          <td style="padding:8px 12px;font-family:${FONT};font-size:10px;font-weight:700;color:${C.subtle};text-transform:uppercase;letter-spacing:0.08em;">Persona</td>
          <td align="right" style="padding:8px 12px;font-family:${FONT};font-size:10px;font-weight:700;color:${C.subtle};text-transform:uppercase;letter-spacing:0.08em;">Cerrados</td>
          <td align="right" style="padding:8px 12px;font-family:${FONT};font-size:10px;font-weight:700;color:${C.subtle};text-transform:uppercase;letter-spacing:0.08em;">Tareas</td>
          <td align="right" style="padding:8px 12px;font-family:${FONT};font-size:10px;font-weight:700;color:${C.subtle};text-transform:uppercase;letter-spacing:0.08em;">Trabajado</td>
        </tr>
        ${equipo.map((fila, i) => filaEquipo(fila, i + 1, fila.clave === persona.clave)).join('')}
      </table>
    `) : ''}

    <tr><td align="center" style="padding:22px 0 8px;">
      <a href="${SUITE_URL}" style="display:inline-block;background:${C.brand};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:9px;font-size:14px;font-weight:600;font-family:${FONT};">Abrir mis pendientes</a>
    </td></tr>
    <tr><td align="center" style="padding:8px 0 0;font-size:11px;line-height:1.6;color:${C.subtle};font-family:${FONT};">
      Llega a la 1 y a las 5 de la tarde, de lunes a viernes. Un pendiente cuenta cuando se cierra;<br>
      una tarea interna, cuando se marca. Los días se cuentan desde la fecha de inicio de cada pendiente.
    </td></tr>

  </table>
  </td></tr>
</table>
</body>
</html>`;
  return { asunto, html };
}

// ── Envío por el correo del hosting (SMTP) ────────────────────
// El remitente es la misma cuenta que se autentica: los hostings rechazan un "From" de otra cuenta.
async function transporte() {
  const faltan = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter(nombre => !process.env[nombre]);
  if (faltan.length) throw new Error(`faltan ${faltan.join(', ')} (correo del hosting)`);
  const { default: nodemailer } = await import('nodemailer');
  const port = Number(process.env.SMTP_PORT) || 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function main() {
  const hoy = diaLima(Date.now());
  const corte = ['mediodia', 'cierre'].includes(CORTE_PEDIDO)
    ? CORTE_PEDIDO
    : horaLima(Date.now()) >= HORA_CIERRE ? 'cierre' : 'mediodia';
  const datos = await leerDatos();
  const mes = String(datos.mes || '').match(/^\d{4}-\d{2}$/) ? datos.mes : mesDeDia(hoy);

  const personas = (Array.isArray(datos.personas) ? datos.personas : [])
    .filter(p => p && p.email)
    .map(p => ({ email: String(p.email).trim(), nombre: String(p.nombre || p.email).trim(), clave: personaClave(p.nombre || p.email) }));

  // El equipo se arma una sola vez: todos los correos llevan la misma tabla.
  const equipo = personas
    .map(p => ({ ...p, control: controlDe(p.clave, datos, hoy, mes), segundos: trabajadoHoy(p.clave, datos, hoy) }))
    .sort((a, b) => b.control.pendientesDia - a.control.pendientesDia || b.control.tareasDia - a.control.tareasDia || a.nombre.localeCompare(b.nombre, 'es'));

  console.log(`▶ Resumen personal de pendientes · ${hoy} · corte ${corte}`);
  console.log(`  Personas : ${personas.length ? personas.map(p => p.nombre).join(', ') : '(ninguna)'}`);
  equipo.forEach(fila => {
    console.log(`  ${fila.nombre.padEnd(12)}: ${fila.control.pendientesDia} cerrados, ${fila.control.tareasDia} tareas, ${minutos(fila.segundos)} · mes: ${fila.control.pendientesMes} y ${fila.control.tareasMes}`);
  });

  const correos = equipo.map(fila => {
    const lista = pendientesDe(fila.clave, datos, hoy);
    const { asunto, html } = armarCorreo({
      persona: fila, control: fila.control, segundos: fila.segundos, lista, equipo, corte, hoy, mes,
    });
    return { persona: fila, asunto, html };
  });

  correos.forEach(correo => console.log(`  Asunto   : ${correo.persona.email} → ${correo.asunto}`));

  if (PREVIEW) {
    if (!correos.length) throw new Error('no hay ninguna persona de la que armar la vista previa');
    fs.writeFileSync(PREVIEW, correos[0].html, 'utf8');
    console.log(`🖼  Vista previa de ${correos[0].persona.nombre} escrita en ${PREVIEW} (sin envío).`);
    return;
  }
  if (DRY_RUN) {
    console.log('[DRY-RUN] Sin envío.');
    return;
  }
  if (!correos.length) {
    console.log('⏭  No hay cuentas de la Suite a las que escribir: no se envía.');
    return;
  }

  const mailer = await transporte();
  // Un correo por persona, y si uno falla se intentan los demás: el resumen de cada quien es
  // independiente, y que a Diego le rebote el correo no tiene por qué dejar a Jorge Luis sin el suyo.
  const fallos = [];
  for (const correo of correos) {
    try {
      const info = await mailer.sendMail({
        from: `LR Suite <${process.env.SMTP_USER}>`,
        to: `${correo.persona.nombre} <${correo.persona.email}>`,
        subject: correo.asunto,
        html: correo.html,
      });
      console.log(`✅ ${correo.persona.email} · ID ${info.messageId || '(sin id)'}`);
    } catch (error) {
      fallos.push(`${correo.persona.email}: ${error.message}`);
      console.error(`❌ ${correo.persona.email}: ${error.message}`);
    }
  }
  if (fallos.length === correos.length) throw new Error(`no se pudo enviar ningún correo (${fallos[0]})`);
  if (fallos.length) throw new Error(`quedaron ${fallos.length} correos sin enviar: ${fallos.join(' · ')}`);
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
