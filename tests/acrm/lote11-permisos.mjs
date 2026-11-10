// Lote 11: después de aplicar la migración, el rol del navegador tiene que poder hacer lo que la
// app hace y nada más. Se comprueba ejecutándola sobre una base con los permisos tal y como están
// hoy en producción —GRANT ALL— y mirando qué queda, y además intentando de verdad las
// operaciones que deben fallar.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261110140000_lote11_permisos_minimos.sql', import.meta.url),
  'utf8'
);

const db = new PGlite();
const TABLAS = ['lr_suite_pending_backups', 'lr_suite_pending_history', 'lr_suite_pending_state',
  'lr_suite_private_data', 'lr_suite_notificaciones', 'lr_suite_prospectos'];

await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;`);
for (const t of TABLAS) {
  await db.exec(`CREATE TABLE public.${t} (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, dato text);`);
  // El punto de partida real: permiso completo, como está hoy.
  await db.exec(`GRANT ALL ON TABLE public.${t} TO authenticated;`);
}
await db.exec(`INSERT INTO public.lr_suite_pending_backups (dato) VALUES ('copia del tablero');`);

const permisos = async () => {
  const {rows} = await db.query(`
    select table_name, string_agg(privilege_type, ', ' order by privilege_type) as p
    from information_schema.role_table_grants
    where grantee = 'authenticated' and table_name = any($1)
    group by table_name order by table_name`, [TABLAS]);
  return Object.fromEntries(rows.map((r) => [r.table_name, r.p]));
};

// Antes: todo abierto, incluido TRUNCATE sobre los respaldos.
const antes = await permisos();
assert.ok(antes.lr_suite_pending_backups.includes('TRUNCATE'), 'el punto de partida es GRANT ALL');
assert.ok(antes.lr_suite_pending_backups.includes('DELETE'));

await db.exec(sql);

const despues = await permisos();
assert.deepEqual(despues, {
  lr_suite_notificaciones: 'INSERT, SELECT, UPDATE',
  lr_suite_pending_backups: 'SELECT',
  lr_suite_pending_history: 'INSERT, SELECT',
  lr_suite_pending_state: 'INSERT, SELECT, UPDATE',
  lr_suite_private_data: 'INSERT, SELECT, UPDATE',
  lr_suite_prospectos: 'SELECT'
});

// ── Y ahora de verdad, con el rol puesto ──────────────────────────────────
const comoNavegador = async (consulta) => {
  await db.exec('SET ROLE authenticated');
  try {
    await db.exec(consulta);
    return null;
  } catch (error) {
    return String(error.message || error);
  } finally {
    await db.exec('RESET ROLE');
  }
};

// Lo que la app SÍ hace tiene que seguir funcionando.
assert.equal(await comoNavegador(`SELECT * FROM public.lr_suite_pending_backups`), null,
  'leer los respaldos es lo único que la app hace con ellos');
assert.equal(await comoNavegador(`INSERT INTO public.lr_suite_pending_history (dato) VALUES ('cerrada')`), null,
  'archiveCompletedTask inserta en el historial');
assert.equal(await comoNavegador(`INSERT INTO public.lr_suite_pending_state (dato) VALUES ('tablero')`), null);
assert.equal(await comoNavegador(`UPDATE public.lr_suite_pending_state SET dato = 'tablero v2'`), null,
  'el upsert del tablero necesita INSERT y UPDATE');
assert.equal(await comoNavegador(`INSERT INTO public.lr_suite_private_data (dato) VALUES ('cotizaciones')`), null);
assert.equal(await comoNavegador(`UPDATE public.lr_suite_notificaciones SET dato = 'leida'`), null,
  'la campana marca como leído con upsert');

// Lo que no hace, ya no puede.
const vaciarRespaldos = await comoNavegador(`TRUNCATE public.lr_suite_pending_backups`);
assert.match(String(vaciarRespaldos), /permission denied|must be owner/i,
  'una sesión del navegador ya no puede vaciar la red de recuperación');
const borrarRespaldos = await comoNavegador(`DELETE FROM public.lr_suite_pending_backups`);
assert.match(String(borrarRespaldos), /permission denied/i);
const reescribirHistorial = await comoNavegador(`UPDATE public.lr_suite_pending_history SET dato = 'otra cosa'`);
assert.match(String(reescribirHistorial), /permission denied/i, 'el historial es append-only');
const borrarHistorial = await comoNavegador(`DELETE FROM public.lr_suite_pending_history`);
assert.match(String(borrarHistorial), /permission denied/i);
const borrarTablero = await comoNavegador(`DELETE FROM public.lr_suite_pending_state`);
assert.match(String(borrarTablero), /permission denied/i);
const escribirProspectos = await comoNavegador(`INSERT INTO public.lr_suite_prospectos (dato) VALUES ('x')`);
assert.match(String(escribirProspectos), /permission denied/i, 'su código ya no existe');

// Y los respaldos siguen ahí: la migración ajusta permisos, no borra datos.
const {rows: copias} = await db.query('SELECT count(*)::int AS n FROM public.lr_suite_pending_backups');
assert.equal(copias[0].n, 1, 'la migración no toca ni una fila');

await db.close();
console.log('PASS lote 11: tras la migración el navegador puede leer los respaldos pero no vaciarlos, añadir al historial pero no reescribirlo, y guardar el tablero pero no borrarlo; todo lo que la app sí hace sigue funcionando y no se toca ninguna fila.');
