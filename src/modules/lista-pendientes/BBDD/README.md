# BBDD - Lista de Pendientes

Esta carpeta concentra los datos y el modelo del modulo de pendientes.

## Archivos

- `schema.sql`: tablas, politicas RLS y realtime para Supabase.
- `static-authenticated-state.sql`: snapshot compartido autenticado para que `index.html` mantenga la misma vista en GitHub Pages.
- `initial-data.json`: tareas iniciales del modulo.
- `schedule-jorge-luis-2026-06-15.sql`: migracion de fechas y horas para la semana del 15 al 19 de junio de 2026.
- `completed-history-archive.sql`: archivo append-only del historial y recuperacion del snapshot compartido.

## Tablas

- `lista_pendientes`: pendientes activos y siempre visibles.
- `lista_pendientes_completadas`: historial consolidado de tareas completadas o eliminadas.
- `lr_suite_pending_state`: estado compartido del HTML estatico, restringido a Jorge Luis y Diego mediante `auth.email()`.
- `lr_suite_pending_history`: copia independiente de cada tarea completada o eliminada.

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
