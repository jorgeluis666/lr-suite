// Lote 13: si el arranque falla, el usuario tiene que enterarse.
//
// Antes había tres formas de quedarse sin saber nada:
//   · Un error de sintaxis en el script grande dejaba «Cargando el proyecto…» para siempre, y el
//     propio texto sugería un Ctrl+F5 que no arregla un archivo roto.
//   · Un fallo dentro de loadTaskState o loadSuiteUsers mandaba a la portada de acceso sin una
//     palabra, y parecía una sesión caída.
//   · render() vivía dentro del mismo try, así que un error dibujando un módulo borraba la sesión
//     y devolvía al login.
// Y encima se esperaban 10 segundos a una librería que, si no está, no va a llegar.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function extraer(nombre) {
  const inicio = html.indexOf(`function ${nombre}(`);
  assert.notEqual(inicio, -1, `no se encontró la función ${nombre}`);
  let i = html.indexOf('{', inicio);
  let nivel = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') nivel++;
    else if (html[i] === '}' && --nivel === 0) break;
  }
  return html.slice(inicio, i + 1);
}

// ── 1. La guardia de la cabecera ───────────────────────────────────────────
// Es un script aparte justo por esto: tiene que seguir vivo cuando el grande ni siquiera compila.
const cabecera = html.slice(0, html.indexOf('</head>'));
const guardia = cabecera.slice(cabecera.indexOf('window.LR_SUITE_BUILD ='), cabecera.indexOf('</script>'));
assert.match(guardia, /addEventListener\("error"/, 'escucha los errores sueltos');
assert.match(guardia, /addEventListener\("unhandledrejection"/, 'y las promesas rechazadas');
assert.ok(
  html.indexOf('addEventListener("error"') < html.indexOf('<script src="https://cdn.jsdelivr.net'),
  'la guardia va antes que cualquier librería: si no, no cubre el fallo de cargarlas'
);

// Se ejecuta de verdad, con un window mínimo: lo que importa es que acabe escribiendo el motivo
// en la portada, no que el código contenga las palabras correctas.
const parrafo = {textContent: 'Cargando el proyecto…'};
const oyentes = {};
const ventana = {
  LR_SUITE_BUILD: 'prueba',
  addEventListener: (tipo, fn) => (oyentes[tipo] = fn)
};
const contexto = {
  window: ventana,
  document: {querySelector: (sel) => (sel === '#app .suite-gate-text' ? parrafo : null)}
};
vm.createContext(contexto);
vm.runInContext(guardia.slice(guardia.indexOf('(function ()')), contexto);

oyentes.error({message: 'algo reventó'});
assert.match(parrafo.textContent, /LR Suite no pudo cargar \(versión prueba\)/);
assert.match(parrafo.textContent, /algo reventó/, 'dice qué falló, no un genérico');
assert.match(parrafo.textContent, /recargar no lo arregla/, 'y no promete que Ctrl + F5 lo resuelva');

// Solo avisa una vez: diez errores encadenados no deben reescribir el primero, que suele ser el
// que explica los demás.
oyentes.error({message: 'el segundo, consecuencia del primero'});
assert.match(parrafo.textContent, /algo reventó/, 'se queda con el primero');

// Una promesa rechazada también cuenta, y sin mensaje no revienta el propio aviso.
const otro = {textContent: 'Cargando…'};
const oyentes2 = {};
const contexto2 = {
  window: {LR_SUITE_BUILD: 'p2', addEventListener: (t, fn) => (oyentes2[t] = fn)},
  document: {querySelector: (sel) => (sel === '#app .suite-gate-text' ? otro : null)}
};
vm.createContext(contexto2);
vm.runInContext(guardia.slice(guardia.indexOf('(function ()')), contexto2);
oyentes2.unhandledrejection({reason: undefined});
assert.match(otro.textContent, /LR Suite no pudo cargar/);

// Una vez que el script grande arrancó, la guardia ya no pisa la portada: de ahí en adelante los
// fallos los cuentan bootSuite o render, con más contexto.
const tercero = {textContent: 'Cargando…'};
const oyentes3 = {};
const contexto3 = {
  window: {LR_SUITE_BUILD: 'p3', LR_SUITE_STARTED: true, addEventListener: (t, fn) => (oyentes3[t] = fn)},
  document: {querySelector: () => tercero}
};
vm.createContext(contexto3);
vm.runInContext(guardia.slice(guardia.indexOf('(function ()')), contexto3);
oyentes3.error({message: 'ya con la suite en marcha'});
assert.equal(tercero.textContent, 'Cargando…');

// El indicador se pone al final del script grande, no al principio: puesto arriba dejaría sin
// cubrir todo lo que se ejecuta después, que es casi todo.
const indicador = html.indexOf('window.LR_SUITE_STARTED = true;');
assert.ok(indicador > html.indexOf('async function bootSuite()'), 'el indicador va después de bootSuite');

// ── 2. bootSuite no se come el motivo ni borra la sesión al dibujar ────────
const boot = extraer('bootSuite');
assert.match(boot, /state\.suiteAccessError =\s*\n?\s*`LR Suite no pudo iniciar/, 'el motivo llega a la portada');
assert.match(boot, /window\.LR_SUITE_BUILD/, 'con la versión, para saber qué build falló');
assert.match(boot, /app\.textContent = state\.suiteAccessError/, 'y si ni la portada se dibuja, queda texto plano');
const cuerpo = boot.slice(boot.indexOf('} catch'));
assert.match(cuerpo, /\n        render\(\);/, 'render() se llama fuera del try');
assert.doesNotMatch(boot.slice(0, boot.indexOf('} catch')), /render\(\)/,
  'render() ya no está dentro del try: un error dibujando no puede borrar la sesión');

// El arranque va contra DOMContentLoaded y con .catch: antes se llamaba suelto y una promesa
// rechazada no la recogía nadie.
const arranque = html.slice(html.indexOf('const arrancarSuite ='), html.indexOf('</script>', html.indexOf('const arrancarSuite =')));
assert.match(arranque, /bootSuite\(\)\.catch\(/);
assert.match(arranque, /document\.readyState === "loading"/, 'y funciona aunque el DOM ya esté listo');

// ── 3. Un módulo roto no se lleva la suite por delante ─────────────────────
const render = extraer('render');
assert.match(render, /try \{[\s\S]*tasksModule\(\)[\s\S]*financialModule\(\)[\s\S]*\} catch/,
  'el despacho de módulos entero va en try, del primero al último');
assert.match(render, /renderModuleFailure\(error, visibleModules\)/);
const fallo = extraer('renderModuleFailure');
assert.match(fallo, /No se pudo mostrar este módulo/);
assert.match(fallo, /data-modulo-alternativo/, 'y deja un botón para salir a otro módulo');
assert.match(fallo, /escapeHtml\(error\?\.message/, 'el mensaje del error se escapa antes de pintarlo');

// ── 4. Esperar diez segundos a una librería que no va a llegar ─────────────
const espera = extraer('waitForSharedPendingLibrary');
assert.doesNotMatch(espera, /10000|setTimeout/, 'ya no hay espera: la librería está o no está');
const motivo = extraer('motivoSinLibreria');
assert.match(motivo, /cdn\.jsdelivr\.net/, 'distingue la librería bloqueada');
assert.match(motivo, /lr-suite-config\.js/, 'de la configuración que falta');
assert.match(extraer('restoreSuiteAccessSession'), /state\.suiteAccessError = motivo/,
  'restaurar sesión sin librería ya no devuelve al login en silencio');
assert.match(extraer('authenticateSuiteUser'), /if \(motivo\) return \{ error: motivo \}/);

// Y el texto de carga ya no promete que recargar arregla un archivo roto.
assert.match(html, /Si no avanza en unos segundos, recarga con Ctrl \+ F5; si sigue igual, avisa a Jorge Luis/);

console.log('PASS arranque visible: la guardia de la cabecera escribe el motivo en la portada, bootSuite no se lo come ni borra la sesión al dibujar, un módulo roto deja salida, y la librería ausente se dice al instante en vez de esperar diez segundos.');
