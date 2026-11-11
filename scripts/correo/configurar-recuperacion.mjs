// Ejecutar solo desde Actions: reutiliza secretos existentes, nunca los imprime ni los escribe.
import nodemailer from 'nodemailer';
import { readFileSync } from 'node:fs';
const env = process.env;
for (const name of ['SUPABASE_ACCESS_TOKEN','SUPABASE_PROJECT_REF','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS']) {
  if (!env[name]) throw new Error(`Falta ${name}`);
}
if (env.SUPABASE_PROJECT_REF !== 'brfsipssqfsuoplxxcth') throw new Error('Proyecto inesperado');
const transport = nodemailer.createTransport({
  host: env.SMTP_HOST, port: Number(env.SMTP_PORT), secure: Number(env.SMTP_PORT) === 465,
  auth: {user: env.SMTP_USER, pass: env.SMTP_PASS},
  connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000
});
try { await transport.verify(); } catch { throw new Error('No se pudo verificar SMTP; no se modificó Auth.'); }
finally { transport.close(); }
const endpoint = `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/config/auth`;
async function config(method = 'GET', body) {
  const response = await fetch(endpoint, {method, headers: {
    Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json'
  }, ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`Auth config: HTTP ${response.status}`);
  return response.json();
}
const before = await config();
// No pisa un proveedor de correo cambiado por otro administrador.
if (before.smtp_host && before.smtp_host !== env.SMTP_HOST) throw new Error('Ya existe otro SMTP. Revisión necesaria.');
const callback = 'https://suite.limaretail.com/recuperar.html';
const redirects = [...new Set([...(before.uri_allow_list || '').split(',').map(s => s.trim()).filter(Boolean), callback])];
const desired = {
  smtp_host: env.SMTP_HOST, smtp_port: env.SMTP_PORT, smtp_user: env.SMTP_USER,
  smtp_pass: env.SMTP_PASS, smtp_admin_email: env.SMTP_USER, smtp_sender_name: 'LR Suite · Lima Retail',
  smtp_max_frequency: Math.max(60, Number(before.smtp_max_frequency) || 0),
  uri_allow_list: redirects.join(','),
  mailer_subjects_recovery: 'Recupera tu acceso a LR Suite',
  mailer_templates_recovery_content: readFileSync(new URL('./recuperacion.html', import.meta.url), 'utf8')
};
if (!before.site_url || /^http:\/\/localhost(?::\d+)?\/?$/.test(before.site_url)) desired.site_url = 'https://suite.limaretail.com/';
await config('PATCH', desired);
const after = await config();
for (const [key, value] of Object.entries(desired)) {
  if (key === 'smtp_pass') continue; // La API puede ocultar la contraseña.
  if (after[key] !== value) throw new Error(`No coincide la configuración guardada: ${key}`);
}
console.log('SMTP autenticado; configuración de recuperación guardada y verificada. No se enviaron correos de prueba.');
