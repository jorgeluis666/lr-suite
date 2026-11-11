// Los objetivos de cierre del día: la tercera pieza de la mañana del agente de Pendientes.
//
// A diferencia del saludo y del resumen, esta cuesta una llamada al modelo, así que lo que se
// prueba aquí es cuándo NO se pide. Cada una de estas reglas es una forma de tirar dinero o de
// molestar a la persona:
//   · Dos veces el mismo día.
//   · Antes del saludo: los objetivos son su continuación, no un mensaje suelto.
//   · Con el chat fuera de pantalla: nadie iba a leer esa respuesta.
//   · Con la conversación ya empezada: la persona estaba haciendo otra cosa.
//   · Y la marca va ANTES de enviar, para que una llamada que falla no se reintente cada minuto
//     durante todo el día.
process.env.TZ = 'America/Lima';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function extraer(nombre) {
  let inicio = html.indexOf(`function ${nombre}(`);
  assert.notEqual(inicio, -1, `no se encontró la función ${nombre}`);
  if (html.slice(inicio - 6, inicio) === 'async ') inicio -= 6;
  let i = html.indexOf('(', inicio);
  let parens = 0;
  for (; i < html.length; i++) {
    if (html[i] === '(') parens++;
    else if (html[i] === ')' && --parens === 0) break;
  }
  i = html.indexOf('{', i);
  let nivel = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') nivel++;
    else if (html[i] === '}' && --nivel === 0) break;
  }
  return html.slice(inicio, i + 1);
}

// Una const cuyo valor ocupa varias líneas y termina en «;». Se lee del archivo para que el texto
// que se prueba sea el que de verdad se le manda al modelo.
function constante(nombre) {
  const inicio = html.indexOf(`const ${nombre} =`);
  assert.notEqual(inicio, -1, `no se encontró la constante ${nombre}`);
  const fin = html.indexOf(';', html.indexOf('=', inicio));
  return html.slice(inicio, fin + 1);
}

// El banco de pruebas: todo lo que las dos funciones tocan, en versiones de mentira que dejan ver
// qué se decidió. `enviados` es la cuenta de llamadas al modelo, que es lo que se está cuidando.
function banco({marcas = {}, perfil = 'tasks', abierto = true, estado = {}, estados = {}} = {}) {
  const ctx = {
    enviados: [],
    marcas: {...marcas},
    agenteUI: {abierto},
    AGENTE_PERFILES: {
      tasks: {id: 'tasks', titulo: 'Agente IA'},
      gasto: {id: 'gasto', titulo: 'Agente de Gasto'},
      prospeccion: {id: 'prospeccion', titulo: 'Agente de Prospección'}
    },
    agenteEstados: estados,
    localDayKey: () => '2026-11-11',
    hasSuiteAccess: () => true,
    agentePerfil: () => (perfil ? {id: perfil, titulo: perfil} : null),
    agenteEstado: () => ({ocupado: false, propuesta: null, mensajes: [], avisos: [], ...estado}),
    agenteEnviar: (texto) => {
      ctx.enviados.push(texto);
    }
  };
  ctx.agenteResumenMarcado = (tipo) => String(ctx.marcas[tipo] || '');
  ctx.agenteResumenMarcar = (tipo, dia) => {
    ctx.marcas[tipo] = dia;
  };
  vm.createContext(ctx);
  vm.runInContext(
    [constante('AGENTE_OBJETIVOS_PETICION'), extraer('agenteObjetivosRevisar'), extraer('agenteAvisoPendiente')].join('\n\n'),
    ctx
  );
  return ctx;
}

const HOY = '2026-11-11';

// ── El caso bueno: saludo dado, chat abierto, conversación limpia ──────────
const bueno = banco({marcas: {apertura: HOY}});
bueno.agenteObjetivosRevisar();
assert.equal(bueno.enviados.length, 1, 'con el saludo dado y el chat abierto, se piden los objetivos');
assert.match(bueno.enviados[0], /objetivos de cierre de hoy/i);
assert.match(
  bueno.enviados[0],
  /no empieces por la foto del tablero/i,
  'la petición tiene que decirle que no repita el resumen que ya leyó'
);
assert.equal(bueno.marcas.objetivos, HOY, 'queda marcado el día');

// ── Y no se repite ─────────────────────────────────────────────────────────
bueno.agenteObjetivosRevisar();
assert.equal(bueno.enviados.length, 1, 'una vez al día y no más');

