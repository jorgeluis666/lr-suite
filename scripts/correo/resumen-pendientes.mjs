#!/usr/bin/env node
/* ============================================================
   scripts/correo/resumen-pendientes.mjs — Resumen diario de pendientes por correo.

   Lo corre .github/workflows/resumen-pendientes.yml todos los días a las 8:30 a. m. de Lima.
   Pide a Supabase los pendientes activos y la lista de correos con la función
   public.lr_suite_resumen_pendientes(clave) (src/modules/lista-pendientes/BBDD/resumen-pendientes-correo.sql)
   y manda un correo con la estética de LR Suite: cuántos pendientes hay abiertos, cuáles vencieron
   o vencen hoy y, por responsable, cada pendiente con los días que lleva desde su inicio (los mismos
   cálculos que el panel de Notificaciones de la Suite).

   Uso:
     node scripts/correo/resumen-pendientes.mjs                          # envío real
     node scripts/correo/resumen-pendientes.mjs --dry-run                # arma el correo sin enviarlo
     node scripts/correo/resumen-pendientes.mjs --preview correo.html    # escribe el correo en un archivo
     node scripts/correo/resumen-pendientes.mjs --datos datos.json ...   # usa { tareas, destinatarios } de un archivo

   Variables de entorno:
     LR_PENDIENTES_CLAVE                         → clave de la función de Supabase (secret del repo)
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

const SUITE_URL = 'https://jorgeluis666.github.io/lr-suite/';
const LOGO = new URL('assets/lima-retail-logo.png', SUITE_URL).href;
const ZONA = 'America/Lima';
// Los mismos umbrales del panel de Notificaciones (NOTIF_WARN_DAYS y NOTIF_LATE_DAYS en index.html).
const DIAS_AVISO = 4;
const DIAS_ATRASO = 8;
const TAREA_SUBTAREAS = 9;

// ── Datos ─────────────────────────────────────────────────────
// La URL y la clave publicable de Supabase son las del panel (lr-suite-config.js): no son secretas.
function supabaseConfig() {
  const archivo = fs.readFileSync(path.join(ROOT, 'lr-suite-config.js'), 'utf8');
  const url = process.env.SUPABASE_URL || (archivo.match(/url:\s*"([^"]+)"/) || [])[1];
  const key = process.env.SUPABASE_KEY || (archivo.match(/anonKey:\s*"([^"]+)"/) || [])[1];
  if (!url || !key) throw new Error('no se encontró la URL o la clave publicable de Supabase en lr-suite-config.js');
  return { url, key };
}

async function leerResumen() {
  if (DATOS) return JSON.parse(fs.readFileSync(DATOS, 'utf8'));
  const clave = process.env.LR_PENDIENTES_CLAVE;
  if (!clave) throw new Error('falta LR_PENDIENTES_CLAVE (la clave que muestra resumen-pendientes-correo.sql)');
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/rest/v1/rpc/lr_suite_resumen_pendientes`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_clave: clave }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${(body && (body.message || body.hint)) || 'sin detalle'}`);
  return body;
}

// ── Fechas (Lima) ─────────────────────────────────────────────
const diaLima = valor => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(valor));
const claveDia = valor => (String(valor || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
const diasEntre = (desde, hasta) => Math.floor((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);
const fechaCorta = clave => {
  const [y, m, d] = clave.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
};
const fechaLarga = clave => {
  const [y, m, d] = clave.split('-').map(Number);
  const texto = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};
const normal = texto => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

// ── Pendientes ────────────────────────────────────────────────
// Igual que pendingNotificationItems() del panel: los días se cuentan desde la fecha de inicio (o la
// de creación) y un pendiente se marca atrasado con fecha vencida o con 8 días o más.
function pendientes(tareas, hoy) {
  return (Array.isArray(tareas) ? tareas : [])
    .filter(t => Array.isArray(t) && String(t[0] || '').trim())
    .map(t => {
      const inicio = claveDia(t[5]) || (t[7] ? diaLima(t[7]) : '') || hoy;
      const vence = claveDia(t[2]);
      const dias = Math.max(0, diasEntre(inicio, hoy));
      const subtareas = Array.isArray(t[TAREA_SUBTAREAS]) ? t[TAREA_SUBTAREAS] : [];
      const cerradas = subtareas.filter(s => normal(s && s.status) === 'completado').length;
      const vencido = Boolean(vence && vence < hoy);
      return {
        titulo: String(t[0]).trim(),
        responsable: String(t[1] || '').trim() || 'Sin asignar',
        estado: String(t[3] || 'Pendiente').trim(),
        prioridad: String(t[4] || '').trim(),
        inicio, vence, dias, vencido,
        venceHoy: vence === hoy,
        subtareas: subtareas.length,
        abiertas: Math.max(0, subtareas.length - cerradas),
        tono: vencido || dias >= DIAS_ATRASO ? 'atraso' : dias >= DIAS_AVISO ? 'aviso' : '',
      };
    })
    // Primero lo vencido, luego lo que vence hoy y después por días desde el inicio.
    .sort((a, b) => Number(b.vencido) - Number(a.vencido) || Number(b.venceHoy) - Number(a.venceHoy) || b.dias - a.dias || a.titulo.localeCompare(b.titulo, 'es'));
}

// ── Correo ────────────────────────────────────────────────────
// Estética de LR Suite: fondo #f6f9fc, tarjetas blancas con borde #dce3ef y radio 12px, azul #2563eb y
// los días de cada pendiente como en el panel (azul suave a los 4 días, azul lleno a los 8 o vencido).
// Todo en tablas y estilos en línea para Gmail y Outlook.
const C = {
  bg: '#f6f9fc', card: '#ffffff', line: '#dce3ef', lineSoft: '#e2e8f0', head: '#f8fafc',
  ink: '#0f172a', muted: '#475569', subtle: '#64748b', brand: '#2563eb', brandSoft: '#eff6ff', brandLine: '#bfdbfe',
  rose: '#e11d48', roseSoft: '#fff1f2', amber: '#d97706', amberSoft: '#fffbeb', gray: '#f1f5f9',
};
const FONT = "Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

const pill = (texto, fg, bg, bd) =>
  `<span style="display:inline-block;background:${bg};color:${fg};border:1px solid ${bd};border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600;white-space:nowrap;">${texto}</span>`;

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

const etiqueta = texto =>
  `<div style="font-size:11px;font-weight:700;color:${C.subtle};text-transform:uppercase;letter-spacing:0.08em;margin:0 0 10px;">${texto}</div>`;

const tarjeta = cuerpo =>
  `<tr><td style="padding:12px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:12px;">
      <tr><td style="padding:20px;font-family:${FONT};">${cuerpo}</td></tr>
    </table>
  </td></tr>`;

function kpi(etiquetaKpi, valor, color, sub) {
  return `<td valign="top" style="background:${C.card};border:1px solid ${C.line};border-radius:12px;padding:12px 14px;font-family:${FONT};">
    <div style="font-size:10px;font-weight:700;color:${C.subtle};text-transform:uppercase;letter-spacing:0.1em;">${etiquetaKpi}</div>
    <div style="font-size:22px;font-weight:700;color:${color};margin-top:6px;">${valor}</div>
    <div style="font-size:11px;color:${C.subtle};margin-top:4px;">${sub}</div>
  </td>`;
}

function armarCorreo(lista, hoy) {
  const vencidos = lista.filter(p => p.vencido).length;
  const venceHoy = lista.filter(p => p.venceHoy).length;
  const atrasados = lista.filter(p => p.dias >= DIAS_ATRASO).length;
  const porResponsable = new Map();
  lista.forEach(p => {
    if (!porResponsable.has(p.responsable)) porResponsable.set(p.responsable, []);
    porResponsable.get(p.responsable).push(p);
  });
  const grupos = [...porResponsable.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'es'));

  const asunto = lista.length
    ? `LR Suite · Pendientes del ${fechaCorta(hoy)}: ${plural(lista.length, 'abierto', 'abiertos')}${vencidos ? `, ${plural(vencidos, 'vencido', 'vencidos')}` : ''}${venceHoy ? `, ${venceHoy} ${venceHoy === 1 ? 'vence' : 'vencen'} hoy` : ''}`
    : `LR Suite · Pendientes del ${fechaCorta(hoy)}: sin pendientes abiertos`;

  const resumen = lista.length
    ? [`${vencidos} con fecha vencida`, `${venceHoy} ${venceHoy === 1 ? 'vence' : 'vencen'} hoy`, `${atrasados} con ${DIAS_ATRASO} días o más`].join(' · ')
    : 'No hay pendientes abiertos en la Suite.';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<title>LR Suite · Resumen de pendientes</title>
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
            <div style="font-size:12px;color:${C.subtle};margin-top:3px;">Lima Retail · Lista de pendientes</div>
          </td>
          <td align="right" style="padding:14px 20px;">${pill(esc(fechaCorta(hoy)), '#1d4ed8', C.brandSoft, C.brandLine)}</td>
        </tr>
      </table>
    </td></tr>

    ${tarjeta(`
      ${etiqueta(`Resumen de pendientes · ${esc(fechaLarga(hoy))}`)}
      <div style="font-size:20px;font-weight:700;color:${C.ink};">${lista.length ? `${plural(lista.length, 'pendiente abierto', 'pendientes abiertos')}` : 'Sin pendientes abiertos'}</div>
      <div style="font-size:14px;color:${C.muted};margin-top:6px;line-height:1.5;">${esc(resumen)}</div>
      ${lista.length ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
        <tr>
          ${kpi('Abiertos', lista.length, C.ink, plural(grupos.length, 'responsable', 'responsables'))}
          <td width="8" style="width:8px;"></td>
          ${kpi('Vencidos', vencidos, vencidos ? C.rose : C.ink, 'Fecha de fin pasada')}
          <td width="8" style="width:8px;"></td>
          ${kpi('Vencen hoy', venceHoy, venceHoy ? C.amber : C.ink, 'Fecha de fin hoy')}
          <td width="8" style="width:8px;"></td>
          ${kpi(`${DIAS_ATRASO}+ días`, atrasados, atrasados ? C.brand : C.ink, 'Desde su inicio')}
        </tr>
      </table>` : ''}
    `)}

    ${grupos.map(([responsable, items]) => tarjeta(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:15px;font-weight:700;color:${C.ink};font-family:${FONT};">${esc(responsable)}</td>
          <td align="right">${pill(plural(items.length, 'pendiente', 'pendientes'), C.muted, C.gray, C.lineSoft)}</td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border:1px solid ${C.line};border-radius:10px;border-collapse:separate;border-spacing:0;">
        ${items.map(filaPendiente).join('')}
      </table>
    `)).join('')}

    <tr><td align="center" style="padding:22px 0 8px;">
      <a href="${SUITE_URL}" style="display:inline-block;background:${C.brand};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:9px;font-size:14px;font-weight:600;font-family:${FONT};">Abrir la lista de pendientes</a>
    </td></tr>
    <tr><td align="center" style="padding:8px 0 0;font-size:11px;line-height:1.6;color:${C.subtle};font-family:${FONT};">
      Llega todos los días a las 8:30 a. m. Los días se cuentan desde la fecha de inicio de cada pendiente.<br>
      Los correos que lo reciben se cambian con la ruedita del panel de Notificaciones de LR Suite.
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
async function enviar(destinatarios, asunto, html) {
  const faltan = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter(nombre => !process.env[nombre]);
  if (faltan.length) throw new Error(`faltan ${faltan.join(', ')} (correo del hosting)`);
  const { default: nodemailer } = await import('nodemailer');
  const port = Number(process.env.SMTP_PORT) || 465;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const info = await transporter.sendMail({
    from: `LR Suite <${process.env.SMTP_USER}>`,
    to: destinatarios.map(d => d.email),
    subject: asunto,
    html,
  });
  return info.messageId || '(sin id)';
}

async function main() {
  const hoy = diaLima(Date.now());
  const datos = await leerResumen();
  const lista = pendientes(datos.tareas, hoy);
  const destinatarios = (Array.isArray(datos.destinatarios) ? datos.destinatarios : []).filter(d => d && d.email);
  const { asunto, html } = armarCorreo(lista, hoy);
  const para = destinatarios.map(d => (d.nombre ? `${d.nombre} <${d.email}>` : d.email)).join(', ');

  console.log(`▶ Resumen de pendientes · ${hoy}`);
  console.log(`  Pendientes : ${lista.length} (${lista.filter(p => p.vencido).length} vencidos, ${lista.filter(p => p.venceHoy).length} vencen hoy)`);
  console.log(`  Asunto     : ${asunto}`);
  console.log(`  Para       : ${para || '(nadie)'}`);

  if (PREVIEW) {
    fs.writeFileSync(PREVIEW, html, 'utf8');
    console.log(`🖼  Vista previa escrita en ${PREVIEW} (sin envío).`);
    return;
  }
  if (DRY_RUN) {
    console.log('[DRY-RUN] Sin envío.');
    return;
  }
  if (!destinatarios.length) {
    console.log('⏭  La lista de correos está vacía: no se envía.');
    return;
  }
  const id = await enviar(destinatarios, asunto, html);
  console.log(`✅ Correo enviado por el correo del hosting (${process.env.SMTP_HOST}). ID: ${id}`);
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
