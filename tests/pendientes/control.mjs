// El control de lo que cierra cada persona se contaba dos veces —pendingScoreForUser en el
// index.html y controlDe en el correo— y ya no coincidían: el correo tomaba los diez primeros
// caracteres del cierre, el día en UTC, y lo cerrado después de las 7 p. m. de Lima caía en el día
// siguiente. Ahora los dos usan src/modules/lista-pendientes/control.js. Esta prueba lo corre con
// los dos formatos de dato (el del tablero y el de la función del correo) y exige la misma cifra.
import assert from 'node:assert/strict';
import '../../src/modules/lista-pendientes/control.js';

const {contar, persona, dia} = globalThis.LRControl;

assert.equal(persona('Jorge Luis'), 'jorge');
assert.equal(persona('diegomachuca@limaretail.com'), 'diego');
assert.equal(persona('Áno Nimo'), 'ano nimo');

assert.equal(dia('2026-11-10T03:00:00.000Z'), '2026-11-09', 'las 10 p. m. del 9 en Lima siguen siendo el 9');
assert.equal(dia('2026-11-10'), '2026-11-10', 'un día suelto se respeta, no se corre a la víspera');
assert.equal(dia('2026-11-09T22:00:00-05:00'), '2026-11-09');
assert.equal(dia(''), '');
assert.equal(dia('no es fecha'), '');

const hoy = '2026-11-09', mes = '2026-11';
// El mismo día de trabajo, escrito como lo guarda el tablero…
const tablero = {
  cerrados: [
    {completedAt: '2026-11-09T15:00:00.000Z', completedBy: 'Jorge Luis', subtasksDoneByUser: {'2026-11-09': {jorge: 2}, '2026-10-30': {jorge: 1}}},
    {completedAt: '2026-11-10T03:00:00.000Z', completedBy: 'Jorge Luis'},          // 10 p. m. en Lima
    {completedAt: '2026-11-02T15:00:00.000Z', completedBy: 'Jorge Luis'},          // otro día del mes
    {completedAt: '2026-11-09T16:00:00.000Z', completedBy: 'Jorge Luis', action: 'eliminada'},
    {completedAt: '2026-11-09T16:00:00.000Z', completedBy: 'Diego'}
  ],
  tareas: [
    ['Pendiente abierto', 'Jorge Luis', '', 'Pendiente', 'Alta', '', '', '', '', [
      {status: 'Completado', completedBy: 'Jorge Luis', completedAt: '2026-11-09T20:00:00.000Z'},
      {status: 'Completado', completedAt: '2026-11-10T04:30:00.000Z'},              // sin firma: del dueño
      {status: 'Pendiente', completedBy: 'Jorge Luis', completedAt: '2026-11-09T20:00:00.000Z'},
      {status: 'Completado', completedBy: 'Jorge Luis'}                             // sin fecha: no cuenta
    ]]
  ]
};
// …y como lo devuelve lr_suite_resumen_persona al correo.
const correo = {
  cerrados: tablero.cerrados.map((r) => ({
    completadoEn: r.completedAt, completadoPor: r.completedBy, accion: r.action || '', tareas: r.subtasksDoneByUser || {}
  })),
  tareas: tablero.tareas
};

const esperado = {pendientesDia: 2, pendientesMes: 3, tareasDia: 4, tareasMes: 4};
assert.deepEqual({...contar(tablero, 'Jorge Luis', hoy, mes)}, esperado,
  'el cierre de las 10 p. m. cuenta hoy; la eliminada y la de Diego no; la subtarea sin fecha tampoco');
assert.deepEqual({...contar(correo, 'jorge', hoy, mes)}, esperado, 'y el correo da exactamente lo mismo');
assert.deepEqual({...contar(correo, 'Diego', hoy, mes)}, {pendientesDia: 1, pendientesMes: 1, tareasDia: 0, tareasMes: 0});
assert.deepEqual({...contar({}, '', hoy, mes)}, {pendientesDia: 0, pendientesMes: 0, tareasDia: 0, tareasMes: 0});

// Los dos sitios llaman a esta cuenta y a ninguna otra.
const {readFileSync} = await import('node:fs');
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../../scripts/correo/resumen-persona.mjs', import.meta.url), 'utf8');
assert.match(html, /LRControl\.contar\(/);
assert.match(html, /lista-pendientes\/control\.js/);
assert.match(script, /lista-pendientes\/control\.js/);
assert.doesNotMatch(script, /function controlDe/, 'el correo ya no tiene una cuenta propia');

console.log('PASS control: tablero y correo cuentan lo mismo con sus dos formatos, lo cerrado de noche cae en su día de Lima, las eliminadas no cuentan y un día suelto no se corre a la víspera.');
