// El módulo «Agentes IA»: el tablero de lo que gastan los agentes en API y tokens.
//
// Lo que se comprueba aquí es lo que no se ve abriendo la pantalla una vez:
//   · Que «Gasto del mes» sume solo los días del mes en curso. La serie que llega son los últimos
//     N días, así que a final de mes trae días del anterior: sumarlos todos daría un mes inflado
//     justo cuando alguien mira para decidir si el gasto se le está yendo.
//   · Que la tira de días deje hueco en los días sin gasto. Sin el hueco, tres días seguidos sin
//     hablar con ningún agente se leen como tres días juntos de trabajo.
//   · Que el modelo y el esfuerzo que se enseñan sean los de la última llamada, no un texto fijo:
//     el modelo se cambia por secreto y el tablero tiene que delatar el cambio.
//   · Que lo que viene de la base se escape. El nombre de usuario sale de una fila, y una fila es
//     dato, no HTML.
//   · Que el navegador NO lea la tabla de uso: solo el resumen ya sumado. Bajar una fila por
//     llamada cada vez que alguien abre el módulo es egress pagado por nada.
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

// Un const que es un objeto de varias líneas (AGENTES_NOMBRES): se lee del archivo en vez de
// copiarlo aquí, para que los nombres que se prueban sean los que de verdad se pintan.
function objeto(nombre) {
  const inicio = html.indexOf(`const ${nombre} = {`);
  assert.notEqual(inicio, -1, `no se encontró el objeto ${nombre}`);
  let i = html.indexOf('{', inicio);
  let nivel = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') nivel++;
    else if (html[i] === '}' && --nivel === 0) break;
  }
  return `${html.slice(inicio, i + 1)};`;
}

function linea(nombre) {
  const encontrada = html.match(new RegExp(`\\n\\s*const ${nombre} = [^\\n]+`));
  assert.ok(encontrada, `no se encontró la constante ${nombre}`);
  return encontrada[0].trim();
}

