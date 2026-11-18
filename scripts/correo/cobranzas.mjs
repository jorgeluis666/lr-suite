import {pathToFileURL} from 'node:url';

export const REMITENTE = 'administracion@limaretail.com';
export const ASUNTO = 'Aviso de saldo pendiente de regularización - Lima Retail';
// El equipo puede editar este texto desde el módulo; esto es solo el punto de partida.
export const MENSAJE = `Estimados,

Nos ponemos en contacto desde la agencia Lima Retail para recordarles que mantenemos registrada una deuda pendiente a su nombre. Les solicitamos amablemente su apoyo para regularizar este pago a la brevedad posible. Si ya realizaron el abono correspondiente, por favor omitan este mensaje. En caso contrario, les pedimos nos contacten respondiendo a este correo o a través de nuestros canales habituales para coordinar el comprobante o resolver cualquier duda.

Quedamos atentos a su respuesta.

Administración & Contabilidad
Work: 937 409 733
www.limaretail.com`;

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Solo direcciones www.algo: se aplica sobre el texto YA escapado, así que no puede inyectar HTML.
const enlazarWeb = texto => texto.replace(/\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<]*)?/gi,
  direccion => `<a href="https://${direccion}">${direccion}</a>`);

// El aviso se edita desde el módulo y vive en la base. Si la tabla todavía no está instalada
// —o la fila quedó vacía— se envía el texto de este archivo, que es el mismo que siembra el SQL.
export async function cargarPlantilla(db) {
  try {
    const {rows} = await db.query('select asunto, cuerpo from public.lr_suite_cobranzas_mensaje where id = 1');
    const fila = rows[0];
    if (fila?.asunto?.trim() && fila?.cuerpo?.trim()) return {asunto: fila.asunto, cuerpo: fila.cuerpo};
  } catch { /* instalación anterior a la tabla del mensaje */ }
  return {asunto: ASUNTO, cuerpo: MENSAJE};
}
export function configurarSeguimiento(env) {
  const remitente = env.COBRANZAS_REMITENTE || REMITENTE;
  if (!/^[a-z0-9._+-]+@limaretail\.com$/i.test(remitente)) throw new Error('El remitente debe ser un buzón verificado de limaretail.com');
  let trackingUrl = '';
  if (env.COBRANZAS_TRACKING_URL) {
    const url = new URL(env.COBRANZAS_TRACKING_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('La URL de seguimiento debe ser HTTPS y no contener credenciales ni parámetros');
    trackingUrl = url.href;
  }
  return {remitente, trackingUrl};
}

// La reserva y el historial se confirman ANTES de SMTP para evitar duplicados tras una caída.
// El bloqueo posterior serializa el envío y los cambios de pago/pausa.
export async function enviarContacto(db, transporter, id, dia, options = {}) {
  const {remitente, trackingUrl} = configurarSeguimiento({
    COBRANZAS_REMITENTE: options.remitente, COBRANZAS_TRACKING_URL: options.trackingUrl,
  });
  // Fuera de la transacción: una lectura fallida aquí no debe abortar el envío en curso.
  const plantilla = options.plantilla || await cargarPlantilla(db);
  const reserva = await db.query(`with reservado as (
    update public.lr_suite_cobranzas set ultimo_intento = $2::date
    where id = $1 and estado = 'pendiente' and not seguimiento_pausado
      and (ultimo_intento is null or ultimo_intento < $2::date) returning id
  ) insert into public.lr_suite_cobranzas_envios(contacto_id, dia, remitente, seguimiento_apertura)
    select id, $2::date, $3, $4 from reservado returning id, token_apertura`, [id, dia, remitente, Boolean(trackingUrl)]);
  if (!reserva.rowCount) return 'omitido';
  const intento = reserva.rows[0];
  await db.query('begin');
  try {
    const {rows} = await db.query(`select email, estado, seguimiento_pausado,
      (now() at time zone 'America/Lima')::date = $2::date as mismo_dia
      from public.lr_suite_cobranzas where id = $1 for update`, [id, dia]);
    const contacto = rows[0];
    if (!contacto || contacto.estado !== 'pendiente' || contacto.seguimiento_pausado || !contacto.mismo_dia) {
      await db.query("update public.lr_suite_cobranzas_envios set estado='cancelado' where id=$1", [intento.id]);
      await db.query('commit');
      return 'omitido';
    }
    const pixel = trackingUrl ? `<img src="${escapeHtml(trackingUrl)}?token=${intento.token_apertura}" width="1" height="1" alt="">` : '';
    const result = await transporter.sendMail({
      from: remitente, replyTo: remitente, to: {address: contacto.email}, subject: plantilla.asunto, text: plantilla.cuerpo,
      // Los saltos sueltos (la firma) se conservan con <br>; el doble salto separa párrafos.
      // La web de la firma queda enlazada; el resto del texto se escapa antes, nunca después.
      html: plantilla.cuerpo.split('\n\n')
        .map(p => `<p>${enlazarWeb(escapeHtml(p)).replace(/\n/g, '<br>')}</p>`).join('') + pixel,
    });
    if (!result.accepted?.length || result.rejected?.length) throw Object.assign(new Error('SMTP rechazó el destinatario'), {rechazoSmtp:true, responseCode:result.rejectedErrors?.[0]?.responseCode});
    await db.query('update public.lr_suite_cobranzas set ultimo_envio = now() where id = $1', [id]);
    await db.query("update public.lr_suite_cobranzas_envios set estado='aceptado_smtp' where id=$1", [intento.id]);
    await db.query('commit');
    return 'enviado';
  } catch (error) {
    await db.query('rollback');
    const codigo = Number.isInteger(error.responseCode) ? error.responseCode : null;
    const rechazado = error.rechazoSmtp === true || (codigo >= 500 && codigo <= 599);
    await db.query('update public.lr_suite_cobranzas_envios set estado=$2, codigo_smtp=$3 where id=$1', [intento.id, rechazado ? 'rechazado' : 'error', codigo]);
    // Un 5xx necesita revisión; no se cambia de identidad ni se insiste automáticamente.
    if (rechazado) await db.query('update public.lr_suite_cobranzas set seguimiento_pausado=true where id=$1', [id]);
    throw error;
  }
}

export async function main(env = process.env) {
  const dryRun = env.DRY_RUN !== 'false';
  const seguimiento = configurarSeguimiento(env);
  const required = ['COBRANZAS_DATABASE_URL', ...(dryRun ? [] : ['COBRANZAS_SMTP_HOST','COBRANZAS_SMTP_USER','COBRANZAS_SMTP_PASS'])];
  const missing = required.filter(k => !env[k]);
  if (missing.length) throw new Error(`Faltan secretos: ${missing.join(', ')}`);
  const {default: pg} = await import('pg');
  const db = new pg.Client({connectionString: env.COBRANZAS_DATABASE_URL, connectionTimeoutMillis: 15000});
  let transporter;
  await db.connect();
  try {
    const {rows: [{dia}]} = await db.query("select to_char(now() at time zone 'America/Lima', 'YYYY-MM-DD') as dia");
    const {rows} = await db.query(`select id from public.lr_suite_cobranzas
      where estado = 'pendiente' and not seguimiento_pausado and (ultimo_intento is null or ultimo_intento < $1::date) order by id`, [dia]);
    if (dryRun) {
      console.log(`Simulación: ${rows.length} contactos elegibles. No se reservó ni envió ningún correo.`);
      return;
    }
    // Una sola lectura del aviso para toda la tanda: lo que se envía hoy es lo mismo para todos.
    const plantilla = await cargarPlantilla(db);
    const {default: nodemailer} = await import('nodemailer');
    const port = Number(env.COBRANZAS_SMTP_PORT || 465);
    if (![465,587].includes(port)) throw new Error('COBRANZAS_SMTP_PORT debe ser 465 o 587');
    transporter = nodemailer.createTransport({
      host: env.COBRANZAS_SMTP_HOST, port, secure: port === 465, requireTLS: true,
      auth: {user: env.COBRANZAS_SMTP_USER, pass: env.COBRANZAS_SMTP_PASS},
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000,
    });
    // Fallar antes de reservar contactos si la cuenta no autentica.
    await transporter.verify();
    let enviados = 0, fallos = 0;
    for (const {id} of rows) {
      try { if (await enviarContacto(db, transporter, id, dia, {...seguimiento, plantilla}) === 'enviado') enviados++; }
      catch {
        // No imprimir direcciones ni mensajes SMTP (pueden contener datos del contacto).
        fallos++;
        console.error(`Falló un envío; revisar los contactos sin confirmación del día ${dia}.`);
      }
    }
    console.log(`Cobranzas ${dia}: ${enviados} enviados, ${fallos} fallidos.`);
    if (fallos) throw new Error('Hubo envíos sin confirmación. No se reintentan automáticamente hoy para evitar duplicados.');
  } finally {
    transporter?.close();
    await db.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
