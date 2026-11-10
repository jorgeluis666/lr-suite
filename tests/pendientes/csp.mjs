// Lote 19: la Content-Security-Policy mínima.
//
// No impide un XSS: con 'unsafe-inline' un onerror inyectado sigue ejecutándose. Lo que impide es
// que lo robado salga a otro servidor. Por eso lo que hay que vigilar no es que la política
// exista, sino que no le falte ningún origen que la app usa de verdad —si falta uno, se rompe en
// silencio y solo se ve en la consola— y que no le sobre ninguno.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const raiz = new URL('../../', import.meta.url);
const html = readFileSync(new URL('index.html', raiz), 'utf8');

const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
assert.ok(meta, 'no hay meta de CSP');
const politica = Object.fromEntries(
  meta[1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [nombre, ...valores] = d.split(/\s+/);
    return [nombre, valores];
  })
);

// Va antes de cualquier script: una CSP declarada después del primer <script> no lo cubre.
assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'),
  'la CSP tiene que ir antes del primer script');

// ── Los orígenes que la app usa de verdad ─────────────────────────────────
// Cada uno sale de una línea concreta del código; si alguien la cambia y no toca la CSP, esto
// falla aquí en vez de romperse en producción.
const supabase = (readFileSync(new URL('lr-suite-config.js', raiz), 'utf8').match(/url:\s*"([^"]+)"/) || [])[1];
assert.ok(supabase, 'no se pudo leer el host de Supabase de lr-suite-config.js');
const host = supabase.replace(/^https:\/\//, '');

assert.ok(politica['connect-src'].includes(supabase), 'falta el host de Supabase en connect-src: no habría login');
assert.ok(politica['connect-src'].includes(`wss://${host}`), 'falta el wss: se cae el tiempo real');
assert.ok(politica['img-src'].includes(supabase), 'las cotizaciones guardan archivos con URL firmada de Supabase');

// La librería de Supabase y el xlsx que se baja solo al exportar.
assert.ok(html.includes('https://cdn.jsdelivr.net'), 'cambió el CDN de la librería');
assert.ok(politica['script-src'].includes('https://cdn.jsdelivr.net'));
assert.ok(html.includes('https://cdnjs.cloudflare.com/ajax/libs/xlsx'), 'cambió el CDN de xlsx');
assert.ok(politica['script-src'].includes('https://cdnjs.cloudflare.com'), 'sin esto, exportar a XLS deja de funcionar');

// Palabras clave baja los informes de Drive; Anuncios pinta miniaturas y un reproductor.
assert.ok(politica['connect-src'].includes('https://docs.google.com'));
assert.ok(politica['connect-src'].includes('https://drive.google.com'));
assert.ok(politica['connect-src'].includes('https://drive.usercontent.google.com'), 'Drive redirige ahí al descargar');
assert.ok(politica['img-src'].includes('https://drive.google.com'), 'las miniaturas de Anuncios son de Drive');
// El reproductor de Anuncios es un iframe de Drive: con frame-src 'none' se vería un hueco.
assert.ok(html.includes('<iframe'), 'si ya no hay iframe, frame-src puede volver a none');
assert.ok(politica['frame-src'].includes('https://drive.google.com'));
assert.ok(!politica['frame-src'].includes("'none'"));

// ── Lo que sí tiene que estar cerrado ─────────────────────────────────────
assert.deepEqual(politica['default-src'], ["'self'"]);
assert.deepEqual(politica['object-src'], ["'none'"]);
assert.deepEqual(politica['base-uri'], ["'self'"]);
assert.deepEqual(politica['form-action'], ["'self'"]);
assert.deepEqual(politica['font-src'], ["'self'"], 'no hay @font-face: no hace falta abrirlo');
assert.equal(html.includes('@font-face'), false);
assert.deepEqual(politica['worker-src'], ["'none'"]);
assert.equal(html.includes('new Worker'), false, 'si apareciera un worker habría que abrir worker-src');

// Un comodín suelto dejaría salir los datos a cualquier parte: es justo lo que esto evita.
for (const [nombre, valores] of Object.entries(politica)) {
  assert.equal(valores.includes('*'), false, `${nombre} tiene un comodín suelto`);
  assert.equal(valores.some((v) => v === 'https:' || v === 'http:'), false, `${nombre} abre un esquema entero`);
}
// unsafe-eval nunca: no hay eval ni new Function en el archivo.
assert.equal(meta[1].includes("'unsafe-eval'"), false);
assert.equal(/[^.\w]eval\(|new Function/.test(html), false);

// Si se cambia de proyecto de Supabase hay que tocar dos sitios, y el aviso tiene que estar.
assert.match(html, /SI SE CAMBIA EL PROYECTO DE SUPABASE/);

console.log('PASS CSP: la política va antes del primer script, cubre Supabase (https y wss), los dos CDN, Drive para informes, miniaturas e iframe, y deja cerrados default, object, base, form, font y worker, sin comodines ni unsafe-eval.');
