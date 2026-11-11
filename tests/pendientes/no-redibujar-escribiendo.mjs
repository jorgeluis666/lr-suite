// Lote 12, parte 2: un cambio del otro usuario no puede borrar lo que estás escribiendo.
//
// renderTasksIfActive ya se saltaba el redibujo cuando nada había cambiado. El problema era el
// otro caso: cuando SÍ cambia algo, redibujaba el módulo entero encima de la persona que estaba
// tecleando, y se perdía el texto a medias y la posición del cursor.
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

// Un elemento con foco, como los del tablero.
const enElModulo = {closest: (sel) => (sel === '.task-module' ? {} : null)};
const editable = () => ({...enElModulo, isContentEditable: true, tagName: 'DIV'});
const campo = (valor) => ({...enElModulo, isContentEditable: false, tagName: 'INPUT', value: valor});
const desplegable = (clase) => ({
  ...enElModulo, isContentEditable: false, tagName: 'SELECT',
  classList: {contains: (c) => c === clase}
});
const fuera = {closest: () => null, isContentEditable: true, tagName: 'DIV'};

const llamadas = [];
let oyenteDeFocusout = null;
function montar({activo = null, firmaCambia = true, hayModulo = true} = {}) {
  llamadas.length = 0;
  const contexto = {
    String, Number, Boolean,
    state: {active: 'tasks'},
    lastTasksRenderSignature: 'firma-vieja',
    hasSuiteAccess: () => true,
    tasksRenderSignature: () => (firmaCambia ? 'firma-nueva' : 'firma-vieja'),
    pruneActiveTimersByUser: () => {},
    syncLegacyActiveTimerFields: () => {},
    renderPresenceFromSync: () => llamadas.push('presencia'),
    updateTaskTimerDom: () => llamadas.push('cronometro'),
    updateLiveActivityNotice: () => llamadas.push('aviso'),
    updatePendingSyncStatusDom: () => llamadas.push('estadoBBDD'),
    captureNewTaskDraft: () => ({}),
    restoreNewTaskDraft: () => {},
    tasksModule: () => llamadas.push('REDIBUJO'),
    document: {
      activeElement: activo,
      querySelector: () => (hayModulo ? {} : null),
      addEventListener: (tipo, fn) => { if (tipo === 'focusout') oyenteDeFocusout = fn; }
    },
    window: {setTimeout: (fn) => fn()}
  };
  vm.createContext(contexto);
  vm.runInContext(
    [extraer('hayEdicionEnCurso'),
      'let tasksRerenderPending = false;',
      'let salidaDeFocoLista = false;',
      extraer('escucharSalidaDeFoco'),
      extraer('renderTasksIfActive'),
      // Un `let` dentro de un contexto vm vive en el ámbito del script, no como propiedad del
      // objeto, así que para leerlo desde fuera hay que exponerlo a mano.
      'globalThis.leerPendiente = () => tasksRerenderPending;'].join('\n'),
    contexto
  );
  return contexto;
}

// ── Escribiendo: no se redibuja ───────────────────────────────────────────
let c = montar({activo: editable()});
c.renderTasksIfActive();
assert.equal(llamadas.includes('REDIBUJO'), false, 'no puede redibujar encima de quien escribe');
assert.ok(llamadas.includes('presencia') && llamadas.includes('cronometro'),
  'pero la presencia y el cronómetro sí se refrescan: la pantalla no se congela');
assert.equal(c.leerPendiente(), true, 'queda anotado que hay un redibujo pendiente');

// ── Sin nadie escribiendo: se redibuja como siempre ──────────────────────
c = montar({activo: null});
c.renderTasksIfActive();
assert.ok(llamadas.includes('REDIBUJO'));
assert.equal(c.leerPendiente(), false);

// ── Un campo vacío no bloquea para siempre ───────────────────────────────
c = montar({activo: campo('')});
c.renderTasksIfActive();
assert.ok(llamadas.includes('REDIBUJO'), 'un campo enfocado pero vacío no tiene nada que perder');

c = montar({activo: campo('a medio escribir')});
c.renderTasksIfActive();
assert.equal(llamadas.includes('REDIBUJO'), false, 'con algo escrito sí se espera');

// ── Los desplegables abiertos también cuentan ────────────────────────────
for (const clase of ['badge-select', 'task-subtask-owner-select']) {
  c = montar({activo: desplegable(clase)});
  c.renderTasksIfActive();
  assert.equal(llamadas.includes('REDIBUJO'), false, `el desplegable ${clase} tiene que esperar`);
}
// Uno cualquiera, no del tablero, no bloquea.
c = montar({activo: desplegable('otro-select')});
c.renderTasksIfActive();
assert.ok(llamadas.includes('REDIBUJO'));

// ── Escribir FUERA del tablero no bloquea nada ───────────────────────────
c = montar({activo: fuera});
c.renderTasksIfActive();
assert.ok(llamadas.includes('REDIBUJO'), 'el chat del agente no debería frenar el tablero');

// ── Al soltar el campo, el redibujo pendiente se hace ────────────────────
c = montar({activo: editable()});
c.renderTasksIfActive();
assert.equal(llamadas.includes('REDIBUJO'), false);
assert.ok(oyenteDeFocusout, 'tiene que haberse registrado el oyente de focusout');
// El foco se fue del campo: ahora sí.
c.document.activeElement = null;
llamadas.length = 0;
oyenteDeFocusout();
assert.ok(llamadas.includes('REDIBUJO'), 'al salir del campo se hace el redibujo que quedó pendiente');

// Y si el foco pasa a OTRO campo del tablero, se sigue esperando.
c = montar({activo: editable()});
c.renderTasksIfActive();
llamadas.length = 0;
c.document.activeElement = campo('sigo escribiendo en otro');
oyenteDeFocusout();
assert.equal(llamadas.includes('REDIBUJO'), false, 'saltar de un campo a otro no interrumpe');

// ── Si la firma no cambió, el camino liviano de siempre ──────────────────
c = montar({activo: null, firmaCambia: false});
c.renderTasksIfActive();
assert.equal(llamadas.includes('REDIBUJO'), false);
assert.ok(llamadas.includes('aviso'), 'ese camino refresca también el aviso de actividad');

console.log('PASS no redibujar escribiendo: con alguien tecleando no se redibuja pero la presencia y el cronómetro siguen vivos, un campo vacío no bloquea, el foco fuera del tablero tampoco, y al soltar el campo se hace el redibujo que quedó pendiente.');
