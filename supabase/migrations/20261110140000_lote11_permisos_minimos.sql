-- Lote 11 de la auditoría: que el navegador solo pueda hacer lo que la app hace.
--
-- Escrito con los permisos reales de la base, consultados el 2026-11-10, cruzados uno a uno con
-- lo que el código ejercita. Hoy el rol «authenticated» —el de las dos cuentas— tiene DELETE,
-- INSERT, UPDATE, TRUNCATE, REFERENCES y TRIGGER sobre estas seis tablas. La app no usa ni la
-- mitad.
--
-- Lo más serio: lr_suite_pending_backups es la red para recuperarse de una escritura mala, y una
-- sesión del navegador podía vaciarla de un TRUNCATE, justo cuando haría falta. El código solo la
-- lee (recoverSharedPendingBackups, una vez por sesión).
--
-- Esto NO toca RLS ni ninguna política: las políticas deciden QUÉ FILAS se ven, los permisos
-- deciden QUÉ VERBOS existen. Son dos capas y aquí solo se ajusta la segunda.
--
-- CÓMO APLICARLA: Supabase → SQL Editor → pegar entero → Run. Si sale el aviso de RLS, es falso.
--
-- SI MÁS ADELANTE ALGO FALLA con «permission denied for table ...», es que apareció código nuevo
-- que necesita un verbo de los que aquí se quitan: hay que añadirlo a mano y con intención, no
-- devolver el GRANT ALL.
BEGIN;

-- ── Solo lectura ───────────────────────────────────────────────────────────
-- Las copias de seguridad del tablero. El navegador las lee para recuperarse; nunca las escribe.
REVOKE ALL ON TABLE public.lr_suite_pending_backups FROM authenticated;
GRANT SELECT ON TABLE public.lr_suite_pending_backups TO authenticated;

-- La tabla de prospección anterior al ACRM. Su código se retiró, así que no la toca nadie desde
-- el navegador. Se deja la lectura por si quedara algo que consultar antes de decidir borrarla.
REVOKE ALL ON TABLE public.lr_suite_prospectos FROM authenticated;
GRANT SELECT ON TABLE public.lr_suite_prospectos TO authenticated;

-- ── Solo añadir ────────────────────────────────────────────────────────────
-- El historial de tareas cerradas es append-only por diseño: archiveCompletedTask solo inserta,
-- y loadArchivedCompletedTasks solo lee. Nadie debería poder reescribir lo ya archivado.
REVOKE ALL ON TABLE public.lr_suite_pending_history FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.lr_suite_pending_history TO authenticated;

-- ── Leer y actualizar, sin borrar ──────────────────────────────────────────
-- Las tres que la app guarda con upsert, que necesita INSERT y UPDATE. Ninguna se borra nunca
-- desde el navegador: fuera DELETE y TRUNCATE.
REVOKE ALL ON TABLE public.lr_suite_pending_state FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.lr_suite_pending_state TO authenticated;

REVOKE ALL ON TABLE public.lr_suite_private_data FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.lr_suite_private_data TO authenticated;

REVOKE ALL ON TABLE public.lr_suite_notificaciones FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.lr_suite_notificaciones TO authenticated;

COMMIT;

-- ── Comprobación después de aplicar ────────────────────────────────────────
-- Tiene que devolver exactamente estas seis filas y nada más:
--   lr_suite_notificaciones   INSERT, SELECT, UPDATE
--   lr_suite_pending_backups  SELECT
--   lr_suite_pending_history  INSERT, SELECT
--   lr_suite_pending_state    INSERT, SELECT, UPDATE
--   lr_suite_private_data     INSERT, SELECT, UPDATE
--   lr_suite_prospectos       SELECT
--
-- select table_name, string_agg(privilege_type, ', ' order by privilege_type) as permisos
-- from information_schema.role_table_grants
-- where grantee = 'authenticated'
--   and table_name in ('lr_suite_pending_backups','lr_suite_pending_history','lr_suite_pending_state',
--                      'lr_suite_private_data','lr_suite_notificaciones','lr_suite_prospectos')
-- group by table_name order by table_name;
--
-- Y después, en la app: abrir Pendientes, cerrar una tarea y comprobar que sigue apareciendo en
-- completadas al recargar; abrir la campana; abrir Cotizaciones y guardar un cambio.
--
-- ── Lo que queda fuera a propósito ─────────────────────────────────────────
-- · Las nueve tablas lr_suite_agenda_* también tienen permiso de escritura completo, pero no
--   comprobé qué hace la Agenda con cada una. Mismo trabajo, otra tanda.
-- · La vista lr_pros_contactos_unificados aparece con permisos de escritura; es una vista y la
--   escritura va por RPC, así que no cambia nada, pero conviene mirarlo.
-- · Borrar la tabla lr_suite_prospectos: es una decisión aparte, no un ajuste de permisos.
-- · Los respaldos son 802 copias y 35 MB con la poda de 7 días funcionando, o sea unas 115
--   escrituras al día. Ahí el ahorro está en guardar menos veces, no en borrar: es la segunda
--   mitad del lote 6.