// ── Antes del saludo, no ───────────────────────────────────────────────────
const sinSaludo = banco({marcas: {}});
sinSaludo.agenteObjetivosRevisar();
assert.equal(sinSaludo.enviados.length, 0, 'sin el saludo del día, los objetivos no salen sueltos');
assert.equal(sinSaludo.marcas.objetivos, undefined, 'y tampoco se marca: mañana se vuelve a intentar');

// El saludo de AYER no vale: cada día tiene el suyo.
const saludoViejo = banco({marcas: {apertura: '2026-11-10'}});
saludoViejo.agenteObjetivosRevisar();
assert.equal(saludoViejo.enviados.length, 0, 'el saludo de ayer no abre los objetivos de hoy');

// ── Fuera de pantalla, no ──────────────────────────────────────────────────
const minimizado = banco({marcas: {apertura: HOY}, abierto: false});
minimizado.agenteObjetivosRevisar();
assert.equal(minimizado.enviados.length, 0, 'con el chat minimizado no se paga una respuesta que nadie lee');

const otroModulo = banco({marcas: {apertura: HOY}, perfil: 'gasto'});
otroModulo.agenteObjetivosRevisar();
assert.equal(otroModulo.enviados.length, 0, 'en otro módulo tampoco: el agente de Gasto no da objetivos de Pendientes');

// ── Con la persona a media conversación, no ────────────────────────────────
const conversando = banco({marcas: {apertura: HOY}, estado: {mensajes: [{role: 'user', content: 'hola'}]}});
conversando.agenteObjetivosRevisar();
assert.equal(conversando.enviados.length, 0, 'si ya hay conversación, manda la persona');

const ocupado = banco({marcas: {apertura: HOY}, estado: {ocupado: true}});
ocupado.agenteObjetivosRevisar();
assert.equal(ocupado.enviados.length, 0, 'con el modelo respondiendo no se encola otra pregunta');

const conPropuesta = banco({marcas: {apertura: HOY}, estado: {propuesta: {usos: []}}});
conPropuesta.agenteObjetivosRevisar();
assert.equal(conPropuesta.enviados.length, 0, 'con una acción esperando confirmación tampoco');

// ── La marca va antes de enviar ────────────────────────────────────────────
// Si la llamada al modelo revienta, el día queda marcado igual: un día sin objetivos se arregla
// preguntando, pero un reintento cada minuto son cientos de llamadas.
const revienta = banco({marcas: {apertura: HOY}});
revienta.agenteEnviar = () => {
  throw new Error('la red falló');
};
assert.throws(() => revienta.agenteObjetivosRevisar(), /la red falló/);
assert.equal(revienta.marcas.objetivos, HOY, 'quedó marcado aunque el envío fallara');

// ── El punto de la burbuja ─────────────────────────────────────────────────
const esperando = banco({
  perfil: 'gasto',
  estados: {tasks: {avisos: [{id: 'resumen-apertura', texto: 'Buen día', visto: false}]}}
});
const aviso = esperando.agenteAvisoPendiente();
assert.ok(aviso, 'estando en Gasto, un aviso sin leer de Pendientes tiene que salir');
assert.equal(aviso.perfilId, 'tasks');
assert.equal(aviso.perfil.titulo, 'Agente IA', 'el título es para decir en la burbuja cuál espera');

// El del módulo en el que estás no cuenta: ese se abre solo.
const propio = banco({
  perfil: 'tasks',
  estados: {tasks: {avisos: [{id: 'resumen-apertura', texto: 'Buen día', visto: false}]}}
});
assert.equal(propio.agenteAvisoPendiente(), null, 'el aviso del módulo actual no enciende el punto');

// Uno ya leído tampoco.
const leido = banco({
  perfil: 'gasto',
  estados: {tasks: {avisos: [{id: 'resumen-apertura', texto: 'Buen día', visto: true}]}}
});
assert.equal(leido.agenteAvisoPendiente(), null, 'un aviso ya visto no deja el punto encendido');

// Y un agente con el que nunca se habló no crea conversación solo por preguntarle.
const vacio = banco({perfil: 'tasks', estados: {}});
assert.equal(vacio.agenteAvisoPendiente(), null);
assert.deepEqual(Object.keys(vacio.agenteEstados), [], 'preguntar por avisos no crea estados vacíos');

console.log('ok · objetivos-del-dia');