const contexto = {
  // Las piezas comunes de la Suite que usan estas funciones. Se definen aquí con el mismo
  // comportamiento que en la app: lo que prueba este archivo es el módulo, no el formateador.
  escapeHtml: (valor = '') =>
    String(valor).replace(/[&<>"']/g, (caracter) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'})[caracter]),
  fmtNumber: (valor) => new Intl.NumberFormat('es-PE', {maximumFractionDigits: 0}).format(valor),
  state: {active: 'agentes'}
};
vm.createContext(contexto);

vm.runInContext(
  [
    linea('SHEET_MONTH_NAMES'),
    objeto('AGENTES_NOMBRES'),
    'let agentesDias = 30;',
    extraer('monthLabelFor'),
    extraer('trend'),
    extraer('metric'),
    extraer('agentesUsd'),
    extraer('agentesNombre'),
    extraer('agentesDelMes'),
    extraer('agentesTarjetasHtml'),
    extraer('agentesPorAgenteHtml'),
    extraer('agentesPorPersonaHtml'),
    extraer('agentesPorDiaHtml')
  ].join('\n\n'),
  contexto
);

// Un resumen como el que devuelve lr_suite_agente_uso_resumen: 30 días que cruzan el cambio de
// mes, con dos días sin nada en medio.
const datos = {
  dias: 30,
  desde: '2026-10-13',
  hoy: '2026-11-11',
  total: {llamadas: 46, entrada: 900000, salida: 30000, cache_lee: 0, cache_escribe: 0, busquedas: 7, codigo: 2, costo: 2.1},
  por_agente: [
    {agente: 'pendientes', llamadas: 30, entrada: 700000, salida: 20000, cache_lee: 0, busquedas: 7, codigo: 2, costo: 1.6, modelo: 'claude-sonnet-5-5', esfuerzo: 'low'},
    {agente: 'reglas', llamadas: 2, entrada: 60000, salida: 4000, cache_lee: 0, busquedas: 0, codigo: 0, costo: 0.32, modelo: 'claude-opus-5-5', esfuerzo: null}
  ],
  por_persona: [
    {usuario: 'jorgeluis@limaretail.com', llamadas: 40, costo: 1.9},
    {usuario: '<img src=x onerror=alert(1)>', llamadas: 6, costo: 0.2}
  ],
  por_dia: [
    {dia: '2026-10-30', llamadas: 10, costo: 0.5},
    {dia: '2026-11-02', llamadas: 20, costo: 1.0},
    {dia: '2026-11-11', llamadas: 16, costo: 0.6}
  ]
};

// ── El mes en curso no se come los días del mes anterior ───────────────────
const mes = contexto.agentesDelMes(datos);
assert.equal(mes.mes, '2026-11');
assert.equal(
  Number(mes.costo.toFixed(2)),
  1.6,
  'el gasto del mes tiene que dejar fuera el 30 de octubre'
);
assert.equal(mes.llamadas, 36, 'las llamadas del mes son solo las de noviembre');
assert.equal(mes.hoy.costo, 0.6, 'el día de hoy sale de la serie, no de otra cuenta');

const tarjetas = contexto.agentesTarjetasHtml(datos);
assert.ok(tarjetas.includes('$1.6000'), `«Gasto del mes» tendría que decir $1.6000:\n${tarjetas}`);
assert.ok(tarjetas.includes('$0.6000'), 'tiene que salir el gasto de hoy');
// 2.1 / 46 llamadas = 0.0457 por llamada. A dos decimales esto sería «$0.05» y a cero, «$0».
assert.ok(tarjetas.includes('$0.0457'), 'el costo medio por llamada se lee con cuatro decimales');

// ── El modelo que se enseña es el que corrió ───────────────────────────────
const porAgente = contexto.agentesPorAgenteHtml(datos);
assert.ok(porAgente.includes('claude-sonnet-5-5'), 'el modelo del agente sale de su última llamada');
assert.ok(porAgente.includes('claude-opus-5-5'), 'un agente con otro modelo tiene que delatarse');
assert.ok(porAgente.includes('Pendientes') && porAgente.includes('Análisis de reglas'), 'cada agente con su nombre de la agencia');
assert.ok(
  /ejecuci[óo]n de c[óo]digo/i.test(porAgente),
  'la nota tiene que decir que la ejecución de código no está sumada en el costo'
);

// ── Lo que viene de la base es dato, no HTML ───────────────────────────────
const porPersona = contexto.agentesPorPersonaHtml(datos);
assert.ok(!porPersona.includes('<img src=x'), 'el nombre de usuario tiene que ir escapado');
assert.ok(porPersona.includes('&lt;img src=x'), 'y escapado de verdad, no borrado');

// ── La tira de días deja hueco donde no hubo gasto ─────────────────────────
const porDia = contexto.agentesPorDiaHtml(datos);
const columnas = porDia.match(/class="agentes-dia [^"]*"/g) || [];
const vacias = porDia.match(/class="agentes-dia vacio"/g) || [];
assert.equal(columnas.length, 30, 'la tira tiene una columna por día del periodo');
assert.equal(vacias.length, 27, 'los 27 días sin gasto van en gris, no desaparecen');
assert.ok(porDia.includes('height:100%'), 'el día más caro llega al techo de la tira');

// Un periodo entero sin una sola llamada no pinta una tira vacía: no hay nada que mirar.
assert.equal(
  contexto.agentesPorDiaHtml({dias: 30, hoy: '2026-11-11', por_dia: []}),
  '',
  'sin gasto no hay gráfico'
);

// ── El navegador no baja el detalle ────────────────────────────────────────
assert.ok(
  !html.includes('lr_suite_agente_uso"') && !html.includes("lr_suite_agente_uso'"),
  'el index.html no puede leer la tabla de uso: para eso está el resumen'
);
assert.ok(
  html.includes('lr_suite_agente_uso_resumen'),
  'el módulo lee el resumen ya sumado por Postgres'
);

console.log('ok · agentes-uso');
