# BBDD - Lista de Pendientes

Esta carpeta concentra los datos y el modelo del modulo de pendientes.

## Archivos

- `schema.sql`: tablas, politicas RLS y realtime para Supabase.
- `static-authenticated-state.sql`: snapshot compartido autenticado para que `index.html` mantenga la misma vista en GitHub Pages.
- `initial-data.json`: tareas iniciales del modulo.
- `schedule-jorge-luis-2026-06-15.sql`: migracion de fechas y horas para la semana del 15 al 19 de junio de 2026.
- `completed-history-archive.sql`: archivo append-only del historial y recuperacion del snapshot compartido.
- `pending-state-backups.sql`: snapshots append-only de pendientes activos, historial y tiempos.
- `pending-backup-trigger-and-view.sql`: trigger automatico y vista de un pendiente por fila.
- `resumen-pendientes-correo.sql`: correos del resumen diario de pendientes y la funcion que lo arma.

## Tablas

- `lista_pendientes`: pendientes activos y siempre visibles.
- `lista_pendientes_completadas`: historial consolidado de tareas completadas o eliminadas.
- `lr_suite_pending_state`: estado compartido del HTML estatico, restringido a Jorge Luis y Diego mediante `auth.email()`.
- `lr_suite_pending_history`: copia independiente de cada tarea completada o eliminada.
- `lr_suite_pending_backups`: copias versionadas de toda la lista para validacion y recuperacion automatica.
- `lr_suite_pending_tasks_view`: vista legible de todos los pendientes activos, uno por fila.
- `lr_suite_notificaciones`: correos que reciben el resumen diario (fila `resumen-pendientes`).
- `lr_suite_notificaciones_claves`: clave del envio automatico; no se lee por la API.

## Fechas de tareas internas

Cada tarea interna (subtarea) guarda ahora `startDate` y `endDate` en formato `YYYY-MM-DD`.
Viven dentro del objeto de la subtarea, en la posicion 9 de cada pendiente, dentro de la columna
`tasks` (jsonb) de `lr_suite_pending_state`. **No requieren ALTER ni migracion**: son claves
nuevas de un documento JSON existente.

Las subtareas anteriores no tienen esas claves. `normalizePendingSubtask()` las completa con
cadena vacia al leerlas, lo que el Mapa Visual interpreta como "sin fecha" y ubica como marca
pequena dentro del rango del pendiente padre. Ningun dato previo se pierde ni se reescribe.

El merge de sincronizacion conserva la fecha existente cuando la copia entrante llega vacia,
igual que `completedAt` y `completedBy`, para que un cliente desactualizado no borre fechas.

## Realtime

El componente usa:

- Supabase Realtime Postgres Changes para sincronizar pendientes e historial.
- Supabase Presence para mostrar usuarios conectados y que pendiente edita cada uno.
- `lr_suite_pending_state` para sincronizar el `index.html` estatico publicado en GitHub Pages.

## Regla de permanencia

Un pendiente solo sale de `lista_pendientes` cuando se marca como completado o se borra explicitamente. En ambos casos se inserta antes en `lista_pendientes_completadas`.

En el HTML estatico, cada cierre se guarda primero en `lr_suite_pending_state` y despues se archiva en
`lr_suite_pending_history`. El panel fusiona historiales recibidos y nunca reemplaza un historial existente
por una lista vacia.

Cada cambio de tareas crea ademas un backup local rotativo en el navegador. Cuando la tabla
`lr_suite_pending_backups` esta instalada, la aplicacion guarda una copia compartida despues de
sincronizar y valida los ultimos snapshots cada 30 segundos. Cada snapshot incluye pendientes,
historial y tiempos. Las tareas solo se excluyen de la recuperacion si tienen una marca explicita
de completado o eliminado.

El trigger de `pending-backup-trigger-and-view.sql` crea el backup directamente en Supabase cada
vez que cambia el estado compartido. Para revisar los pendientes sin abrir JSON, usar la vista
`lr_suite_pending_tasks_view`.

## Resumen diario por correo

Todos los dias a las 8:30 a. m. de Lima, `.github/workflows/resumen-pendientes.yml` corre
`scripts/correo/resumen-pendientes.mjs`: pide a Supabase los pendientes activos y la lista de correos con
`public.lr_suite_resumen_pendientes(clave)` y manda un correo con la estetica de la Suite (cuantos
pendientes hay abiertos, vencidos, que vencen hoy y con 8 dias o mas, y la lista por responsable con los
dias desde el inicio, los mismos calculos que el panel de Notificaciones). Sale por el correo del hosting
(alertas@limaretail.com). GitHub puede demorar unos minutos el inicio de la corrida programada.

- **Correos**: se cambian con la ruedita del panel de Notificaciones (nombre opcional y correo). Viven en
  `lr_suite_notificaciones`, con las mismas politicas que el resto de la Suite
  (`is_lr_suite_pending_user()`). Al instalar quedan Jorge Luis y Diego. Una lista vacia no envia nada.
- **Clave**: la funcion solo responde con la clave de `lr_suite_notificaciones_claves`, que el workflow
  recibe por el secret `LR_PENDIENTES_CLAVE`. La clave publicable de Supabase sale de `lr-suite-config.js`.
- **Puesta en marcha**: ejecutar `resumen-pendientes-correo.sql` en el SQL Editor (al final muestra la
  clave) y crear en GitHub los secrets `LR_PENDIENTES_CLAVE`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` y
  `SMTP_PASS`.
- **Probar**: `Actions -> Resumen diario de pendientes -> Run workflow`; con "Simulacion" marcada arma el
  correo sin enviarlo. En local, `node scripts/correo/resumen-pendientes.mjs --datos datos.json --preview
  correo.html` escribe el correo con datos de un archivo (`{ "tareas": [...], "destinatarios": [...] }`).

